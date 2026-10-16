"use client";
import { useActionState } from "react";
import { updateEmployeeManager } from "./actions";

export function EmployeeManagerForm({
  employee,
  manager,
  managers,
}: {
  employee: string;
  manager: string;
  managers: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState(updateEmployeeManager, {});
  return (
    <form action={action} className="employee-access-form">
      <input name="employee" type="hidden" value={employee} />
      <label>
        Reporting manager
        <select name="manager" defaultValue={manager} aria-label="Reporting manager">
          <option value="">No manager</option>
          {!managers.some((person) => person.id === manager) && manager && (
            <option value={manager}>Current manager (inactive)</option>
          )}
          {managers.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      <button className="button button-secondary" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save manager"}
      </button>
      <small>Does not change account permissions.</small>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
    </form>
  );
}
