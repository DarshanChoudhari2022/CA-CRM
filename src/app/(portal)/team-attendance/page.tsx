import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { PunchLocation } from "@/components/punch-location";
import { StatusPill } from "@/components/status-pill";
import { createClient } from "@/lib/supabase/server";
import { formatWorkedMinutes } from "@/modules/attendance/duration";
import { type AttendanceRegister, registerArgs, registerFilters, registerResults } from "@/modules/attendance/register";
import { requireIdentity } from "@/modules/identity/session";
import { reportTimezone } from "../reports/data";

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
          <a className="button button-secondary" href={`/team-attendance/export?${url}`}>
            Export filtered CSV
          </a>
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
                </tr>
              </thead>
              <tbody>
                {register?.items.map((row) => (
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
                  </tr>
                ))}
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
