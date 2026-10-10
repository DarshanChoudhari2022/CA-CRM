"use client";

import { LogIn, LogOut } from "lucide-react";
import { useState, useTransition } from "react";
import { punch } from "./actions";

export function PunchButton({ canCheckIn, canCheckOut }: { canCheckIn: boolean; canCheckOut: boolean }) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const kind = canCheckIn ? "check_in" : canCheckOut ? "check_out" : null;
  if (!kind)
    return (
      <div style={{ textAlign: "center" }}>
        <StatusText>Attendance complete for today.</StatusText>
      </div>
    );
  const Icon = kind === "check_in" ? LogIn : LogOut;
  return (
    <div style={{ width: "100%", textAlign: "center" }}>
      <button
        type="button"
        className="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await punch(kind, crypto.randomUUID());
            setMessage(result.error ?? result.success ?? "");
          })
        }
      >
        <Icon size={18} />
        {pending ? "Saving…" : kind === "check_in" ? "Check in now" : "Check out now"}
      </button>
      {message && <StatusText>{message}</StatusText>}
    </div>
  );
}

function StatusText({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" style={{ color: "#c7d4dd", fontSize: 13 }}>
      {children}
    </p>
  );
}
