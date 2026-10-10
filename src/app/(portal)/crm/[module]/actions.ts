"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { crmModules, isCrmModule } from "@/modules/crm/config";
import { requireIdentity } from "@/modules/identity/session";

export type CrmState = { error?: string; success?: string };
export async function saveRecord(_: CrmState, form: FormData): Promise<CrmState> {
  await requireIdentity();
  const module = String(form.get("module"));
  if (!isCrmModule(module)) return { error: "Unknown module." };
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(200),
      notes: z.string().max(4000),
      status: z.string(),
      owner_id: z.union([z.literal(""), z.uuid()]),
      client_id: z.union([z.literal(""), z.uuid()]).optional(),
      email: z.union([z.literal(""), z.email()]).optional(),
      phone: z.string().max(40).optional(),
      due_date: z.union([z.literal(""), z.iso.date()]).optional(),
      amount: z.coerce.number().positive().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success || !crmModules[module].statuses.some((status) => status === parsed.data.status))
    return { error: "Check the fields and status." };
  const id = String(form.get("id") ?? "");
  if (id && !z.uuid().safeParse(id).success) return { error: "Invalid record." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_save", { p_module: module, p_id: id || null, p_values: parsed.data });
  if (error) return { error: error.message };
  revalidatePath(`/crm/${module}`);
  revalidatePath("/crm/reports");
  return { success: "Saved." };
}
export async function recordPayment(_: CrmState, form: FormData): Promise<CrmState> {
  await requireIdentity();
  const parsed = z
    .object({ invoice: z.uuid(), amount: z.coerce.number().positive(), reference: z.string().trim().min(3).max(120) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the payment details." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_record_payment", {
    p_invoice: parsed.data.invoice,
    p_amount: parsed.data.amount,
    p_reference: parsed.data.reference,
  });
  if (error) return { error: error.message };
  revalidatePath("/crm/invoices");
  return { success: "Payment recorded." };
}
export async function convertLead(_: CrmState, form: FormData): Promise<CrmState> {
  await requireIdentity();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid lead." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_convert_lead", { p_id: id.data });
  if (error) return { error: error.message };
  revalidatePath("/crm/leads");
  revalidatePath("/crm/clients");
  return { success: "Converted to client." };
}
