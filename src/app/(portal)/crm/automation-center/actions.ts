"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { collectWhatsAppAttachment } from "@/modules/crm/automation/attachments";
import { createCollectionLink } from "@/modules/crm/automation/collection";
import { automationOrganization, automationStore } from "@/modules/crm/automation/store";
import { requireIdentity } from "@/modules/identity/session";

async function requireAutomationAdmin() {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) throw new Error("Administrator required");
  const { data, error } = await (await createClient()).rpc("current_organization_id");
  if (error || data !== identity.organizationId) throw new Error("Active workspace access required");
  return identity;
}

export async function collectionLink(
  _previous: { url?: string; error?: string },
  form: FormData,
): Promise<{ url?: string; error?: string }> {
  const identity = await requireAutomationAdmin();
  try {
    return { url: await createCollectionLink(z.uuid().parse(form.get("document")), identity.organizationId) };
  } catch {
    return { error: "Could not create link. Check document status and NEXT_PUBLIC_APP_URL." };
  }
}

export async function configure(form: FormData) {
  const identity = await requireAutomationAdmin();
  const db = await createClient();
  let errorMessage = "";
  try {
    const kind = form.get("kind");
    if (kind === "settings") {
      const { error } = await db.rpc("crm_automation_config", {
        p_enabled: form.get("enabled") === "on",
        p_automatic: form.get("automatic") === "on",
        p_ai: form.get("automatic_ai") === "on",
        p_knowledge: z.string().max(12000).parse(form.get("knowledge")),
      });
      if (error) throw new Error(error.message);
    } else if (kind === "permission") {
      const channel = z.enum(["gmail", "whatsapp"]).parse(form.get("channel"));
      const recipient = z.string().trim().max(320).parse(form.get("recipient"));
      if (channel === "gmail") z.email().parse(recipient);
      else
        z.string()
          .regex(/^\+[1-9]\d{6,14}$/)
          .parse(recipient);
      const { error } = await db.rpc("crm_channel_permission", {
        p_channel: channel,
        p_recipient: recipient,
        p_allowed: form.get("allowed") === "on",
        p_evidence: z.string().min(3).max(500).parse(form.get("evidence")),
      });
      if (error) throw new Error(error.message);
    } else if (kind === "review") {
      const { error } = await db.rpc("crm_dispatch_review", {
        p_id: z.uuid().parse(form.get("id")),
        p_send: form.get("decision") === "send",
        p_body: z.string().max(4000).parse(form.get("body")),
      });
      if (error) throw new Error(error.message);
    } else if (kind === "attachment") {
      await collectWhatsAppAttachment(
        identity.organizationId,
        z.uuid().parse(form.get("inbound")),
        z.uuid().parse(form.get("document")),
      );
    } else if (kind === "schedule") {
      if (identity.organizationId !== automationOrganization())
        throw new Error("Configure this workspace's automation organization first");
      const { error } = await automationStore().rpc("crm_schedule_dispatch", { p_org: identity.organizationId });
      if (error) throw new Error("Scheduling failed");
    } else throw new Error("Unknown action");
  } catch {
    errorMessage = "Could not save. Check required fields, configuration and permissions.";
  }
  revalidatePath("/crm/automation-center");
  redirect(`/crm/automation-center?message=${encodeURIComponent(errorMessage || "Saved successfully")}`);
}
