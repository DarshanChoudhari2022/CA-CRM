"use client";

import { useActionState } from "react";
import { allocateAdvance, recordAdvance } from "./advance-actions";

type Option = { id: string; label: string };
export function AdvanceForm({ clients, today }: { clients: Option[]; today: string }) {
  const [state, action, pending] = useActionState(recordAdvance, {});
  return (
    <details>
      <summary>Record advance / on-account payment</summary>
      <form action={action} className="billing-grid">
        <label className="field">
          Client
          <select name="client" defaultValue="" required>
            <option value="" disabled>
              Choose a client
            </option>
            {clients.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Date
          <input type="date" name="date" defaultValue={today} max={today} required />
        </label>
        <label className="field">
          Amount (₹)
          <input name="amount" type="number" step="0.01" min="0.01" required />
        </label>
        <label className="field">
          Payment mode
          <select name="mode" defaultValue="NEFT">
            {["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Cash", "Other"].map((mode) => (
              <option key={mode}>{mode}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Reference
          <input name="reference" minLength={3} maxLength={100} required />
        </label>
        <label className="field">
          Remarks
          <input name="remarks" maxLength={150} />
        </label>
        <div>
          <button type="submit" className="billing-button billing-primary" disabled={pending || !clients.length}>
            {pending ? "Recording…" : "Record advance"}
          </button>
        </div>
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
      </form>
    </details>
  );
}

export function AllocateAdvanceForm({
  id,
  request,
  balance,
  invoices,
}: {
  id: string;
  request: string;
  balance: number;
  invoices: Option[];
}) {
  const [state, action, pending] = useActionState(allocateAdvance, {});
  return (
    <form action={action} className="billing-toolbar">
      <input type="hidden" name="advance" value={id} />
      <input type="hidden" name="request" value={request} />
      <label>
        Invoice{" "}
        <select name="invoice" defaultValue="" required>
          <option value="" disabled>
            Choose an invoice
          </option>
          {invoices.map(({ id: invoiceId, label }) => (
            <option key={invoiceId} value={invoiceId}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount (₹) <input name="amount" type="number" step="0.01" min="0.01" max={balance} required />
      </label>
      <button type="submit" className="billing-button billing-primary" disabled={pending || !invoices.length}>
        {pending ? "Allocating…" : "Apply advance"}
      </button>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
    </form>
  );
}
