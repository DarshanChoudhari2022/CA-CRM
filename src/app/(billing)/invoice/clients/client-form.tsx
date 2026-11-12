"use client";

import { useActionState, useState } from "react";
import { saveBillingClient } from "./actions";

type EditableClient = {
  id: string;
  updated_at: string;
  title: string;
  status: string;
  email: string | null;
  phone: string | null;
  notes: string;
};

export function ClientForm({ client }: { client?: EditableClient }) {
  const [state, action, pending] = useActionState(
    saveBillingClient.bind(null, client ? { id: client.id, updatedAt: client.updated_at } : null),
    {},
  );
  const [title, setTitle] = useState(client?.title ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [status, setStatus] = useState(client?.status ?? "active");
  const [notes, setNotes] = useState(client?.notes ?? "");

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          Client name
          <input
            name="title"
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1">
          Status
          <select name="status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="grid gap-1">
          Email
          <input
            name="email"
            type="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="grid gap-1">
          Phone
          <input
            name="phone"
            type="tel"
            maxLength={40}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
      </div>
      <label className="grid gap-1">
        Notes
        <textarea
          name="notes"
          rows={3}
          maxLength={4000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      <div>
        <button type="submit" className="billing-button billing-primary" disabled={pending}>
          {pending ? "Saving…" : "Save client"}
        </button>
      </div>
    </form>
  );
}
