"use client";

import { useActionState } from "react";
import { addLeaveType, addPolicy } from "./actions";

export function SettingsForms() {
  const [leaveState, leaveAction, leavePending] = useActionState(addLeaveType, {});
  const [policyState, policyAction, policyPending] = useActionState(addPolicy, {});
  return (
    <section className="section grid grid-2">
      <form action={policyAction} className="card">
        <div className="section-title">
          <h2>New policy version</h2>
        </div>
        {policyState.error && <div className="form-error">{policyState.error}</div>}
        {policyState.success && <div className="status status-green">{policyState.success}</div>}
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="policyName">Name</label>
            <input id="policyName" name="name" required />
          </div>
          <div className="field">
            <label htmlFor="effectiveFrom">Effective from</label>
            <input id="effectiveFrom" name="effectiveFrom" type="date" required />
          </div>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="shiftStart">Shift start</label>
            <input id="shiftStart" name="shiftStart" type="time" defaultValue="10:30" required />
          </div>
          <div className="field">
            <label htmlFor="shiftEnd">Shift end</label>
            <input id="shiftEnd" name="shiftEnd" type="time" defaultValue="19:30" required />
          </div>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="grace">Grace minutes</label>
            <input id="grace" name="grace" type="number" defaultValue="15" min="0" required />
          </div>
          <div className="field">
            <label htmlFor="correctionWindow">Correction window</label>
            <input id="correctionWindow" name="correctionWindow" type="number" defaultValue="7" min="0" required />
          </div>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="fullDay">Full-day minutes</label>
            <input id="fullDay" name="fullDay" type="number" defaultValue="480" min="1" required />
          </div>
          <div className="field">
            <label htmlFor="halfDay">Half-day minutes</label>
            <input id="halfDay" name="halfDay" type="number" defaultValue="240" min="1" required />
          </div>
        </div>
        <button type="submit" className="button button-primary" disabled={policyPending}>
          {policyPending ? "Creating…" : "Create version"}
        </button>
      </form>
      <form action={leaveAction} className="card">
        <div className="section-title">
          <h2>Add leave type</h2>
        </div>
        {leaveState.error && <div className="form-error">{leaveState.error}</div>}
        {leaveState.success && <div className="status status-green">{leaveState.success}</div>}
        <div className="field">
          <label htmlFor="leaveName">Leave name</label>
          <input id="leaveName" name="name" placeholder="Compensatory Leave" required />
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="leaveCode">Code</label>
            <input id="leaveCode" name="code" placeholder="CO" required />
          </div>
          <div className="field">
            <label htmlFor="leaveDays">Annual allocation</label>
            <input id="leaveDays" name="days" type="number" step="0.5" min="0" required />
          </div>
        </div>
        <button type="submit" className="button button-primary" disabled={leavePending}>
          {leavePending ? "Creating…" : "Add leave type"}
        </button>
      </form>
    </section>
  );
}
