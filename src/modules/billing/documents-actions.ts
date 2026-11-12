"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { type BillingKind, billingPath, isAdjustment, parseBillingDetails } from "./documents";

const submission = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000),
  client_id: z.uuid(),
  due_date: z.union([z.literal(""), z.iso.date()]),
  source_invoice_id: z.uuid().optional(),
  intent: z.enum(["draft", "issued"]),
  invoice_details: z.string(),
});

export async function saveBillingDocument(
  kind: BillingKind,
  id: string | null,
  requestId: string,
  version: string | null,
  _: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  await requireCrmIdentity();
  const parsed = submission.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the title, client, dates and source invoice." };
  const { title, notes, client_id, due_date, source_invoice_id, intent, invoice_details } = parsed.data;
  if (isAdjustment(kind) && (!source_invoice_id || intent !== "draft" || !notes.trim())) {
    return { error: "Choose a source invoice and enter a reason to save the adjustment draft." };
  }
  let result: ReturnType<typeof parseBillingDetails>;
  try {
    result = parseBillingDetails(kind, JSON.parse(invoice_details));
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message
        : error instanceof Error && !(error instanceof SyntaxError)
          ? error.message
          : undefined;
    return { error: message ?? "Check the document details." };
  }
  const client = await createClient();
  const params = {
    p_id: id,
    p_request: requestId,
    p_version: version,
    p_values: {
      title,
      notes,
      client_id,
      due_date,
      status: intent,
      amount: result.totals.total,
      invoice_details: result.details,
    },
  };
  const { data, error } =
    kind === "invoice"
      ? await client.rpc("billing_save_invoice", params)
      : await client.rpc("billing_save_document", { ...params, p_kind: kind, p_source: source_invoice_id ?? null });
  if (error) {
    if (error.code === "23505") return { error: "This document reference is already in use." };
    if (error.code === "P0001") return { error: error.message };
    return { error: "The document could not be saved. Check the fields and retry." };
  }
  if (typeof data !== "string") return { error: "The document could not be saved." };
  revalidatePath("/invoice", "layout");
  if (kind === "invoice") {
    revalidatePath("/crm/invoices");
    revalidatePath("/crm/reports");
  }
  redirect(`${billingPath(kind)}?id=${data}`);
}

export async function transitionBillingDocument(
  kind: "quotation" | "proforma",
  id: string,
  _: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  await requireCrmIdentity();
  const intent = z.enum(["accept", "convert"]).safeParse(form.get("intent"));
  if (!intent.success || !z.uuid().safeParse(id).success) return { error: "Invalid document action." };
  const client = await createClient();
  const { data, error } = await client.rpc("billing_transition_document", { p_id: id, p_intent: intent.data });
  if (error || typeof data !== "string") {
    return { error: error?.code === "P0001" ? error.message : "The document could not be updated." };
  }
  revalidatePath("/invoice", "layout");
  if (intent.data === "convert") revalidatePath("/crm/invoices");
  redirect(intent.data === "convert" ? `/invoice/raise?id=${data}` : `${billingPath(kind)}?id=${data}`);
}
