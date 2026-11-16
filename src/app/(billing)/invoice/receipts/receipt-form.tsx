"use client";

import { useActionState, useState } from "react";
import { recordReceipt } from "./actions";

export function ReceiptForm({ invoice, outstanding }: { invoice: string; outstanding: number }) {
  const [state, action, pending] = useActionState(recordReceipt.bind(null, invoice), {});
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  return (
    <form action={action} className="billing-toolbar">
      <label className="grid gap-1">
        Amount (₹)
        <input
          name="amount"
          type="number"
          min="0.01"
          max={outstanding / 100}
          step="0.01"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className="grid gap-1">
        Payment reference
        <input
          name="reference"
          minLength={3}
          maxLength={120}
          required
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </label>
      <button type="submit" className="billing-button billing-primary" disabled={pending || Boolean(state.success)}>
        {pending ? "Recording…" : "Record payment"}
      </button>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status">
          {state.success}{" "}
          <a className="underline" href={`/invoice/receipts?invoice=${invoice}`}>
            Record another
          </a>
        </p>
      )}
    </form>
  );
}
