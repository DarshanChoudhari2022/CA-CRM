import { integrationStatus, sendGmail, sendWhatsApp } from "../providers";
import { answerEnquiry } from "./agent";
import { createCollectionLink } from "./collection";
import { automationOrganization, automationStore } from "./store";
import { sendTelegram } from "./telegram";

export async function runAutomation() {
  const db = automationStore(),
    org = automationOrganization();
  const { data: settings, error: settingsError } = await db
    .from("crm_automation_settings")
    .select("enabled,knowledge")
    .eq("organization_id", org)
    .maybeSingle();
  if (settingsError) throw new Error("Automation settings unavailable");
  if (!settings?.enabled) return { paused: true, scheduled: 0, drafted: 0, dispatched: 0, failures: 0 };
  const { data: scheduled, error } = await db.rpc("crm_schedule_dispatch", { p_org: org });
  if (error) throw new Error("Reminder scheduling failed");
  if (process.env.TELEGRAM_PARTNER_CHAT_ID && process.env.TELEGRAM_BOT_TOKEN) {
    const { error: alertError } = await db.rpc("crm_queue_partner_alerts", {
      p_org: org,
      p_recipient: process.env.TELEGRAM_PARTNER_CHAT_ID,
    });
    if (alertError) throw new Error("Partner alert scheduling failed");
  }
  const ready = integrationStatus();
  let drafted = 0,
    dispatched = 0,
    failures = 0;
  if (ready.Groq) {
    const { data: items, error: claimError } = await db.rpc("crm_claim_inbound", { p_org: org });
    if (claimError) throw new Error("Inbox claim failed");
    const item = items?.[0];
    if (item) {
      try {
        const history = await db
          .from("crm_inbound")
          .select("body,reply")
          .eq("organization_id", org)
          .eq("channel", item.channel)
          .eq("sender", item.sender)
          .neq("id", item.id)
          .in("status", ["complete"])
          .order("created_at", { ascending: false })
          .limit(6);
        if (history.error) throw new Error("Conversation history unavailable");
        const result = await answerEnquiry(item.body, settings.knowledge, (history.data ?? []).reverse());
        const { error: finishError } = await db.rpc("crm_finish_inbound", {
          p_id: item.id,
          p_lease: item.lease,
          p_reply: result.reply,
          p_classification: result.classification,
        });
        if (finishError) throw new Error("Draft persistence failed");
        drafted++;
      } catch {
        failures++;
        await db
          .from("crm_inbound")
          .update({ status: item.attempts >= 3 ? "failed" : "pending", updated_at: new Date().toISOString() })
          .eq("id", item.id)
          .eq("lease", item.lease);
      }
    }
  }
  const channels = [
    ...(ready.Gmail ? ["gmail"] : []),
    ...(ready.WhatsApp ? ["whatsapp"] : []),
    ...(process.env.TELEGRAM_PARTNER_CHAT_ID && process.env.TELEGRAM_BOT_TOKEN ? ["telegram"] : []),
  ];
  // Bounded batches fit serverless execution. Additional scheduler runs drain the queue.
  for (let i = 0; i < 2 && channels.length; i++) {
    const { data: items, error: claimError } = await db.rpc("crm_claim_dispatch", { p_org: org, p_channels: channels });
    if (claimError) throw new Error("Outbound claim failed");
    const job = items?.[0];
    if (!job) break;
    try {
      const body =
        job.source_module === "documents"
          ? `${job.body}\nSecure upload: ${await createCollectionLink(job.source_id, org)}`
          : job.body;
      const id =
        job.channel === "gmail"
          ? await sendGmail(job.recipient, job.subject, body)
          : job.channel === "telegram"
            ? await sendTelegram(job.recipient, body)
            : await sendWhatsApp(job.recipient, body);
      const { error: saveError } = await db
        .from("crm_dispatch")
        .update({ status: "accepted", provider_id: id, updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("lease", job.lease);
      if (saveError) throw new Error("Acceptance persistence failed");
      if (job.channel === "whatsapp") {
        const receipts = await db
          .from("crm_delivery_receipts")
          .select("status")
          .eq("organization_id", org)
          .eq("provider_id", id);
        const states = receipts.data?.map((r) => r.status) ?? [];
        const latest = ["read", "delivered", "failed"].find((s) => states.includes(s));
        if (latest)
          await db
            .from("crm_dispatch")
            .update({ status: latest })
            .eq("id", job.id)
            .in("status", ["accepted", "uncertain"]);
      }
      if (job.source_module === "inbound")
        await db
          .from("crm_inbound")
          .update({ status: "complete", updated_at: new Date().toISOString() })
          .eq("id", job.source_id)
          .eq("organization_id", org);
      dispatched++;
    } catch {
      failures++;
      // A failed/timeout response may hide a successful send. Never auto-replay it.
      await db
        .from("crm_dispatch")
        .update({
          status: "uncertain",
          error: "Provider acceptance not confirmed; verify before resending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("lease", job.lease);
    }
  }
  return { paused: false, scheduled: scheduled ?? 0, drafted, dispatched, failures };
}
