"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Credentials = { email: string; password: string };

export function AccountButton({ employeeId, accountLinked }: { employeeId: string; accountLinked: boolean }) {
  const router = useRouter();
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const generatePassword = () =>
    start(async () => {
      setMessage("");
      const endpoint = accountLinked ? "/api/admin/accounts/reset" : "/api/admin/accounts";
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId }),
        });
        const body = await response.json();
        if (response.ok) setCredentials(body);
        else setMessage(body.error ?? "Password could not be generated.");
      } catch {
        setMessage("The account service could not be reached. Try again.");
      }
    });
  const shareCredentials = async () => {
    if (!credentials) return;
    const text = `PSB Workspace login\nLogin: ${window.location.origin}/login\nEmail: ${credentials.email}\nTemporary password: ${credentials.password}\nPlease change the password after your first login.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "PSB Workspace login", text });
        setMessage("Share dialog opened.");
      } else {
        await navigator.clipboard.writeText(text);
        setMessage("Credentials copied to clipboard.");
      }
    } catch {
      setMessage("Sharing was cancelled.");
    }
  };
  return (
    <div className="account-actions">
      {!credentials && (
        <button type="button" className="button button-secondary" disabled={pending} onClick={generatePassword}>
          {pending ? "Working…" : accountLinked ? "Change password" : "Create login"}
        </button>
      )}
      {credentials && (
        <div role="status">
          <strong>Temporary login ready</strong>
          <p>{credentials.email}</p>
          <p>
            <a href="/login" target="_blank" rel="noreferrer">
              Open login page
            </a>
          </p>
          <code style={{ overflowWrap: "anywhere" }}>{credentials.password}</code>
          <p className="stat-note">Share privately. The employee must change it on first login.</p>
          <div className="account-actions-row">
            <button className="button button-primary" type="button" onClick={shareCredentials}>
              Share credentials
            </button>
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
