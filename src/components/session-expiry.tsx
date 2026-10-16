"use client";
import { useEffect } from "react";

export function SessionExpiry({ deadline }: { deadline?: string }) {
  useEffect(() => {
    if (!deadline) return;
    const expires = Date.parse(deadline);
    if (!Number.isFinite(expires)) return;
    const check = () => {
      if (Date.now() >= expires) window.location.replace("/api/auth/session-expired");
    };
    const timer = window.setTimeout(check, Math.max(0, expires - Date.now()));
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [deadline]);
  return null;
}
