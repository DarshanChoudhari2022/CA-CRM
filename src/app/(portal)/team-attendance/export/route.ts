import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  type AttendanceRegister,
  type RegisterRow,
  registerArgs,
  registerFilters,
} from "@/modules/attendance/register";
import { requireIdentity } from "@/modules/identity/session";
import { reportTimezone } from "../../reports/data";

export async function GET(request: Request) {
  const identity = await requireIdentity();
  if (identity.role === "employee") return new NextResponse("Manager or administrator required", { status: 403 });
  const parsed = registerFilters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return new NextResponse("Check the register filters", { status: 400 });
  const client = await createClient();
  const zone = await reportTimezone(identity);
  const rows: RegisterRow[] = [];
  for (let page = 1; page <= 200; page++) {
    const result = await client.rpc("attendance_register", registerArgs({ ...parsed.data, page }));
    if (result.error) return new NextResponse("Register export unavailable", { status: 503 });
    const register = result.data as AttendanceRegister;
    if (register.total > 10000) return new NextResponse("Narrow filters to 10,000 employees or fewer", { status: 413 });
    rows.push(...register.items);
    if (page * 50 >= register.total) break;
  }
  const cell = (value: unknown) =>
    `"${String(value ?? "")
      .replace(/^\s*[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const local = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: zone }) : "");
  const csv = [
    [
      "Date",
      "Employee code",
      "Employee",
      "Branch",
      "Department",
      "Day",
      "In",
      "Out",
      "Minutes",
      "Result",
      "Late",
      "Timezone",
    ]
      .map(cell)
      .join(","),
    ...rows.map((row) =>
      [
        parsed.data.date,
        row.employee_code,
        row.full_name,
        row.branch,
        row.department,
        row.context,
        local(row.check_in_at),
        local(row.check_out_at),
        row.duration_minutes,
        row.result,
        row.is_late,
        zone,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="team-attendance-${parsed.data.date}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Report-Timezone": zone,
      "X-Report-Generated-At": new Date().toISOString(),
    },
  });
}
