"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function decide(kind: "leave" | "attendance", id: string, decision: "approved" | "rejected", reason = "") {
  const supabase = await createClient();
  const rpcName = kind === "leave" ? "decide_leave_request" : "decide_attendance_correction";
  const { error } = await supabase.rpc(rpcName, {
    p_id: id,
    p_decision: decision,
    p_reason: reason,
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  revalidatePath("/leave");
  revalidatePath("/attendance");
  return { success: `${kind === "leave" ? "Leave" : "Correction"} ${decision}.` };
}
