"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";
import { reportTimezone } from "./data";
import { localMonth, monthSchema, type ReportState, reportError } from "./report";

async function changeMonth(form: FormData, reopen: boolean): Promise<ReportState> {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) return { error: "Administrator access is required." };
  const parsed = monthSchema.safeParse(form.get("month"));
  if (!parsed.success) return { error: "Choose a valid month (YYYY-MM)." };
  const reason = String(form.get("reason") ?? "").trim();
  if (reopen && (reason.length < 10 || reason.length > 500))
    return { error: "Explain why the month must be reopened in 10–500 characters." };
  try {
    const timezone = await reportTimezone(identity);
    if (parsed.data >= localMonth(new Date(), timezone))
      return { error: "Select a completed month before closing or reopening." };
    const { error } = await (await createClient()).rpc(reopen ? "reopen_attendance_month" : "close_attendance_month", {
      p_month: parsed.data,
      p_request_id: crypto.randomUUID(),
      ...(reopen ? { p_reason: reason } : {}),
    });
    if (error) return { error: reportError(error.message) };
  } catch {
    return { error: reportError("") };
  }
  revalidatePath("/reports");
  revalidatePath("/attendance");
  return {
    success: reopen
      ? `${parsed.data} reopened. Previous snapshots remain available.`
      : `${parsed.data} closed and a report snapshot saved.`,
  };
}
export async function closeMonth(_: ReportState, form: FormData) {
  return changeMonth(form, false);
}
export async function reopenMonth(_: ReportState, form: FormData) {
  return changeMonth(form, true);
}
