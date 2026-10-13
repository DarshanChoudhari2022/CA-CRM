import Link from "next/link";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { rpc } from "@/modules/portal/queries";

type Overview = {
  date: string;
  expected: number;
  present: number;
  onLeave: number;
  pendingApprovals: number;
  leaves: Array<{ employee: string; leaveType: string; portion: string; startDate: string; endDate: string }>;
};
export async function AdminOverview() {
  const data = await rpc<Overview>("admin_attendance_overview");
  return (
    <>
      <PageHead
        eyebrow="Team overview"
        title="Attendance management"
        description="Approve requests and review your employees’ attendance and leave."
      />
      <section className="grid grid-4">
        {[
          ["Employees expected", data.expected],
          ["Present today", data.present],
          ["On approved leave", data.onLeave],
          ["Pending approvals", data.pendingApprovals],
        ].map(([label, value]) => (
          <article className="card" key={label}>
            <span className="stat-label">{label}</span>
            <strong className="stat-value">{value}</strong>
            <span className="stat-note">{data.date}</span>
          </article>
        ))}
      </section>
      <section className="card section">
        <div className="filters">
          <Link className="button" href="/approvals">
            Review approvals
          </Link>
          <Link className="button button-secondary" href="/team-attendance">
            Team attendance
          </Link>
          <Link className="button button-secondary" href={`/reports?month=${data.date.slice(0, 7)}`}>
            Monthly leave calculation
          </Link>
        </div>
      </section>
      <section className="card section">
        <h2>Approved leave today</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave type</th>
                <th>Dates</th>
                <th>Portion</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.leaves.map((leave) => (
                <tr key={`${leave.employee}-${leave.startDate}-${leave.portion}`}>
                  <td>{leave.employee}</td>
                  <td>{leave.leaveType}</td>
                  <td>
                    {leave.startDate} – {leave.endDate}
                  </td>
                  <td>{leave.portion.replaceAll("_", " ")}</td>
                  <td>
                    <StatusPill value="leave_approved" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.leaves.length && <div className="empty">No employees are on approved leave today.</div>}
        </div>
      </section>
    </>
  );
}
