import { Download, LockKeyhole } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { rpc } from "@/modules/portal/queries";
import { closeMonth } from "./actions";

type Report = {
  expectedDays: number;
  fullDays: number;
  halfDays: number;
  shortDays: number;
  absentDays: number;
  leaveDays: number;
  incompleteDays: number;
  totalHours: string;
  isClosed: boolean;
  blockers: number;
};

export default async function ReportsPage() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  const month = date.toISOString().slice(0, 7);
  const report = await rpc<Report>("attendance_month_summary", { p_month: month });
  const metrics = [
    ["Expected days", report.expectedDays],
    ["Full days", report.fullDays],
    ["Half days", report.halfDays],
    ["Absent", report.absentDays],
    ["Approved leave", report.leaveDays],
    ["Incomplete", report.incompleteDays],
    ["Total hours", report.totalHours],
  ];
  return (
    <>
      <PageHead
        eyebrow="Reports"
        title="Monthly attendance"
        description={`Reconcile ${month} before closing an immutable report version.`}
        action={
          <div style={{ display: "flex", gap: 10 }}>
            <a className="button button-secondary" href={`/reports/export?month=${month}`}>
              <Download size={17} /> Export CSV
            </a>
            <form action={closeMonth}>
              <input type="hidden" name="month" value={month} />
              <button type="submit" className="button button-primary" disabled={report.isClosed || report.blockers > 0}>
                <LockKeyhole size={17} /> {report.isClosed ? "Month closed" : "Close month"}
              </button>
            </form>
          </div>
        }
      />
      <section className="grid grid-4">
        {metrics.map(([name, value]) => (
          <article className="card" key={name}>
            <span className="stat-label">{name}</span>
            <strong className="stat-value">{value}</strong>
          </article>
        ))}
      </section>
      {report.blockers > 0 && (
        <section className="section card">
          <StatusPillLike /> <strong>{report.blockers} records must be resolved before this month can close.</strong>
        </section>
      )}
    </>
  );
}
function StatusPillLike() {
  return (
    <span className="status status-amber" style={{ marginRight: 10 }}>
      Action required
    </span>
  );
}
