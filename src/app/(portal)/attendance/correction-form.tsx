"use client";

import { useActionState } from "react";
import { requestCorrection } from "./actions";

export function CorrectionForm() {
  const [state, action, pending] = useActionState(requestCorrection, {});
  return (
    <form action={action} className="card">
      <div className="section-title">
        <h2>Request a correction</h2>
      </div>
      {state.error && (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="status status-green" role="status">
          {state.success}
        </div>
      )}
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="workDate">Work date</label>
          <input id="workDate" name="workDate" type="date" required />
        </div>
        <div />
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="checkIn">Correct check-in</label>
          <input id="checkIn" name="checkIn" type="time" required />
        </div>
        <div className="field">
          <label htmlFor="checkOut">Correct check-out</label>
          <input id="checkOut" name="checkOut" type="time" required />
        </div>
      </div>
      <div className="field">
        <label htmlFor="reason">Reason</label>
        <textarea
          id="reason"
          name="reason"
          minLength={10}
          maxLength={500}
          required
          placeholder="Explain what needs to be corrected."
        />
      </div>
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
