"use server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { leaveTemplateSchema, leaveTemplateText, whatsappProvider } from "@/modules/crm/authkey";
import { draftReply, integrationStatus, sendGmail, sendWhatsApp } from "@/modules/crm/providers";
import { requireIdentity } from "@/modules/identity/session";

type Result = { error?: string; success?: string; draft?: string };
export async function supportDraft(_: Result, form: FormData): Promise<Result> {
  await requireIdentity();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid ticket." };
  if (!integrationStatus().Groq) return { error: "Configure Groq in the server environment first." };
  const client = await createClient();
  const { data: ticket } = await client.from("crm_support").select("title,notes").eq("id", id.data).single();
  if (!ticket) return { error: "Ticket unavailable." };
  const { error } = await client.rpc("crm_reserve_draft", { p_source: id.data });
  if (error) return { error: error.message };
  try {
    return { draft: await draftReply(ticket.title, ticket.notes) };
  } catch {
    return { error: "AI draft failed. Check provider configuration and try again." };
  }
}
export async function supportSend(_: Result, form: FormData): Promise<Result> {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) return { error: "Administrator required." };
  const parsed = z
    .object({
      id: z.uuid(),
      requestId: z.uuid(),
      channel: z.enum(["gmail", "whatsapp"]),
      recipient: z.string().trim().max(320),
      subject: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/^[^\r\n]+$/),
      body: z.string().trim().min(1).max(4000),
      confirmed: z.literal("yes"),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Review all fields and confirm permission to contact the recipient." };
  const v = parsed.data;
  const authkey = v.channel === "whatsapp" && whatsappProvider() === "authkey";
  const template = authkey
    ? leaveTemplateSchema.safeParse({
        name: form.get("leaveName"),
        dates: form.get("leaveDates"),
        status: form.get("leaveStatus"),
      })
    : undefined;
  if (authkey && !template?.success) return { error: "Enter the employee name, leave dates and decision." };
  const leave = template?.success ? template.data : undefined;
  const messageBody = leave ? leaveTemplateText(leave) : v.body;
  if (v.channel === "gmail" ? !z.email().safeParse(v.recipient).success : !/^\+?[1-9]\d{7,14}$/.test(v.recipient))
    return { error: "Enter a valid email or international phone number." };
  const ready = integrationStatus();
  if (!(v.channel === "gmail" ? ready.Gmail : ready.WhatsApp)) return { error: "This channel is not configured." };
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) return { error: "Server account configuration is missing." };
  const client = await createClient();
  if (authkey) {
    const permission = await client
      .from("crm_channel_permissions")
      .select("allowed")
      .eq("organization_id", identity.organizationId)
      .eq("channel", "whatsapp")
      .eq("recipient", v.recipient)
      .maybeSingle();
    if (permission.error || !permission.data?.allowed)
      return { error: "Save WhatsApp recipient permission in Automation Centre first." };
  }
  const { error } = await client.rpc("crm_reserve_send", {
    p_id: v.requestId,
    p_source: v.id,
    p_channel: v.channel,
    p_recipient: v.recipient,
    p_subject: v.subject,
    p_body: messageBody,
  });
  if (error) return { error: error.message };
  const admin = createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const providerId =
      v.channel === "gmail"
        ? await sendGmail(v.recipient, v.subject, messageBody)
        : await sendWhatsApp(v.recipient, messageBody, leave);
    const update = await admin
      .from("crm_outbox")
      .update({ status: "accepted", provider_id: providerId, updated_at: new Date().toISOString() })
      .eq("id", v.requestId)
      .eq("organization_id", identity.organizationId);
    revalidatePath("/crm/automations");
    if (update.error)
      return { error: "Provider accepted the message but logging failed. Do not resend; verify with the provider." };
    return { success: "Accepted by provider. Delivery is not yet confirmed." };
  } catch {
    await admin
      .from("crm_outbox")
      .update({ status: "uncertain", updated_at: new Date().toISOString() })
      .eq("id", v.requestId)
      .eq("organization_id", identity.organizationId);
    revalidatePath("/crm/automations");
    return { error: "Send result is uncertain. Check the provider and outbox before attempting a new message." };
  }
}
