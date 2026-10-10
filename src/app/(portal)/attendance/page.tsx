import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { rpc } from "@/modules/portal/queries";
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

export default async function AttendancePage() {
  const days = await rpc<Day[]>("my_attendance_history", { p_month: new Date().toISOString().slice(0, 7) });
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
          <div className="filters">
            <input type="month" defaultValue={new Date().toISOString().slice(0, 7)} aria-label="Month" />
          </div>
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
    </>
  );
}
