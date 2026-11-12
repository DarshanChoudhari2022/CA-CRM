"use client";

import { useActionState } from "react";
import { cancelInvoice } from "./actions";

export function CancelInvoiceForm({ invoice }: { invoice: string }) {
  const [state, action, pending] = useActionState(cancelInvoice, {});
  return (
    <details>
      <summary>Cancel invoice</summary>
      <form action={action}>
        <input type="hidden" name="invoice" value={invoice} />
        <label>
          Reason <input name="reason" required minLength={3} maxLength={250} />
        </label>
        <button type="submit" className="billing-button" disabled={pending}>
          {pending ? "Cancelling…" : "Confirm cancellation"}
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
