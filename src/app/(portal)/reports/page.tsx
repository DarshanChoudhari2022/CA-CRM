import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { requireIdentity } from "@/modules/identity/session";
import { loadReport, reportTimezone } from "./data";
import { EmployeeTotals } from "./employee-totals";
import { MonthActions } from "./month-actions";
import { localMonth, monthSchema, parseVersion, previousMonth, ReportReadError } from "./report";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[]; version?: string | string[] }>;
}) {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) redirect("/dashboard");
  const filters = await searchParams;
  let month = typeof filters.month === "string" ? filters.month : "";
  let timezone = "";
  let currentMonth = "";
  let error = "";
  let selectedVersion: number | null = null;
  let result: Awaited<ReturnType<typeof loadReport>> | null = null;
  try {
    timezone = await reportTimezone(identity);
    currentMonth = localMonth(new Date(), timezone);
    if (filters.month === undefined) month = currentMonth;
    if (!monthSchema.safeParse(month).success) throw new ReportReadError("Choose a valid month (YYYY-MM).", 400);
    selectedVersion = parseVersion(filters.version);
    result = await loadReport(identity, month, selectedVersion, false, true);
  } catch (failure) {
    error =
      failure instanceof ReportReadError
        ? failure.message
        : "Report data unavailable. Refresh or contact your administrator.";
  }
  const exportQuery = new URLSearchParams({ month });
  if (result?.version != null) exportQuery.set("version", String(result.version));
  const metrics = result
    ? [
        ["Working employee-days", result.report.expectedDays],
        ["Full days", result.report.fullDays],
        ["Half days", result.report.halfDays],
        ["Short days", result.report.shortDays],
        ["Absent", result.report.absentDays],
        ["Leave taken (days)", result.report.leaveDays],
        ...(result.report.approvedLeaveDays === undefined
          ? []
          : [["Approved leave incl. future", result.report.approvedLeaveDays]]),
        ["Incomplete", result.report.incompleteDays],
        ["Total hours", result.report.totalHours],
      ]
    : [];
  return (
    <>
      <PageHead
        eyebrow="Reports"
        title="Monthly attendance"
        description="Review a month, export a saved report, or reopen it for corrections."
      />
      <form className="filters" action="/reports">
        <label htmlFor="report-month">Month</label>
        <input
          id="report-month"
          key={month}
          name="month"
          type="month"
          required
          defaultValue={monthSchema.safeParse(month).success ? month : undefined}
        />
        <button className="button button-secondary" type="submit">
          View month
        </button>
        <Link href={`/reports?month=${currentMonth}`}>This month</Link>
        {timezone && <Link href={`/reports?month=${previousMonth(new Date(), timezone)}`}>Previous month</Link>}
      </form>
      {error && (
        <section className="card section">
          <p className="form-error" role="alert">
            {error}
          </p>
          <Link href="/reports">Return to this month</Link>
        </section>
      )}
      {result && (
        <>
          <section className="card section">
            <h2>
              {month} · {result.live.isClosed ? "Closed" : "Open"}
            </h2>
            <p>
              {result.version == null
                ? "Live month-to-date report — calculated through today, not from future attendance. Administrators are excluded."
                : `Saved report version ${result.version} · Generated ${result.generatedAt}`}
            </p>
            <p className="stat-note">Timezone: {timezone}</p>
            <a className="button button-secondary" href={`/reports/export?${exportQuery}`}>
              Export {result.version == null ? "live" : "snapshot"} CSV
            </a>
            {result.history.length > 0 && (
              <form className="filters section" action="/reports">
                <input type="hidden" name="month" value={month} />
                <label htmlFor="report-version">Report version</label>
                <select
                  id="report-version"
                  name="version"
                  defaultValue={selectedVersion == null ? "" : String(selectedVersion)}
                >
                  <option value="">{result.live.isClosed ? "Latest closed snapshot" : "Current live report"}</option>
                  {result.history.map((item) => (
                    <option key={item.version} value={item.version}>
                      Version {item.version} · {item.generated_at}
                    </option>
                  ))}
                </select>
                <button className="button button-secondary" type="submit">
                  View version
                </button>
              </form>
            )}
          </section>
          <EmployeeTotals rows={result.employees} snapshot={result.version !== null} />
          <section className="grid grid-4">
            {metrics.map(([label, value]) => (
              <article className="card" key={label}>
                <span className="stat-label">{label}</span>
                <strong className="stat-value">{value}</strong>
              </article>
            ))}
          </section>
          {selectedVersion === null ? (
            <MonthActions
              key={`${month}-${result.live.isClosed}`}
              month={month}
              closed={result.live.isClosed}
              blocked={result.live.blockers > 0}
              completed={month < currentMonth}
            />
          ) : (
            <p className="section">
              Viewing a saved version.{" "}
              <Link href={`/reports?month=${month}`}>Return to the current month view to close or reopen.</Link>
            </p>
          )}
        </>
      )}
    </>
  );
}
