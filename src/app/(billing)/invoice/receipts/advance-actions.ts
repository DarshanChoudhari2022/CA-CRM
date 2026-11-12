"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";

const amount = z
  .string()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/)
  .transform(Number)
  .pipe(z.number().positive());
type State = { error?: string };
export async function recordAdvance(_: State, form: FormData): Promise<State> {
  await requireCrmIdentity();
  const input = z
    .object({
      client: z.uuid(),
      date: z.iso.date(),
      amount,
      mode: z.enum(["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash", "Other"]),
      reference: z.string().trim().min(3).max(100),
      remarks: z.string().trim().max(150),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Check the advance payment details." };
  const { client, date, amount: value, mode, reference, remarks } = input.data;
  const { error } = await (await createClient()).rpc("billing_record_advance", {
    p_client: client,
    p_date: date,
    p_amount: value,
    p_mode: mode,
    p_reference: reference,
    p_remarks: remarks,
  });
  if (error) return { error: error.code === "23505" ? "This advance reference is already recorded." : error.message };
  revalidatePath("/invoice", "layout");
  redirect("/invoice/receipts?advanceResult=recorded#advances");
}

export async function allocateAdvance(_: State, form: FormData): Promise<State> {
  await requireCrmIdentity();
  const input = z
    .object({ advance: z.uuid(), invoice: z.uuid(), request: z.uuid(), amount })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose an invoice and enter an amount." };
  const { advance, invoice, request, amount: value } = input.data;
  const { error } = await (await createClient()).rpc("billing_apply_advance", {
    p_advance: advance,
    p_invoice: invoice,
    p_amount: value,
    p_request: request,
  });
  if (error) return { error: error.message };
  for (const path of ["/crm/invoices", "/crm/reports"]) revalidatePath(path);
  revalidatePath("/invoice", "layout");
  redirect("/invoice/receipts?advanceResult=allocated#advances");
}
