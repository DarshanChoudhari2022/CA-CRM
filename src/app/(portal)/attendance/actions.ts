"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatWorkedMinutes } from "@/modules/attendance/duration";
import { locationIsFresh, punchLocationSchema } from "@/modules/attendance/location";
import { requireIdentity } from "@/modules/identity/session";

export type ActionState = { error?: string; success?: string };

export async function punch(
  kind: "check_in" | "check_out",
  requestId: string,
  location: unknown,
): Promise<ActionState> {
  await requireIdentity();
  const parsed = punchLocationSchema.safeParse(location);
  if (!parsed.success || !locationIsFresh(parsed.data))
    return { error: "A current location is required. Please retry." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_attendance_punch", {
    p_kind: kind,
    p_request_id: requestId,
    p_location: parsed.data,
  });
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  revalidatePath("/attendance");
  const saved = data as { duration_minutes?: number | null } | null;
  return {
    success:
      kind === "check_in"
        ? "Check-in saved."
        : typeof saved?.duration_minutes === "number"
          ? `Check-out saved. Time worked today: ${formatWorkedMinutes(saved.duration_minutes)}.`
          : "Check-out saved.",
  };
}

export async function requestCorrection(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireIdentity();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_attendance_correction", {
    p_work_date: String(formData.get("workDate")),
    p_check_in: String(formData.get("checkIn")),
    p_check_out: String(formData.get("checkOut")),
    p_reason: String(formData.get("reason")),
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidatePath("/attendance");
  revalidatePath("/approvals");
  return { success: "Correction request submitted." };
}
