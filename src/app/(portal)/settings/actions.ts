"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SettingsState = { error?: string; success?: string };
export async function addLeaveType(_: SettingsState, formData: FormData): Promise<SettingsState> {
  const supabase = await createClient();
  const days = Number(formData.get("days"));
  const { error } = await supabase.rpc("admin_create_leave_type", {
    p_name: String(formData.get("name")),
    p_code: String(formData.get("code")),
    p_default_days: days,
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/leave");
  return { success: "Leave type created and balances assigned." };
}
export async function addPolicy(_: SettingsState, formData: FormData): Promise<SettingsState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_policy", {
    p_name: String(formData.get("name")),
    p_effective_from: String(formData.get("effectiveFrom")),
    p_shift_start: String(formData.get("shiftStart")),
    p_shift_end: String(formData.get("shiftEnd")),
    p_grace: Number(formData.get("grace")),
    p_full_day: Number(formData.get("fullDay")),
    p_half_day: Number(formData.get("halfDay")),
    p_correction_window: Number(formData.get("correctionWindow")),
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { success: "New policy version created." };
}
