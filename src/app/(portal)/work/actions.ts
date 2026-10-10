"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";

export async function saveWork(
  _: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  await requireIdentity();
  const parsed = z
    .object({
      id: z.union([z.literal(""), z.string().uuid()]),
      title: z.string().trim().min(1).max(200),
      notes: z.string().max(2000),
      status: z.enum(["planned", "in_progress", "completed", "blocked"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the title, notes and status." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_daily_work", {
    p_id: parsed.data.id || null,
    p_title: parsed.data.title,
    p_notes: parsed.data.notes,
    p_status: parsed.data.status,
  });
  if (error) return { error: error.message };
  revalidatePath("/work");
  return { success: "Work saved." };
}
