"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdministrator } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";
import type { ActionState } from "../attendance/actions";

const attendanceFields = z.object({
  employee: z.uuid(),
  checkIn: z.iso.time({ precision: -1 }),
  checkOut: z.iso.time({ precision: -1 }),
  reason: z.string().trim().min(10).max(500),
});
const manualAttendance = attendanceFields.extend({ date: z.iso.date() });

export async function recordManualAttendance(_: ActionState, form: FormData): Promise<ActionState> {
  if (!isAdministrator((await requireIdentity()).role)) return { error: "Administrator access required." };
  const parsed = manualAttendance.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter valid times and a reason of 10 to 500 characters." };
  const { employee, date, checkIn, checkOut, reason } = parsed.data;
  if (checkOut <= checkIn) return { error: "Check-out must be after check-in." };
  const client = await createClient();
  const { error } = await client.rpc("admin_record_manual_attendance", {
    p_employee: employee,
    p_work_date: date,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_reason: reason,
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  refreshAttendance();
  return { success: "Manual attendance saved." };
}

function refreshAttendance() {
  for (const path of ["/team-attendance", "/team-attendance/monthly", "/attendance", "/dashboard", "/reports"])
    revalidatePath(path);
}

export async function recordBulkAttendance(_: ActionState, form: FormData): Promise<ActionState> {
  if (!isAdministrator((await requireIdentity()).role)) return { error: "Administrator access required." };
  const parsed = attendanceFields.extend({ dates: z.array(z.iso.date()).min(1).max(31) }).safeParse({
    ...Object.fromEntries(form),
    dates: form.getAll("dates"),
  });
  if (!parsed.success) return { error: "Select dates and enter actual times and a reason of 10 to 500 characters." };
  const { employee, dates, checkIn, checkOut, reason } = parsed.data;
  if (checkOut <= checkIn) return { error: "Check-out must be after check-in." };
  const client = await createClient();
  const { error } = await client.rpc("admin_record_bulk_attendance", {
    p_employee: employee,
    p_dates: dates,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  refreshAttendance();
  return { success: `Attendance saved for ${dates.length} selected dates.` };
}
