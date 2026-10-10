"use client";

import { useActionState } from "react";
import { addEmployee } from "./actions";

type Option = { id: string; name: string };
export function EmployeeForm({ options }: { options: { branches: Option[]; policies: Option[]; managers: Option[] } }) {
  const [state, action, pending] = useActionState(addEmployee, {});
  return (
    <form action={action} className="card section">
      <div className="section-title">
        <h2>Add employee</h2>
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
          <label htmlFor="code">Employee code</label>
          <input id="code" name="code" required />
        </div>
        <div className="field">
          <label htmlFor="name">Full name</label>
          <input id="name" name="name" required />
        </div>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div className="field">
          <label htmlFor="department">Department</label>
          <input id="department" name="department" defaultValue="General" required />
        </div>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="branchId">Branch</label>
          <select id="branchId" name="branchId" required>
            {options.branches.map((o) => (
              <option value={o.id} key={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="policyId">Policy</label>
          <select id="policyId" name="policyId" required>
            {options.policies.map((o) => (
              <option value={o.id} key={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="managerId">Reporting manager</label>
          <select id="managerId" name="managerId">
            <option value="">Not assigned</option>
            {options.managers.map((o) => (
              <option value={o.id} key={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="joinedOn">Joining date</label>
          <input id="joinedOn" name="joinedOn" type="date" required />
        </div>
      </div>
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending ? "Creating…" : "Create employee"}
      </button>
    </form>
  );
}
