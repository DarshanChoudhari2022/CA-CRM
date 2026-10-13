export function StatusPill({ value }: { value: string }) {
  const state = value.toLowerCase().replaceAll(" ", "_");
  const tone = [
    "approved",
    "leave_approved",
    "half_day_leave_approved",
    "present",
    "full_day",
    "complete",
    "completed",
    "active",
    "done",
    "resolved",
    "filed",
    "paid",
    "ready",
  ].includes(state)
    ? "green"
    : [
          "pending",
          "late",
          "open",
          "incomplete",
          "in_progress",
          "half_day",
          "short_day",
          "needs_review",
          "running",
        ].includes(state)
      ? "amber"
      : ["rejected", "absent", "cancelled", "failed", "inactive", "blocked", "overdue"].includes(state)
        ? "red"
        : "blue";
  return <span className={`status status-${tone}`}>{value.replaceAll("_", " ")}</span>;
}
