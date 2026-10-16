import { automationStore } from "@/modules/crm/automation/store";
import { leaveWeb3FormsKey } from "./email-config";
import type { LeaveEmailDelivery } from "./email-delivery";

type LeaveNotice = {
  id: string;
  lease: string;
  employee: string;
  email: string;
  leaveType: string;
  start: string;
  end: string;
  days: number;
  reason: string;
  requestId: string;
};

export function leaveEmailPayload(notice: LeaveNotice, accessKey: string) {
  return {
    access_key: accessKey,
    subject: `PSB leave application: ${notice.employee}`,
    from_name: "PSB Attendance",
    replyto: notice.email,
    name: notice.employee,
    email: notice.email,
    leave_type: notice.leaveType,
    start_date: notice.start,
    end_date: notice.end,
    working_days: String(notice.days),
    reason: notice.reason,
    request_reference: notice.requestId,
    message: `${notice.employee} has applied for ${notice.leaveType}.\nDates: ${notice.start} to ${notice.end}\nWorking days: ${notice.days}\nReason: ${notice.reason}\nRequest: ${notice.requestId}\nReview in PSB Workspace > Attendance > Approvals.`,
  };
}

export async function sendLeaveNotification(organization: string, request?: string) {
  const key = leaveWeb3FormsKey();
  if (!key || process.env.LEAVE_WEB3FORMS_SERVER_ENABLED !== "true") return "pending" as const;
  const store = automationStore();
  const claimed = await store.rpc("claim_leave_email", { p_org: organization, p_request: request ?? null });
  if (claimed.error) throw new Error("Leave notification queue unavailable");
  const notice = claimed.data as LeaveNotice | null;
  if (!notice) return "empty" as const;
  let state: "sent" | "failed" | "uncertain" = "uncertain";
  try {
    const response = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(leaveEmailPayload(notice, key)),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    state =
      response.ok && body?.success === true
        ? "sent"
        : response.status >= 400 && response.status < 500
          ? "failed"
          : "uncertain";
  } catch {
    /* Delivery could have succeeded before the connection failed. */
  }
  const saved = await store
    .from("leave_email_notifications")
    .update({
      state,
      sent_at: state === "sent" ? new Date().toISOString() : null,
      last_error:
        state === "sent"
          ? null
          : state === "failed"
            ? "Web3Forms rejected this request. Check the access key and recipient configuration."
            : "Delivery could not be confirmed. Check the mailbox before retrying.",
    })
    .eq("id", notice.id)
    .eq("lease_id", notice.lease)
    .eq("state", "sending");
  if (saved.error) throw new Error("Leave delivery status could not be saved");
  return state;
}

export async function prepareLeaveNotification(
  organization: string,
  request: string,
): Promise<LeaveEmailDelivery | undefined> {
  const key = leaveWeb3FormsKey();
  if (!key) return;
  const { data, error } = await automationStore().rpc("claim_leave_email", { p_org: organization, p_request: request });
  if (error) throw new Error("Leave notification queue unavailable");
  if (!data) return;
  const notice = data as LeaveNotice;
  // Web3Forms access keys are designed to be included in browser form submissions.
  return { id: notice.id, lease: notice.lease, payload: leaveEmailPayload(notice, key) };
}
