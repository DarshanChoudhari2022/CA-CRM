"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";

const scheduleForm = z.object({
  request: z.uuid(),
  client: z.uuid(),
  template: z.uuid(),
  interval: z.enum(["1", "3", "12"]).transform(Number),
  firstDue: z.iso.date().refine((value) => value >= "2000-01-01" && value <= "2100-12-31"),
  paymentTerms: z.union([
    z.literal("").transform(() => null),
    z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number),
  ]),
});

const recurringPath = "/invoice/recurring";

export async function createRecurringSchedule(requestId: string, clientId: string, _state: string, form: FormData) {
  await requireCrmIdentity();
  const input = scheduleForm.safeParse({
    request: requestId,
    client: clientId,
    template: form.get("template"),
    interval: form.get("interval"),
    firstDue: form.get("first_due"),
    paymentTerms: form.get("payment_terms"),
  });
  if (!input.success) return "Choose an invoice and frequency, and enter a valid first date and payment terms.";
  const client = await createClient();
  const { error } = await client.rpc("billing_create_recurring_schedule", {
    p_request: input.data.request,
    p_client: input.data.client,
    p_template: input.data.template,
    p_interval_months: input.data.interval,
    p_first_due: input.data.firstDue,
    p_payment_terms_days: input.data.paymentTerms,
  });
  if (error) return "Could not create this schedule. Confirm that the template is available and try again.";
  revalidatePath(recurringPath);
  redirect(`${recurringPath}?saved=1`);
}

export async function setRecurringActive(id: string, active: boolean, _state: string, _form: FormData) {
  await requireCrmIdentity();
  if (!z.uuid().safeParse(id).success || typeof active !== "boolean") return "Schedule unavailable.";
  const client = await createClient();
  const { error } = await client.rpc("billing_set_recurring_active", { p_id: id, p_active: active });
  if (error) return "Could not update this schedule. Try again.";
  revalidatePath(recurringPath);
  redirect(`${recurringPath}?updated=1`);
}

export async function runDueRecurring(_state: string, _form: FormData) {
  await requireCrmIdentity();
  const client = await createClient();
  const { data, error } = await client.rpc("billing_run_due_recurring");
  const result = z.object({ generated: z.number().int(), failed: z.number().int(), more: z.boolean() }).safeParse(data);
  if (error || !result.success) return "Could not run due schedules. Try again.";
  revalidatePath(recurringPath);
  revalidatePath("/invoice/ledger");
  const { generated, failed, more } = result.data;
  redirect(`${recurringPath}?created=${generated}&failed=${failed}&more=${more ? 1 : 0}`);
}
