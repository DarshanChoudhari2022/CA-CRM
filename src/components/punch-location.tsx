import type { PunchLocation as Location } from "@/modules/attendance/location";

export function PunchLocation({ value }: { value?: Location | null }) {
  if (!value) return <span className="stat-note">Not recorded</span>;
  return (
    <a
      href={`https://www.google.com/maps?q=${value.latitude},${value.longitude}`}
      target="_blank"
      rel="noreferrer"
      className="stat-note"
    >
      View location <small>(±{Math.round(value.accuracy)} m)</small>
    </a>
  );
}
