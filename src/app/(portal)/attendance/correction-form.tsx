"use client";

import { useActionState, useState } from "react";
import { type ActionState, requestCorrection } from "./actions";

export function CorrectionForm({ today }: { today: string }) {
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const invalidTimeOrder = Boolean(checkIn && checkOut && checkOut <= checkIn);
  const [state, action, pending] = useActionState(async (previous: ActionState, data: FormData) => {
    const result = await requestCorrection(previous, data);
    if (result.success) {
      setCheckIn("");
      setCheckOut("");
    }
    return result;
  }, {});
  return (
    <form action={action} className="card" id="missed-attendance">
      <div className="section-title">
        <h2>Missed a check-in or check-out?</h2>
      </div>
      <p>Enter the times you actually worked and send the request to your administrator for review.</p>
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
          <input id="workDate" name="workDate" type="date" max={today} required />
        </div>
        <div />
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="checkIn">Actual check-in</label>
          <input
            id="checkIn"
            name="checkIn"
            type="time"
            value={checkIn}
            onChange={(event) => setCheckIn(event.currentTarget.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="checkOut">Actual check-out</label>
          <input
            id="checkOut"
            name="checkOut"
            type="time"
            value={checkOut}
            onChange={(event) => setCheckOut(event.currentTarget.value)}
            aria-invalid={invalidTimeOrder || undefined}
            aria-describedby={invalidTimeOrder ? "check-out-error" : undefined}
            required
          />
          {invalidTimeOrder && (
            <p id="check-out-error" role="alert" className="form-error">
              Check-out must be after check-in.
            </p>
          )}
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
      <button type="submit" className="button button-primary" disabled={pending || invalidTimeOrder}>
        {pending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
