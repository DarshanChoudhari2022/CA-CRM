import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { PunchLocation } from "@/components/punch-location";
import { StatusPill } from "@/components/status-pill";
import { createClient } from "@/lib/supabase/server";
import { formatWorkedMinutes } from "@/modules/attendance/duration";
import { type AttendanceRegister, registerArgs, registerFilters, registerResults } from "@/modules/attendance/register";
import { isAdministrator } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";
import { reportTimezone } from "../reports/data";
import { ManualAttendanceForm } from "./manual-attendance-form";

export default async function TeamAttendance({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const identity = await requireIdentity();
  if (identity.role === "employee") redirect("/dashboard");
  const zone = await reportTimezone(identity);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
  const query = await searchParams;
  const parsed = registerFilters.safeParse({ ...query, date: query.date ?? today });
  if (!parsed.success)
    return (
      <section className="card">
        <h1>Team attendance</h1>
        <p role="alert">Check your date and filter values.</p>
        <Link href="/team-attendance">Reset filters</Link>
      </section>
    );
  const filters = parsed.data;
  const client = await createClient();
  const [rows, branches, departments] = await Promise.all([
    client.rpc("attendance_register", registerArgs(filters)),
    client.from("branches").select("id,name").eq("organization_id", identity.organizationId).order("name"),
    client.from("employees").select("department").eq("organization_id", identity.organizationId).limit(1000),
  ]);
  const register = rows.data as AttendanceRegister | null;
  const administrator = isAdministrator(identity.role);
  const employeeIds = register?.items.map((row) => row.employee_id) ?? [];
  const workDetails =
    administrator && employeeIds.length
      ? await Promise.all([
          client
            .from("daily_work_reports")
            .select("employee_id,summary")
            .eq("organization_id", identity.organizationId)
            .eq("work_date", filters.date)
            .in("employee_id", employeeIds),
          client
            .from("daily_work_items")
            .select("id,employee_id,title,notes,status")
            .eq("organization_id", identity.organizationId)
            .eq("work_date", filters.date)
            .in("employee_id", employeeIds)
            .order("created_at"),
        ])
      : null;
  const url = new URLSearchParams({
    date: filters.date,
    branch: filters.branch,
    department: filters.department,
    q: filters.q,
    result: filters.result,
  });
  const time = (value: string | null) =>
    value ? new Date(value).toLocaleTimeString("en-IN", { timeZone: zone, hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <>
      <PageHead
        eyebrow="Attendance"
        title="Team attendance"
        description={`Daily register · ${zone}`}
        action={
          <div className="ai-actions">
            {administrator && (
              <Link
                className="button button-primary"
                href={`/team-attendance/monthly?month=${filters.date.slice(0, 7)}`}
              >
                Monthly attendance
              </Link>
            )}
            <a className="button button-secondary" href={`/team-attendance/export?${url}`}>
              Export filtered CSV
            </a>
          </div>
        }
      />
      <section className="card">
        <form className="register-filters" method="get">
          <label>
            Date
            <input type="date" name="date" defaultValue={filters.date} max={today} required />
          </label>
          <label>
            Branch
            <select name="branch" defaultValue={filters.branch}>
              <option value="">All branches</option>
              {branches.data?.map((branch) => (
                <option value={branch.id} key={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Department
            <select name="department" defaultValue={filters.department}>
              <option value="">All departments</option>
              {Array.from(new Set((departments.data ?? []).map((employee) => employee.department)))
                .sort()
                .map((department) => (
                  <option value={department} key={department}>
                    {department}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Result
            <select name="result" defaultValue={filters.result}>
              <option value="">All results</option>
              {registerResults.map((result) => (
                <option value={result} key={result}>
                  {result.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Employee
            <input name="q" defaultValue={filters.q} placeholder="Name or code" maxLength={100} />
          </label>
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
        </form>
      </section>
      {rows.error ? (
        <p className="form-error section" role="alert">
          Register unavailable. Choose a current or past date and retry.
        </p>
      ) : (
        <section className="card section">
          <h2>
            {register?.total ?? 0} employees · {filters.date}
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Branch / department</th>
                  <th>Day</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Time worked</th>
                  <th>Result</th>
                  {administrator && <th>Details</th>}
                </tr>
              </thead>
              <tbody>
                {register?.items.map((row) => {
                  const summary = workDetails?.[0].data?.find(
                    (report) => report.employee_id === row.employee_id,
                  )?.summary;
                  const tasks = workDetails?.[1].data?.filter((task) => task.employee_id === row.employee_id) ?? [];
                  return (
                    <tr key={row.employee_id}>
                      <td>
                        {row.full_name}
                        <small className="stat-note"> {row.employee_code}</small>
                      </td>
                      <td>
                        {row.branch}
                        <br />
                        {row.department}
                      </td>
                      <td>{row.context.replaceAll("_", " ")}</td>
                      <td>
                        {time(row.check_in_at)}
                        {row.check_in_at && (
                          <div>
                            <PunchLocation value={row.checkInLocation} />
                          </div>
                        )}
                        {row.is_late && <span className="status status-amber">Late</span>}
                      </td>
                      <td>
                        {time(row.check_out_at)}
                        {row.check_out_at && (
                          <div>
                            <PunchLocation value={row.checkOutLocation} />
                          </div>
                        )}
                      </td>
                      <td>{row.duration_minutes === null ? "—" : formatWorkedMinutes(row.duration_minutes)}</td>
                      <td>
                        <StatusPill value={row.result} />
                      </td>
                      {administrator && (
                        <td>
                          {row.employee_id !== identity.employeeId && (
                            <Link
                              className="attendance-link"
                              href={`/team-attendance/monthly?${new URLSearchParams({
                                month: filters.date.slice(0, 7),
                                employee: row.employee_code,
                              })}#bulk-attendance`}
                            >
                              Mark missed dates in bulk
                            </Link>
                          )}
                          <details>
                            <summary>Daily work</summary>
                            {workDetails?.some(({ error }) => error) ? (
                              <p>Daily work details are temporarily unavailable.</p>
                            ) : (
                              <>
                                {!summary && !tasks.length && <p>No work entered for this date.</p>}
                                {summary && <p style={{ whiteSpace: "pre-wrap" }}>{summary}</p>}
                                {tasks.length > 0 && (
                                  <ul>
                                    {tasks.map((task) => (
                                      <li key={task.id}>
                                        {task.title} <StatusPill value={task.status} />
                                        {task.notes && <p style={{ whiteSpace: "pre-wrap" }}>{task.notes}</p>}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            )}
                          </details>
                          {row.context === "working_day" &&
                            !row.check_in_at &&
                            !row.check_out_at &&
                            row.result !== "leave_approved" &&
                            row.result !== "excused" &&
                            row.employee_id !== identity.employeeId && (
                              <ManualAttendanceForm key={filters.date} employee={row.employee_id} date={filters.date} />
                            )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!register?.items.length && <p className="empty">No employees match these filters.</p>}
          <div className="ai-actions section">
            {filters.page > 1 && (
              <Link className="button button-secondary" href={`/team-attendance?${url}&page=${filters.page - 1}`}>
                Previous
              </Link>
            )}
            {register && filters.page * 50 < register.total && (
              <Link className="button button-secondary" href={`/team-attendance?${url}&page=${filters.page + 1}`}>
                Next
              </Link>
            )}
          </div>
        </section>
      )}
    </>
  );
}
