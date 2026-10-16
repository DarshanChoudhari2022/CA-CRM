"use client";

import { LogIn, LogOut } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { capturePunchLocation } from "@/modules/attendance/location";
import { punch } from "./actions";

export function PunchButton({ canCheckIn, canCheckOut }: { canCheckIn: boolean; canCheckOut: boolean }) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const request = useRef<{ kind: string; id: string } | null>(null);
  const kind = canCheckIn ? "check_in" : canCheckOut ? "check_out" : null;
  if (!kind)
    return (
      <div style={{ textAlign: "center" }}>
        <StatusText>{message || "Attendance complete for today."}</StatusText>
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
            if (request.current?.kind !== kind) request.current = { kind, id: crypto.randomUUID() };
            try {
              setMessage("Getting your location…");
              const location = await capturePunchLocation();
              const result = await punch(kind, request.current.id, location);
              setMessage(result.error ?? result.success ?? "");
              if (result.success) request.current = null;
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "Could not confirm attendance. Refresh before retrying.",
              );
            }
          })
        }
      >
        <Icon size={18} />
        {pending ? "Saving…" : kind === "check_in" ? "Check in now" : "Check out now"}
      </button>
      <p className="stat-note" style={{ color: "#c7d4dd" }}>
        Your location is recorded with each check-in and check-out.
      </p>
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
