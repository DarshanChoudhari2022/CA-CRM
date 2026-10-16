"use client";
import { useActionState } from "react";
import { updateEmployeeAccess } from "./actions";

export function EmployeeAccessForm({
  employee,
  role,
  active,
  linked,
}: {
  employee: string;
  role: string;
  active: boolean;
  linked: boolean;
}) {
  const [state, action, pending] = useActionState(updateEmployeeAccess, {});
  return (
    <details>
      <summary>Manage access</summary>
      <form action={action} className="section" style={{ minWidth: 180 }}>
        <input type="hidden" name="employee" value={employee} />
        <label>
          Role
          <select name="role" defaultValue={role} aria-label="Employee role">
            <option value="employee">Employee</option>
            {linked && <option value="admin">Administrator</option>}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={active ? "active" : "inactive"} aria-label="Employee status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <button className="button button-secondary" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save access"}
        </button>
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
        {state.success && <p role="status">{state.success}</p>}
      </form>
    </details>
  );
}
