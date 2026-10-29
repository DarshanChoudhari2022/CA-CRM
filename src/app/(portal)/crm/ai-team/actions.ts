"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { loadAgentSources } from "@/modules/ai/context";
import { type AgentJob, briefSchema } from "@/modules/ai/domain";
import { generateAgentDraft } from "@/modules/ai/provider";
import { integrationStatus } from "@/modules/crm/providers";
import { requireCrmIdentity as requireIdentity } from "@/modules/identity/crm";

export type WorkpaperState = { error?: string; success?: string };

export async function createWorkpaper(_: WorkpaperState, form: FormData): Promise<WorkpaperState> {
  await requireIdentity();
  const parsed = briefSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the workpaper fields." };
  const value = parsed.data;
  const client = await createClient();
  const { error } = await client.rpc("ca_create_job", {
    p_kind: value.kind,
    p_title: value.title,
    p_brief: value.brief,
    p_jurisdiction: value.jurisdiction,
    p_period: value.period,
    p_client: value.clientId || null,
    p_request: value.requestId,
  });
  if (error) return { error: error.message };
  revalidatePath("/crm/ai-team");
  return { success: "Workpaper saved. Open it below to prepare a draft." };
}

export async function prepareWorkpaper(_: WorkpaperState, form: FormData): Promise<WorkpaperState> {
  const identity = await requireIdentity();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid workpaper." };
  if (!integrationStatus().Groq) return { error: "Configure GROQ_API_KEY and GROQ_MODEL to prepare AI drafts." };
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { error: "Server account configuration is required." };
  const client = await createClient();
  const row = await client
    .from("ca_agent_jobs")
    .select("*")
    .eq("id", id.data)
    .eq("organization_id", identity.organizationId)
    .single();
  if (row.error || !row.data) return { error: "Workpaper unavailable." };
  const job = row.data as AgentJob;
  if (job.created_by !== identity.userId)
    return { error: "Only the workpaper creator can prepare its draft. Administrators can review the saved result." };
  const lease = crypto.randomUUID();
  const admin = createAdminClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let started = false;
  try {
    const sources = await loadAgentSources(client, identity.organizationId, job);
    const reservation = await client.rpc("ca_start_job", {
      p_id: job.id,
      p_lease: lease,
      p_model: process.env.GROQ_MODEL,
      p_sources: sources,
    });
    if (reservation.error) return { error: reservation.error.message };
    started = true;
    const output = await generateAgentDraft(job, sources);
    const saved = await admin.rpc("ca_finish_job", {
      p_id: job.id,
      p_org: identity.organizationId,
      p_lease: lease,
      p_output: output,
      p_error: null,
    });
    if (saved.error) return { error: "The draft could not be saved. Refresh to check its status before retrying." };
    revalidatePath("/crm/ai-team");
    return { success: "Draft saved for administrator review." };
  } catch {
    if (started)
      await admin.rpc("ca_finish_job", {
        p_id: job.id,
        p_org: identity.organizationId,
        p_lease: lease,
        p_output: null,
        p_error: "Draft could not be prepared. Check the provider and approved references, then retry.",
      });
    revalidatePath("/crm/ai-team");
    return { error: "Draft preparation failed. Your brief is saved and can be retried." };
  }
}

export async function reviewWorkpaper(_: WorkpaperState, form: FormData): Promise<WorkpaperState> {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) return { error: "Administrator review required." };
  const parsed = z
    .object({ id: z.uuid(), decision: z.enum(["approved", "rejected"]), note: z.string().trim().min(10).max(2000) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter a review note of at least 10 characters." };
  const client = await createClient();
  const { error } = await client.rpc("ca_review_job", {
    p_id: parsed.data.id,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note,
  });
  if (error) return { error: error.message };
  revalidatePath("/crm/ai-team");
  return { success: "Review saved." };
}

export async function saveReference(_: WorkpaperState, form: FormData): Promise<WorkpaperState> {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) return { error: "Administrator required." };
  const parsed = z
    .object({
      title: z.string().trim().min(3).max(160),
      content: z.string().trim().min(20).max(8000),
      url: z.url().refine((url) => url.startsWith("https://")),
      jurisdiction: z.string().trim().min(2).max(120),
      validUntil: z.iso.date(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Complete the reference text, HTTPS source, jurisdiction and validity date." };
  const client = await createClient();
  const value = parsed.data;
  const { error } = await client.rpc("ca_save_knowledge", {
    p_title: value.title,
    p_content: value.content,
    p_url: value.url,
    p_jurisdiction: value.jurisdiction,
    p_valid_until: value.validUntil,
  });
  if (error) return { error: error.message };
  revalidatePath("/crm/ai-team");
  return { success: "Reference saved for review." };
}

export async function reviewReference(_: WorkpaperState, form: FormData): Promise<WorkpaperState> {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) return { error: "Administrator required." };
  const parsed = z.object({ id: z.uuid(), state: z.enum(["approved", "retired"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Invalid reference." };
  const client = await createClient();
  const { error } = await client.rpc("ca_review_knowledge", { p_id: parsed.data.id, p_state: parsed.data.state });
  if (error) return { error: error.message };
  revalidatePath("/crm/ai-team");
  return { success: "Reference review saved." };
}
