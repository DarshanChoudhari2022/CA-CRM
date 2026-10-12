"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";
export async function saveDailyReport(
  _: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  await requireIdentity();
  const summary = z
    .string()
    .max(4000)
    .safeParse(form.get("summary") ?? "");
  if (!summary.success) return { error: "Use at most 4000 characters." };
  const { error } = await (await createClient()).rpc("save_daily_report", { p_summary: summary.data });
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  revalidatePath("/work");
  return { success: "Today's work update saved." };
}
