"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { crmModules } from "@/modules/crm/config";
import { requireCrmIdentity } from "@/modules/identity/crm";

export type ClientFormState = { error?: string };

export async function saveBillingClient(
  client: { id: string; updatedAt: string } | null,
  _: ClientFormState,
  form: FormData,
): Promise<ClientFormState> {
  await requireCrmIdentity();
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(200),
      status: z.enum(crmModules.clients.statuses),
      email: z
        .string()
        .trim()
        .max(254)
        .pipe(z.union([z.literal(""), z.email()])),
      phone: z.string().trim().max(40),
      notes: z.string().max(4000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the client details and try again." };
  if (client && !z.object({ id: z.uuid(), updatedAt: z.iso.datetime({ offset: true }) }).safeParse(client).success) {
    return { error: "Reload the client before saving." };
  }

  const db = await createClient();
  const { title, status, email, phone, notes } = parsed.data;
  const { data, error } = client
    ? await db.rpc("billing_update_client", {
        p_id: client.id,
        p_updated_at: client.updatedAt,
        p_title: title,
        p_status: status,
        p_email: email,
        p_phone: phone,
        p_notes: notes,
      })
    : await db.rpc("crm_save", {
        p_module: "clients",
        p_id: null,
        p_values: { title, status, email, phone, notes },
      });
  if (error) return { error: error.code === "P0001" ? error.message : "The client could not be saved." };

  revalidatePath("/invoice", "layout");
  revalidatePath("/crm/clients");
  const savedId = client?.id ?? z.uuid().safeParse(data).data;
  redirect(savedId ? `/invoice/clients/${savedId}` : "/invoice/clients");
}
