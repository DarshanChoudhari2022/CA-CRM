"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function AccountButton({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <div>
      {!credentials && (
        <button
          type="button"
          className="button button-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMessage("");
              try {
                const response = await fetch("/api/admin/accounts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ employeeId }),
                });
                const body = await response.json();
                if (response.ok) setCredentials(body);
                else setMessage(body.error);
              } catch {
                setMessage("Account creation could not be reached. Check the employee account status before retrying.");
              }
            })
          }
        >
          {pending ? "Creating…" : "Create login"}
        </button>
      )}
      {credentials && (
        <div role="status">
          <strong>Login created</strong>
          <p>{credentials.email}</p>
          <code style={{ overflowWrap: "anywhere" }}>{credentials.password}</code>
          <p className="stat-note">
            Shown once. Share privately with this employee. They must change it on first login.
          </p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              setCredentials(null);
              router.refresh();
            }}
          >
            Done
          </button>
        </div>
      )}
      {message && (
        <div className="stat-note" role="alert">
          {message}
        </div>
      )}
    </div>
  );
}
