import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { createClient } from "@/lib/supabase/server";
import { isAdministrator } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";
import { loadReport, reportTimezone } from "../../reports/data";
import { EmployeeTotals } from "../../reports/employee-totals";
import { localMonth, monthSchema, ReportReadError } from "../../reports/report";
import { ManualAttendanceForm } from "../manual-attendance-form";
import { AttendanceCalendar, type CalendarDay } from "./calendar";

const reportDay = z.object({
  employeeCode: z.string(),
  workDate: z.iso.date(),
  checkIn: z.string().nullable(),
  checkOut: z.string().nullable(),
  result: z.string().nullable(),
  context: z.string(),
});

export default async function MonthlyAttendance({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; employee?: string; date?: string }>;
}) {
  const identity = await requireIdentity();
  if (!isAdministrator(identity.role)) redirect("/dashboard");
  const query = await searchParams;
  const zone = await reportTimezone(identity);
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(now);
  const currentMonth = localMonth(now, zone);
  const month = query.month ?? currentMonth;
  if (!monthSchema.safeParse(month).success || month > currentMonth) redirect("/team-attendance/monthly");
  let report: Awaited<ReturnType<typeof loadReport>>;
  try {
    report = await loadReport(identity, month, null, Boolean(query.employee), true);
  } catch (error) {
    if (!(error instanceof ReportReadError)) throw error;
    return (
      <p className="form-error" role="alert">
        {error.message}
      </p>
    );
  }
  const employee = report.employees.find((row) => row.employee_code === query.employee);
  return (
    <>
      <PageHead
        eyebrow="Attendance"
        title="Monthly attendance"
        description="Review attendance and correct missed days before payroll."
        action={
          <Link className="button button-secondary" href={`/reports?month=${month}`}>
            Attendance reports
          </Link>
        }
      />
      <section className="card">
        <form className="register-filters" method="get">
          {employee && <input type="hidden" name="employee" value={employee.employee_code} />}
          <label>
            Month
            <input type="month" name="month" defaultValue={month} max={currentMonth} required />
          </label>
          <button className="button button-primary" type="submit">
            View month
          </button>
        </form>
        {report.live.isClosed && (
          <p>This month is closed. Reopen it from Attendance reports before making corrections.</p>
        )}
      </section>
      {employee ? (
        <EmployeeCalendar
          employee={employee}
          report={report}
          month={month}
          today={today}
          selected={query.date}
          organizationId={identity.organizationId}
          administratorEmployeeId={identity.employeeId}
        />
      ) : (
        <EmployeeTotals rows={report.employees} snapshot={report.live.isClosed} calendarMonth={month} />
      )}
    </>
  );
}

