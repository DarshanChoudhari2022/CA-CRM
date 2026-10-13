"use client";

import { useState, useTransition } from "react";
import { decide } from "./actions";

export function DecisionButtons({
  kind,
  id,
  stale = false,
}: {
  kind: "leave" | "attendance";
  id: string;
  stale?: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const run = (decision: "approved" | "rejected") =>
    start(async () => {
      const result = await decide(kind, id, decision, decision === "rejected" ? reason : "");
      setMessage(result.error ?? "Saved");
      if (!result.error) window.dispatchEvent(new Event("approvals-changed"));
    });
  return (
    <div className="approval-actions">
      <div className="ai-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={pending || stale}
          onClick={() => run("approved")}
        >
          Approve
        </button>
        <button
          type="button"
          className="button button-danger"
          disabled={pending}
          onClick={() => setRejecting(!rejecting)}
          aria-expanded={rejecting}
        >
          Reject
        </button>
      </div>
      {rejecting && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run("rejected");
          }}
        >
          <label className="field">
            Rejection reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={500}
              required
              rows={2}
              disabled={pending}
            />
          </label>
          <button className="button button-danger" type="submit" disabled={pending || reason.trim().length < 3}>
            Confirm rejection
          </button>
        </form>
      )}
      <span role="status" className="stat-note">
        {message}
      </span>
    </div>
  );
}
