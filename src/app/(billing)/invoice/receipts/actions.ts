"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";

export type ReceiptState = { error?: string; success?: string };

export async function recordReceipt(invoice: string, _: ReceiptState, form: FormData): Promise<ReceiptState> {
  await requireCrmIdentity();
  const parsed = z
    .object({
      invoice: z.uuid(),
      amount: z
        .string()
        .trim()
        .regex(/^\d{1,10}(?:\.\d{1,2})?$/)
        .transform(Number)
        .pipe(z.number().positive()),
      reference: z.string().trim().min(3).max(120),
    })
    .safeParse({ invoice, amount: form.get("amount"), reference: form.get("reference") });

  if (!parsed.success)
    return { error: "Enter a positive amount with up to two decimal places and a payment reference." };

  const db = await createClient();
  const { error } = await db.rpc("billing_record_receipt", {
    p_invoice: parsed.data.invoice,
    p_amount: parsed.data.amount,
    p_reference: parsed.data.reference,
  });
  if (error) {
    if (error.code === "23505") return { error: "This payment reference has already been recorded." };
    if (error.code === "P0001") return { error: error.message };
    return { error: "The payment could not be recorded. Check the receipts list before retrying." };
  }

  revalidatePath("/invoice", "layout");
  revalidatePath("/crm/invoices");
  revalidatePath("/crm/reports");
  return { success: "Payment recorded." };
}
