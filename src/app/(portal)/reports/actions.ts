"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function closeMonth(formData: FormData) {
  const supabase = await createClient();
  const month = String(formData.get("month"));
  await supabase.rpc("close_attendance_month", { p_month: month, p_request_id: crypto.randomUUID() });
  revalidatePath("/reports");
}
