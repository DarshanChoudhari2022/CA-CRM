"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";
import { leaveRequestSchema } from "@/modules/leave/domain";

export type LeaveState = { error?: string; success?: string };

export async function submitLeave(_: LeaveState, formData: FormData): Promise<LeaveState> {
  await requireIdentity();
  const parsed = leaveRequestSchema.safeParse({
    leaveTypeId: String(formData.get("leaveTypeId")),
    startDate: String(formData.get("startDate")),
    endDate: String(formData.get("endDate")),
    portion: String(formData.get("portion")),
    reason: String(formData.get("reason")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your leave request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_leave_request", {
    p_leave_type_id: parsed.data.leaveTypeId,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
    p_portion: parsed.data.portion,
    p_reason: parsed.data.reason,
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidatePath("/leave");
  revalidatePath("/dashboard");
  revalidatePath("/approvals");
  return { success: "Leave request submitted for approval." };
}
