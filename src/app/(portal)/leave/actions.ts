"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdministrator } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";
import { leaveRequestSchema } from "@/modules/leave/domain";
import { leaveWeb3FormsKey } from "@/modules/leave/email-config";
import type { LeaveEmailDelivery, LeaveEmailOutcome } from "@/modules/leave/email-delivery";
import { prepareLeaveNotification } from "@/modules/leave/notifications";

export type LeaveState = { error?: string; success?: string; notification?: LeaveEmailDelivery };

export async function submitLeave(_: LeaveState, formData: FormData): Promise<LeaveState> {
  const identity = await requireIdentity();
  const parsed = leaveRequestSchema.safeParse({
    leaveTypeId: String(formData.get("leaveTypeId")),
    startDate: String(formData.get("startDate")),
    endDate: String(formData.get("endDate")),
    portion: String(formData.get("portion")),
    reason: String(formData.get("reason")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your leave request." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_leave_request", {
    p_leave_type_id: parsed.data.leaveTypeId,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
    p_portion: parsed.data.portion,
    p_reason: parsed.data.reason,
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  let notification: LeaveEmailDelivery | undefined;
  try {
    notification = await prepareLeaveNotification(identity.organizationId, String(data));
  } catch {
    /* Leave remains saved; the durable queue can be retried. */
  }
  revalidatePath("/leave");
  revalidatePath("/dashboard");
  revalidatePath("/approvals");
  return { success: "Leave request submitted for approval.", notification };
}

export async function finishLeaveEmail(id: string, lease: string, state: LeaveEmailOutcome) {
  await requireIdentity();
  if (
    !z.uuid().safeParse(id).success ||
    !z.uuid().safeParse(lease).success ||
    !["sent", "failed", "uncertain"].includes(state)
  )
    return false;
  const client = await createClient();
  const { error } = await client.rpc("finish_leave_email", { p_id: id, p_lease: lease, p_state: state });
  revalidatePath("/approvals");
  return !error;
}

export async function retryLeaveEmail(_: LeaveState, form: FormData): Promise<LeaveState> {
  const identity = await requireIdentity();
  if (!isAdministrator(identity.role)) return { error: "Administrator access required." };
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Invalid notification." };
  if (!leaveWeb3FormsKey()) return { error: "Configure the office Web3Forms access key first." };
  const client = await createClient();
  const { data: row, error } = await client
    .from("leave_email_notifications")
    .select("leave_request_id,state")
    .eq("id", id.data)
    .single();
  if (error || !row) return { error: "Notification unavailable." };
  if (row.state !== "pending") {
    const reset = await client.rpc("retry_leave_email", { p_id: id.data });
    if (reset.error) return { error: reset.error.message };
  }
  try {
    const notification = await prepareLeaveNotification(identity.organizationId, row.leave_request_id);
    return notification ? { notification } : { error: "This notification is already being processed." };
  } catch {
    return { error: "Notification could not be prepared. Please retry." };
  }
}
