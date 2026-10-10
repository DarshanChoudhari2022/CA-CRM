"use client";

import { useState, useTransition } from "react";

export function InviteButton({ employeeId }: { employeeId: string }) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <div>
      <button
        type="button"
        className="button button-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const response = await fetch("/api/admin/invite", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ employeeId, role: "employee" }),
            });
            const body = await response.json();
            setMessage(response.ok ? "Invitation sent." : body.error);
          })
        }
      >
        {pending ? "Sending…" : "Invite"}
      </button>
      {message && (
        <div className="stat-note" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
