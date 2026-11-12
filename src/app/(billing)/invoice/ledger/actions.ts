"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";

type CancelState = { error?: string; success?: string };
export async function cancelInvoice(_: CancelState, form: FormData): Promise<CancelState> {
  await requireCrmIdentity();
  const values = z
    .object({ invoice: z.uuid(), reason: z.string().trim().min(3).max(250) })
    .safeParse(Object.fromEntries(form));
  if (!values.success) return { error: "Enter a cancellation reason." };
  const { error } = await (await createClient()).rpc("billing_cancel_invoice", {
    p_invoice: values.data.invoice,
    p_reason: values.data.reason,
  });
  if (error) return { error: error.message };
  revalidatePath("/invoice", "layout");
  revalidatePath("/crm/invoices");
  revalidatePath("/crm/reports");
  return { success: "Invoice cancelled." };
}
