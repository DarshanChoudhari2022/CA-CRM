"use client";

import { useActionState } from "react";
import { cancelInvoice } from "./actions";

export function CancelInvoiceForm({ invoice, operation }: { invoice: string; operation: "delete" | "cancel" }) {
  const [state, action, pending] = useActionState(cancelInvoice, {});
  return (
    <details>
      <summary>{operation === "delete" ? "Delete draft" : "Cancel invoice"}</summary>
      <form action={action}>
        <input type="hidden" name="invoice" value={invoice} />
        <input type="hidden" name="operation" value={operation} />
        <label className="field">
          Reason <input name="reason" required minLength={3} maxLength={250} />
        </label>
        <label className="field">
          Current password
          <input type="password" name="password" autoComplete="current-password" required maxLength={128} />
        </label>
        <button type="submit" className="billing-button" disabled={pending}>
          {pending ? "Saving…" : operation === "delete" ? "Confirm delete" : "Confirm cancellation"}
        </button>
        {state.error && (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        )}
      </form>
    </details>
  );
}
