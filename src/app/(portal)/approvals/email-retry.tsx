"use client";
import { useActionState } from "react";
import { deliverLeaveEmail } from "@/modules/leave/email-delivery";
import { finishLeaveEmail, type LeaveState, retryLeaveEmail } from "../leave/actions";

export function EmailRetry({ id }: { id: string }) {
  const [state, action, pending] = useActionState(async (previous: LeaveState, form: FormData): Promise<LeaveState> => {
    const result = await retryLeaveEmail(previous, form);
    if (!result.notification) return result;
    const outcome = await deliverLeaveEmail(result.notification);
    let saved = false;
    try {
      saved = await finishLeaveEmail(result.notification.id, result.notification.lease, outcome);
    } catch {
      /* Display a recoverable result below. */
    }
    return {
      success:
        outcome === "sent" && saved
          ? "Accepted for delivery."
          : "Delivery could not be confirmed. Check the office mailbox.",
    };
  }, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="button button-secondary" disabled={pending} type="submit">
        {pending ? "Sending…" : "Send office email"}
      </button>
      <small className="stat-note">Check the mailbox before resending.</small>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
    </form>
  );
}
