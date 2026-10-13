"use client";
import { useActionState } from "react";
import { closeMonth, reopenMonth } from "./actions";

export function MonthActions({
  month,
  closed,
  blocked,
  completed,
}: {
  month: string;
  closed: boolean;
  blocked: boolean;
  completed: boolean;
}) {
  const [state, action, pending] = useActionState(closed ? reopenMonth : closeMonth, {});
  return (
    <form action={action} className="card section">
      <h2>{closed ? "Reopen month" : "Close month"}</h2>
      <input type="hidden" name="month" value={month} />
      {closed ? (
        <div className="field">
          <label htmlFor="reopen-reason">Why must this month be reopened?</label>
          <textarea id="reopen-reason" name="reason" minLength={10} maxLength={500} required disabled={pending} />
          <p className="stat-note">Reopening permits corrections. Previous report versions remain saved.</p>
        </div>
      ) : (
        <p>Closing saves an immutable report version and locks attendance changes.</p>
      )}
      {!completed && <p role="status">Only completed months can be closed or reopened.</p>}
      {!closed && blocked && (
        <p role="status">Resolve incomplete attendance and pending requests, then refresh before closing.</p>
      )}
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
      <button className="button button-primary" type="submit" disabled={pending || !completed || (!closed && blocked)}>
        {pending ? "Saving…" : closed ? "Reopen month" : "Close month"}
      </button>
    </form>
  );
}
