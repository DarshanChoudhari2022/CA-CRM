"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { readServiceForm, readSettingsForm, type SettingsSection, settingsSections } from "./configuration";

export async function saveBillingService(id: string | null, _state: string, form: FormData) {
  await requireCrmIdentity();
  if (id !== null && !z.uuid().safeParse(id).success) return "Service unavailable.";

  const parsed = readServiceForm(form);
  if (!parsed.success) {
    return "Enter a service name, a valid SAC code if applicable, and rates with at most two decimal places.";
  }

  const { name, description, sac_code, unit_price, gst_rate, active } = parsed.data;
  const client = await createClient();
  const { error } = await client.rpc("billing_save_service", {
    p_id: id,
    p_name: name,
    p_description: description,
    p_sac_code: sac_code,
    p_unit_price: unit_price,
    p_gst_rate: gst_rate,
    p_active: active,
  });
  if (error?.code === "23505") return "A service with that name already exists.";
  if (error) return "Could not save this service. Try again.";

  revalidatePath("/invoice/services");
  redirect("/invoice/services?saved=1");
}

export async function saveBillingSettings(section: SettingsSection, _state: string, form: FormData) {
  await requireCrmIdentity();
  if (!Object.hasOwn(settingsSections, section)) return "Settings section unavailable.";

  const parsed = readSettingsForm(section, form);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Check the settings and try again.";

  const client = await createClient();
  const { error } = await client.rpc("billing_save_practice_settings", {
    p_section: section,
    p_settings: parsed.data,
  });
  if (error) return "Could not save these settings. Try again.";

  const dedicatedPage = section === "smart-drafts";
  const path = dedicatedPage ? `/invoice/${section}` : "/invoice/settings";
  revalidatePath(path);
  redirect(dedicatedPage ? `${path}?saved=1` : `${path}?tab=${section}&saved=1`);
}
