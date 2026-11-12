"use client";

import { useActionState } from "react";
import { recordManualAttendance } from "./actions";

export function ManualAttendanceForm({ employee, date }: { employee: string; date: string }) {
  const [state, action, pending] = useActionState(recordManualAttendance, {});
  return (
    <details>
      <summary>Mark attendance manually</summary>
      <form action={action} className="section">
        <input type="hidden" name="employee" value={employee} />
        <input type="hidden" name="date" value={date} />
        <div className="field">
          <label>
            Actual check-in
            <input type="time" name="checkIn" required />
          </label>
        </div>
        <div className="field">
          <label>
            Actual check-out
            <input type="time" name="checkOut" required />
          </label>
        </div>
        <div className="field">
          <label>
            Reason
            <textarea name="reason" minLength={10} maxLength={500} required />
          </label>
        </div>
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? "Saving…" : "Save attendance"}
        </button>
      </form>
    </details>
  );
}
