export function formatWorkedMinutes(value: number): string {
  const minutes = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function runningWorkedMinutes(checkIn: string | null, serverNow: string, elapsedMs: number): number {
  if (!checkIn) return 0;
  const milliseconds = Date.parse(serverNow) - Date.parse(checkIn) + Math.max(0, elapsedMs);
  return Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 60000)) : 0;
}
