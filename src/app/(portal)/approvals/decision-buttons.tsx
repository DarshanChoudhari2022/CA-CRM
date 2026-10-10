"use client";

import { useState, useTransition } from "react";
import { decide } from "./actions";

export function DecisionButtons({ kind, id }: { kind: "leave" | "attendance"; id: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const run = (decision: "approved" | "rejected") =>
    start(async () =>
      setMessage(
        (await decide(kind, id, decision, decision === "rejected" ? "Rejected by reviewer" : "")).error ?? "Saved",
      ),
    );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button type="button" className="button button-primary" disabled={pending} onClick={() => run("approved")}>
        Approve
      </button>
      <button type="button" className="button button-danger" disabled={pending} onClick={() => run("rejected")}>
        Reject
      </button>
      <span role="status" className="stat-note">
        {message}
      </span>
    </div>
  );
}
