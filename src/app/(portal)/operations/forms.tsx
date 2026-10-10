"use client";
import { useActionState, useState } from "react";
import { operation } from "./actions";

type Option = {
  id: string;
  name: string;
  manager?: string | null;
  department?: string;
  active?: boolean;
  lastDate?: string | null;
  role?: string;
};
export function OperationForm({
  kind,
  employees,
  branches,
}: {
  kind: "holiday" | "employee" | "excuse";
  employees: Option[];
  branches: Option[];
}) {
  const [state, action, pending] = useActionState(operation, {});
  const [selected, setSelected] = useState("");
  const employee = employees.find((e) => e.id === selected);
  return (
    <form action={action} className="card">
      <h2>
        {kind === "holiday" ? "Add branch holiday" : kind === "employee" ? "Update employee access" : "Excused absence"}
      </h2>
      <input type="hidden" name="operation" value={kind} />
      {kind === "holiday" ? (
        <>
          <div className="field">
            <label>
              Branch
              <select name="branch" required>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Holiday name
              <input name="name" required maxLength={100} />
            </label>
          </div>
        </>
      ) : (
        <div className="field">
          <label>
            Employee
            <select name="employee" required value={selected} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Choose employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {kind === "employee" ? (
        <div key={selected}>
          <div className="field">
            <label>
              Manager
              <select name="manager" defaultValue={employee?.manager ?? ""}>
                <option value="">None</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Department
              <input name="department" required maxLength={100} defaultValue={employee?.department ?? ""} />
            </label>
          </div>
          <div className="field">
            <label>
              Role
              <select name="role" defaultValue={employee?.role ?? "employee"}>
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="admin">Administrator</option>
                <option value="partner">Partner</option>
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Status
              <select name="active" defaultValue={employee?.active === false ? "false" : "true"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Last working date
              <input name="lastDate" type="date" defaultValue={employee?.lastDate ?? ""} />
            </label>
          </div>
        </div>
      ) : (
        <div className="field">
          <label>
            Date
            <input name="date" type="date" required />
          </label>
        </div>
      )}
      {kind === "excuse" && (
        <>
          <div className="field">
            <label>
              Reason
              <textarea name="reason" minLength={10} maxLength={500} required />
            </label>
          </div>
          <div className="field">
            <label>
              Action
              <select name="remove">
                <option value="false">Mark excused</option>
                <option value="true">Remove annotation</option>
              </select>
            </label>
          </div>
        </>
      )}
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
      <button className="button button-primary" type="submit" disabled={pending}>
        Save
      </button>
    </form>
  );
}
export function CancelRequest({ id, kind }: { id: string; kind: "leave" | "attendance" }) {
  const [state, action, pending] = useActionState(operation, {});
  return (
    <form action={action}>
      <input name="operation" type="hidden" value="cancel" />
      <input name="kind" type="hidden" value={kind} />
      <input name="id" type="hidden" value={id} />
      <button className="button button-secondary" type="submit" disabled={pending}>
        Cancel request
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
