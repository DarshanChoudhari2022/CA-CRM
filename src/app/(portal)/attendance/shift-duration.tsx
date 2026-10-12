"use client";
import { useEffect, useState } from "react";
import { formatWorkedMinutes, runningWorkedMinutes } from "@/modules/attendance/duration";
export function ShiftDuration({
  checkIn,
  checkOut,
  serverNow,
  durationMinutes,
}: {
  checkIn: string | null;
  checkOut: string | null;
  serverNow: string;
  durationMinutes: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!checkIn || checkOut || !Number.isFinite(Date.parse(serverNow))) return;
    const start = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - start), 15000);
    return () => clearInterval(timer);
  }, [checkIn, checkOut, serverNow]);
  if (!checkIn) return null;
  const minutes = checkOut ? durationMinutes : runningWorkedMinutes(checkIn, serverNow, elapsed);
  return (
    <div className="shift-total">
      <span>{checkOut ? "Time worked today" : "Time worked so far"}</span>
      <strong>{formatWorkedMinutes(minutes)}</strong>
      <small>Check-in to check-out · breaks are not deducted</small>
    </div>
  );
}
