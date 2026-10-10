import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
];
type Row = {
  employeeCode: string;
  employeeName: string;
  department: string;
  workDate: string;
  context: string;
  checkIn: string | null;
  checkOut: string | null;
  durationMinutes: number | null;
  result: string | null;
  late: boolean;
  earlyDeparture: boolean;
};

function cell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attendance_export_rows", { p_month: month });
  if (error) return NextResponse.json({ error: "Report unavailable" }, { status: 403 });
  const rows = (data ?? []) as Row[];
  const csv = [
    headers.map(cell).join(","),
    ...rows.map((r) =>
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
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="psb-attendance-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
