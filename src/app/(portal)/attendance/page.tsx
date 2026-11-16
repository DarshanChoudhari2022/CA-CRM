/** biome-ignore-all lint/a11y/noRedundantRoles: Preserve attendance table semantics when its rows use CSS grid on mobile. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { PunchLocation } from "@/components/punch-location";
import { StatusPill } from "@/components/status-pill";
import { createClient } from "@/lib/supabase/server";
import type { PunchLocation as Location } from "@/modules/attendance/location";
import { requireIdentity } from "@/modules/identity/session";
import { rpc } from "@/modules/portal/queries";
import { CancelRequest } from "../operations/forms";
import { reportTimezone } from "../reports/data";
import { localMonth } from "../reports/report";
import { CorrectionForm } from "./correction-form";

type Day = {
  date: string;
  context: string;
  checkIn: string | null;
  checkOut: string | null;
  duration: string;
  result: string;
  isLate: boolean;
  correctionStatus: string | null;
  checkInLocation?: Location;
  checkOutLocation?: Location;
};

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const identity = await requireIdentity();
  if (["admin", "partner"].includes(identity.role)) redirect("/team-attendance");
  const timezone = await reportTimezone(identity);
  const filters = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month ?? "")
    ? (filters.month ?? "")
    : localMonth(new Date(), timezone);
  const client = await createClient();
  const [days, correctionResult] = await Promise.all([
    rpc<Day[]>("my_attendance_history", { p_month: month }),
    client
      .from("attendance_corrections")
      .select("id,work_date,state,decision_reason")
      .eq("requested_by", identity.userId)
      .order("requested_at", { ascending: false })
      .limit(50),
  ]);
  if (correctionResult.error) throw new Error("Correction requests unavailable.");
  const corrections = correctionResult.data;
  return (
    <>
      <PageHead
        eyebrow="My attendance"
        title="Attendance history"
        description="Your saved punches and attendance results for this month."
        action={
          <Link href="#missed-attendance" className="button button-secondary">
            Request missed attendance
          </Link>
        }
      />
      <section className="card">
        <div className="section-title">
          <h2>This month</h2>
          <form className="filters">
            <input
              name="month"
              type="month"
              min={identity.joinedOn?.slice(0, 7)}
              defaultValue={month}
              aria-label="Month"
            />
            <button type="submit" className="button button-secondary">
              View month
            </button>
          </form>
        </div>
        <div className="table-wrap attendance-history">
          <table role="table" aria-label="Monthly attendance history">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  Date
                </th>
                <th scope="col" role="columnheader">
                  Day
                </th>
                <th scope="col" role="columnheader">
                  Check-in
                </th>
                <th scope="col" role="columnheader">
                  Check-out
                </th>
                <th scope="col" role="columnheader">
                  Hours
                </th>
                <th scope="col" role="columnheader">
                  Result
                </th>
                <th scope="col" role="columnheader">
                  Correction
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {days.map((day) => (
                <tr role="row" key={day.date}>
                  <td role="cell">
                    <strong>{day.date}</strong>
                  </td>
                  <td role="cell">{day.context.replaceAll("_", " ")}</td>
                  <td role="cell">
                    <span className="attendance-history-label" aria-hidden="true">
                      Check-in
                    </span>
                    {day.checkIn ?? "—"}
                    {day.checkIn && (
                      <div>
                        <PunchLocation value={day.checkInLocation} />
                      </div>
                    )}
                    {day.isLate && <small style={{ color: "var(--amber)", marginLeft: 6 }}>Late</small>}
                  </td>
                  <td role="cell">
                    <span className="attendance-history-label" aria-hidden="true">
                      Check-out
                    </span>
                    {day.checkOut ?? "—"}
                    {day.checkOut && (
                      <div>
                        <PunchLocation value={day.checkOutLocation} />
                      </div>
                    )}
                  </td>
                  <td role="cell">
                    <span className="attendance-history-label" aria-hidden="true">
                      Hours
                    </span>
                    {day.duration}
                  </td>
                  <td role="cell" className="attendance-history-result">
                    <StatusPill value={day.result} />
                  </td>
                  <td role="cell">
                    <span className="attendance-history-label" aria-hidden="true">
                      Correction
                    </span>
                    {day.correctionStatus ? <StatusPill value={day.correctionStatus} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!days.length && <div className="empty">No attendance records for this month.</div>}
        </div>
      </section>
      <section className="section">
        <CorrectionForm today={new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date())} />
      </section>
      <section className="section card">
        <h2>Your correction requests</h2>
        {(corrections ?? []).map((c) => (
          <article key={c.id} className="section">
            <p>
              {c.work_date} · {c.state}
            </p>
            {c.decision_reason && <p>{c.decision_reason}</p>}
            {c.state === "pending" && <CancelRequest id={c.id} kind="attendance" />}
          </article>
        ))}
        {!corrections?.length && <p>No correction requests.</p>}
      </section>
    </>
  );
}
