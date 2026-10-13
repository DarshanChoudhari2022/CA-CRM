"use client";
import { useActionState } from "react";
import { collectionLink } from "./actions";
export function CollectionForm({ documents }: { documents: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(collectionLink, {});
  return (
    <form action={action} className="section">
      <label>
        Requested document
        <select name="document" required>
          <option value="">Choose a document</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>
      <button className="button button-secondary" disabled={pending} type="submit">
        {pending ? "Creating…" : "Create private upload link"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.url && (
        <>
          <p role="status">Valid for seven days and one upload. Share only with the intended client.</p>
          <label>
            Copy upload link
            <input readOnly value={state.url} onFocus={(e) => e.target.select()} />
          </label>
        </>
      )}
    </form>
  );
}
