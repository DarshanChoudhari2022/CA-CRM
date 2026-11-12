"use client";

import { useActionState } from "react";
import { generateFilingDraft } from "./generate";

type Option = { id: string; label: string };
export function FilingForm({ filings, services }: { filings: Option[]; services: Option[] }) {
  const [state, action, pending] = useActionState(generateFilingDraft, {});
  return (
    <form action={action} className="billing-toolbar">
      <label>
        Filed record{" "}
        <select name="filing" required defaultValue="">
          <option value="" disabled>
            Choose a filing
          </option>
          {filings.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Billable service{" "}
        <select name="service" required defaultValue="">
          <option value="" disabled>
            Choose a service
          </option>
          {services.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="billing-button billing-primary"
        disabled={pending || !filings.length || !services.length}
      >
        {pending ? "Preparing…" : "Open invoice draft"}
      </button>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
    </form>
  );
}
