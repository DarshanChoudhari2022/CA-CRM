"use client";

import { useActionState } from "react";
import { submitLeave } from "./actions";

export function LeaveForm({ types }: { types: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(submitLeave, {});
  return (
    <form action={action} className="card">
      <div className="section-title">
        <h2>Request leave</h2>
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
      <div className="field">
        <label htmlFor="leaveTypeId">Leave type</label>
        <select id="leaveTypeId" name="leaveTypeId" required>
          <option value="">Select leave type</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="startDate">From</label>
          <input id="startDate" name="startDate" type="date" required />
        </div>
        <div className="field">
          <label htmlFor="endDate">To</label>
          <input id="endDate" name="endDate" type="date" required />
        </div>
      </div>
      <div className="field">
        <label htmlFor="portion">Duration</label>
        <select id="portion" name="portion">
          <option value="full_day">Full day(s)</option>
          <option value="first_half">First half</option>
          <option value="second_half">Second half</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="leaveReason">Reason</label>
        <textarea id="leaveReason" name="reason" minLength={10} maxLength={500} required />
      </div>
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending ? "Submitting…" : "Send for approval"}
      </button>
    </form>
  );
}