async function EmployeeCalendar({
  employee,
  report,
  month,
  today,
  selected,
  organizationId,
  administratorEmployeeId,
}: {
  employee: { employee_code: string; employee_name: string; presentDays: number; absentDays: number };
  report: Awaited<ReturnType<typeof loadReport>>;
  month: string;
  today: string;
  selected?: string;
  organizationId: string;
  administratorEmployeeId: string | null;
}) {
  const code = employee.employee_code;
  const records = z
    .array(reportDay)
    .parse(report.rows)
    .filter((row) => row.employeeCode === code);
  const byDate = new Map(records.map((row) => [row.workDate, row]));
  const client = await createClient();
  const { data: person, error: personError } = await client
    .from("employees")
    .select("id,active")
    .eq("organization_id", organizationId)
    .eq("employee_code", code)
    .maybeSingle();
  if (personError) throw new ReportReadError("Employee details unavailable.");
  const canEdit = !report.live.isClosed && person?.active && person.id !== administratorEmployeeId;
  const first = new Date(`${month}-01T00:00:00Z`);
  const nextMonth = new Date(first);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const pending = canEdit
    ? await client
        .from("attendance_corrections")
        .select("work_date")
        .eq("organization_id", organizationId)
        .eq("employee_id", person.id)
        .eq("state", "pending")
        .gte("work_date", `${month}-01`)
        .lt("work_date", nextMonth.toISOString().slice(0, 10))
    : null;
  const pendingDates = new Set(pending?.data?.map((row) => row.work_date));
  const cursor = new Date(first);
  const days: CalendarDay[] = [];
  while (cursor.toISOString().slice(0, 7) === month) {
    const date = cursor.toISOString().slice(0, 10);
    const row = byDate.get(date);
    const absent = row?.result === "absent" || (row?.result === "half_day_leave_approved" && date < today);
    const label = absent
      ? row?.result === "absent"
        ? "Absent"
        : "½ day absent"
      : row?.checkIn
        ? row.checkOut
          ? "Present"
          : "Check-out missing"
        : row?.result === "leave_approved" || row?.result === "half_day_leave_approved"
          ? "Leave"
          : row?.result === "not_applicable"
            ? "Day off"
            : (row?.result?.replaceAll("_", " ") ?? (date > today ? "Upcoming" : "—"));
    days.push({
      date,
      label,
      tone: absent ? "absent" : row?.checkIn && row.checkOut ? "present" : "neutral",
      editable: Boolean(absent && canEdit && !pending?.error && !pendingDates.has(date)),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const day = days.find((entry) => entry.date === selected);
  const row = day ? byDate.get(day.date) : undefined;
  const work =
    person && day && row
      ? await Promise.all([
          client
            .from("daily_work_reports")
            .select("summary")
            .eq("organization_id", organizationId)
            .eq("employee_id", person.id)
            .eq("work_date", day.date)
            .maybeSingle(),
          client
            .from("daily_work_items")
            .select("id,title,notes,status")
            .eq("organization_id", organizationId)
            .eq("employee_id", person.id)
            .eq("work_date", day.date)
            .order("created_at"),
        ])
      : null;
  return (
    <>
      <section className="card section">
        <div className="section-title">
          <h2>
            {employee.employee_name} · {month}
          </h2>
          <Link href={`?month=${month}`}>All employees</Link>
        </div>
        <p>
          <span className="status status-green">{employee.presentDays} present</span>{" "}
          <span className="status status-red">{employee.absentDays} absent</span>
        </p>
        {canEdit && !pending?.error && (
          <p>
            {days.some((day) => day.editable)
              ? "Select only dates the employee worked but missed marking attendance."
              : "No missed dates are eligible for manual attendance this month."}
          </p>
        )}
        {pending?.error && (
          <p className="form-error" role="alert">
            Could not check pending corrections. Refresh before editing.
          </p>
        )}
        <AttendanceCalendar
          key={`${code}-${month}`}
          days={days}
          offset={(first.getUTCDay() + 6) % 7}
          month={month}
          employee={person?.id ?? ""}
          employeeCode={code}
          selected={day?.date}
        />
      </section>
      {day && (
        <section className="card section" id="day-detail">
          <h2>
            {day.date} · {day.label}
          </h2>
          {row && (
            <p>
              <StatusPill value={row.result ?? day.label} /> Check-in {row.checkIn?.slice(-5) ?? "—"} · Check-out{" "}
              {row.checkOut?.slice(-5) ?? "—"}
            </p>
          )}
          <h3>Daily work</h3>
          {work?.some(({ error }) => error) ? (
            <p>Daily work details are temporarily unavailable.</p>
          ) : (
            <>
              {!work?.[0].data?.summary && !work?.[1].data?.length && <p>No work entered for this date.</p>}
              {work?.[0].data?.summary && <p style={{ whiteSpace: "pre-wrap" }}>{work[0].data.summary}</p>}
              {work?.[1].data?.map((item) => (
                <div key={item.id}>
                  <strong>{item.title}</strong> <StatusPill value={item.status} />
                  {item.notes && <p style={{ whiteSpace: "pre-wrap" }}>{item.notes}</p>}
                </div>
              ))}
            </>
          )}
          {pendingDates.has(day.date) && (
            <p>
              <Link href="/approvals">Review the pending attendance request</Link>
            </p>
          )}
          {day.editable && person && <ManualAttendanceForm key={day.date} employee={person.id} date={day.date} />}
        </section>
      )}
    </>
  );
}
