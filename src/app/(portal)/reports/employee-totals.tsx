import Link from "next/link";

export type EmployeeTotal = {
  employee_code: string;
  employee_name: string;
  department: string;
  expectedDays: number;
  presentDays: number;
  leaveDays: number | null;
  approvedLeaveDays?: number;
  absentDays: number;
  incompleteDays: number;
  durationMinutes: number;
};
export function EmployeeTotals({
  rows,
  snapshot = false,
  calendarMonth,
}: {
  rows: EmployeeTotal[];
  snapshot?: boolean;
  calendarMonth?: string;
}) {
  return (
    <section className="card section">
      <h2>Employee monthly calculation</h2>
      <p className="stat-note">
        {snapshot
          ? "Saved snapshot. A dash means the older snapshot did not retain a leave breakdown."
          : "Leave taken counts working days through today; approved leave includes future dates in this month. Half-day leave counts as 0.5. Attendance days and leave can overlap on half-days."}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Working days</th>
              <th>Days attended</th>
              <th>Leave taken</th>
              {!snapshot && <th>Total approved leave</th>}
              <th>Absent days</th>
              <th>Incomplete</th>
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employee_code}>
                <td>
                  {calendarMonth ? (
                    <Link
                      href={`/team-attendance/monthly?${new URLSearchParams({ month: calendarMonth, employee: row.employee_code })}`}
                    >
                      <strong>{row.employee_name}</strong>
                    </Link>
                  ) : (
                    row.employee_name
                  )}
                  <br />
                  <small>
                    {row.employee_code} · {row.department}
                  </small>
                </td>
                <td>{row.expectedDays}</td>
                <td>
                  {calendarMonth && row.presentDays > 0 ? (
                    <span className="status status-green">{row.presentDays}</span>
                  ) : (
                    row.presentDays
                  )}
                </td>
                <td>{row.leaveDays ?? "—"}</td>
                {!snapshot && <td>{row.approvedLeaveDays ?? "—"}</td>}
                <td>
                  {calendarMonth && row.absentDays > 0 ? (
                    <span className="status status-red">{row.absentDays}</span>
                  ) : (
                    row.absentDays
                  )}
                </td>
                <td>{row.incompleteDays}</td>
                <td>
                  {Math.floor(row.durationMinutes / 60)}h {row.durationMinutes % 60}m
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">No employee attendance in this period.</div>}
      </div>
    </section>
  );
}
