"use client";
import { useActionState } from "react";
import { saveWork } from "./actions";

export type WorkItem = { id: string; title: string; notes: string; status: string; work_date: string };
export function WorkForm({ item }: { item?: WorkItem }) {
  const [state, action, pending] = useActionState(saveWork, {});
  return (
    <form action={action} className="card">
      <input type="hidden" name="id" value={item?.id ?? ""} />
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
        <label htmlFor={`title-${item?.id ?? "new"}`}>Work planned</label>
        <input id={`title-${item?.id ?? "new"}`} name="title" defaultValue={item?.title} maxLength={200} required />
      </div>
      <div className="field">
        <label htmlFor={`notes-${item?.id ?? "new"}`}>Notes / end-of-day update</label>
        <textarea id={`notes-${item?.id ?? "new"}`} name="notes" defaultValue={item?.notes} maxLength={2000} />
      </div>
      <div className="field">
        <label htmlFor={`status-${item?.id ?? "new"}`}>Progress</label>
        <select id={`status-${item?.id ?? "new"}`} name="status" defaultValue={item?.status ?? "planned"}>
          <option value="planned">Planned</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="blocked">Blocked</option>
        </select>
      </div>
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending ? "Saving…" : item ? "Save update" : "Add work"}
      </button>
    </form>
  );
}
