import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { createClient } from "@/lib/supabase/server";
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
};

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const identity = await requireIdentity();
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
      />
      <section className="card">
        <div className="section-title">
          <h2>This month</h2>
          <form className="filters">
            <input name="month" type="month" defaultValue={month} aria-label="Month" />
            <button type="submit" className="button button-secondary">
              View month
            </button>
          </form>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Hours</th>
                <th>Result</th>
                <th>Correction</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{day.context.replaceAll("_", " ")}</td>
                  <td>
                    {day.checkIn ?? "—"}
                    {day.isLate && <small style={{ color: "var(--amber)", marginLeft: 6 }}>Late</small>}
                  </td>
                  <td>{day.checkOut ?? "—"}</td>
                  <td>{day.duration}</td>
                  <td>
                    <StatusPill value={day.result} />
                  </td>
                  <td>{day.correctionStatus ? <StatusPill value={day.correctionStatus} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!days.length && <div className="empty">No attendance records for this month.</div>}
        </div>
      </section>
      <section className="section">
        <CorrectionForm />
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
