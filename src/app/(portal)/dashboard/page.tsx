import { CalendarCheck2, ClipboardCheck, Clock3, UsersRound } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import type { DailyReportData } from "@/modules/attendance/daily-report";
import { requireIdentity } from "@/modules/identity/session";
import { type DashboardSnapshot, rpc } from "@/modules/portal/queries";
import { PunchButton } from "../attendance/punch-button";
import { ShiftDuration } from "../attendance/shift-duration";
import { AdminOverview } from "./admin-overview";
import { DailyReportCard } from "./daily-report-card";

export default async function DashboardPage() {
  const identity = await requireIdentity();
  if (["admin", "partner"].includes(identity.role)) return <AdminOverview />;
  const [snapshot, report] = await Promise.all([
    rpc<DashboardSnapshot>("dashboard_snapshot_v2"),
    rpc<DailyReportData>("my_daily_report").catch(() => null),
  ]);
  const cards = [
    ["Present today", snapshot.stats.present, `${snapshot.stats.expected} expected`, UsersRound],
    ["On leave", snapshot.stats.onLeave, "Approved for today", CalendarCheck2],
    ["Pending approvals", snapshot.stats.pendingApprovals, "Attendance and leave", ClipboardCheck],
    ["My status", snapshot.today.state.replaceAll("_", " "), snapshot.today.shiftLabel, Clock3],
  ] as const;
  return (
    <>
      <PageHead
        eyebrow="Overview"
        title="Good day."
        description="Today’s attendance, leave and approvals at a glance."
      />
      <section className="grid grid-4" aria-label="Today summary">
        {cards.map(([label, value, note, Icon]) => (
          <article className="card" key={label}>
            <div className="stat-label">
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong className="stat-value">{value}</strong>
            <span className="stat-note">{note}</span>
          </article>
        ))}
      </section>
      <section className="section today-card">
        <div>
          <span className="eyebrow">My attendance today</span>
          <div className="clock">
            {snapshot.today.checkIn
              ? new Date(snapshot.today.checkIn).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Kolkata",
                })
              : "Not checked in"}
          </div>
          <div className="today-meta">
            {snapshot.today.workDate} · {snapshot.today.shiftLabel}
            <br />
            {snapshot.today.checkOut
              ? `Checked out at ${new Date(snapshot.today.checkOut).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`
              : "Your saved attendance appears here."}
          </div>
          <ShiftDuration
            checkIn={snapshot.today.checkIn}
            checkOut={snapshot.today.checkOut}
            serverNow={snapshot.today.serverNow}
            durationMinutes={snapshot.today.durationMinutes}
          />
        </div>
        <div className="today-action">
          {snapshot.today.state === "leave_approved" ? (
            <StatusPill value="leave_approved" />
          ) : (
            <PunchButton canCheckIn={snapshot.today.canCheckIn} canCheckOut={snapshot.today.canCheckOut} />
          )}
        </div>
      </section>
      {report ? (
        <DailyReportCard report={report} />
      ) : (
        <section className="card section">
          <h2>
            Tasks performed today <span className="optional-badge">Optional</span>
          </h2>
          <p className="stat-note">
            Work updates are temporarily unavailable. You can still check in or check out above.
          </p>
        </section>
      )}
      <section className="section grid grid-2">
        <div className="card">
          <div className="section-title">
            <h2>Recent attendance</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Hours</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recent.map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{row.checkIn ?? "—"}</td>
                    <td>{row.checkOut ?? "—"}</td>
                    <td>{row.duration}</td>
                    <td>
                      <StatusPill value={row.result} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="section-title">
            <h2>Leave balance</h2>
          </div>
          <div className="grid">
            {snapshot.leaveBalances.length ? (
              snapshot.leaveBalances.map((item) => (
                <div key={item.name}>
                  <div className="balance">
                    <span>{item.name}</span>
                    <strong>{item.available}</strong>
                  </div>
                  <div className="stat-note">
                    {item.used} used of {item.allocated} days
                  </div>
                  <div className="progress">
                    <span
                      style={{ width: `${Math.min(100, item.allocated ? (item.used / item.allocated) * 100 : 0)}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">Leave balances have not been assigned yet.</div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
