"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { confirmedInvoiceClient } from "@/modules/billing/confirm-invoice-password";
import { requireCrmIdentity } from "@/modules/identity/crm";

type CancelState = { error?: string; success?: string };
export async function cancelInvoice(_: CancelState, form: FormData): Promise<CancelState> {
  const identity = await requireCrmIdentity();
  const values = z
    .object({ invoice: z.uuid(), reason: z.string().trim().min(3).max(250), operation: z.enum(["cancel", "delete"]) })
    .safeParse(Object.fromEntries(form));
  if (!values.success) return { error: "Enter a cancellation reason." };
  const confirmed = await confirmedInvoiceClient(identity.userId, form.get("password"));
  if (!confirmed) return { error: "Could not confirm your current password. Try again." };
  const { error } = await confirmed.rpc("billing_confirmed_invoice_change", {
    p_actor: identity.userId,
    p_invoice: values.data.invoice,
    p_reason: values.data.reason,
    p_action: values.data.operation,
  });
  if (error)
    return {
      error:
        error.message === "Only an issued invoice can be cancelled"
          ? "Only an issued invoice can be cancelled."
          : "The invoice could not be updated. Refresh and check its status.",
    };
  revalidatePath("/invoice", "layout");
  revalidatePath("/crm/invoices");
  revalidatePath("/crm/reports");
  return { success: values.data.operation === "delete" ? "Draft deleted." : "Invoice cancelled." };
}
