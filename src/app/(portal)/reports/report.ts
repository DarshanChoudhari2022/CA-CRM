import { z } from "zod";

export class ReportReadError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
  ) {
    super(message);
  }
}

export const monthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
export const summarySchema = z.object({
  expectedDays: z.number(),
  fullDays: z.number(),
  halfDays: z.number(),
  shortDays: z.number(),
  absentDays: z.number(),
  leaveDays: z.number(),
  incompleteDays: z.number(),
  totalHours: z.string(),
  isClosed: z.boolean(),
  blockers: z.number(),
});
export type ReportState = { error?: string; success?: string };
export function localMonth(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(
    now,
  );
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}
export function previousMonth(now: Date, timezone: string) {
  const [year, month] = localMonth(now, timezone).split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}
export function parseVersion(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new ReportReadError("Choose a valid report version.", 400);
  return Number(value);
}
export function reportError(message: string) {
  if (/resolve.*blocking|pending.*(correction|leave)|incomplete/i.test(message))
    return "Resolve incomplete attendance and pending requests in Attendance and Approvals, then refresh this month and retry.";
  if (/only completed months/i.test(message)) return "Only completed months can be closed. Select an earlier month.";
  if (/not closed|already.*closed/i.test(message))
    return "The month status changed. Refresh this month before retrying.";
  if (/forbidden|administrator|permission/i.test(message))
    return "Administrator access is required. Sign in with an authorized account.";
  return "Could not confirm the change. Refresh this month to check its status before retrying. Contact your administrator if it persists.";
}
const rowSchema = z.object({
  employeeCode: z.string(),
  employeeName: z.string(),
  department: z.string(),
  workDate: z.string(),
  context: z.string(),
  checkIn: z.string().nullable(),
  checkOut: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  result: z.string().nullable(),
  late: z.boolean(),
  earlyDeparture: z.boolean(),
});
export function attendanceCsv(
  rows: unknown,
  metadata: { month: string; timezone: string; generatedAt: string; version: number | null },
) {
  const cell = (value: unknown) => {
    let text = value == null ? "" : String(value);
    if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const headers = [
    "Employee code",
    "Employee name",
    "Department",
    "Work date",
    "Context",
    "Check-in",
    "Check-out",
    "Duration minutes",
    "Result",
    "Late",
    "Early departure",
    "Report month",
    "Timezone",
    "Generated at (UTC)",
    "Report version",
  ];
  return `\uFEFF${[
    headers.map(cell).join(","),
    ...z
      .array(rowSchema)
      .parse(rows)
      .map((r) =>
        [
          r.employeeCode,
          r.employeeName,
          r.department,
          r.workDate,
          r.context,
          r.checkIn,
          r.checkOut,
          r.durationMinutes,
          r.result,
          r.late,
          r.earlyDeparture,
          metadata.month,
          metadata.timezone,
          metadata.generatedAt,
          metadata.version ?? "live",
        ]
          .map(cell)
          .join(","),
      ),
  ].join("\r\n")}`;
}
