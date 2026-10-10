import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { rpc } from "@/modules/portal/queries";
import { LeaveForm } from "./leave-form";

type LeaveData = {
  types: Array<{ id: string; name: string; allocated: number; used: number; available: number }>;
  requests: Array<{ id: string; type: string; dates: string; days: number; state: string; submittedAt: string }>;
};

export default async function LeavePage() {
  const data = await rpc<LeaveData>("my_leave_snapshot");
  return (
    <>
      <PageHead eyebrow="Leave" title="Leave and balances" description="Plan time away and follow each approval." />
      <section className="grid grid-4">
        {data.types.map((type) => (
          <article className="card" key={type.id}>
            <div className="stat-label">
              <span>{type.name}</span>
              <span>{type.used} used</span>
            </div>
            <strong className="stat-value">{type.available}</strong>
            <span className="stat-note">days available of {type.allocated}</span>
            <div className="progress">
              <span style={{ width: `${type.allocated ? Math.min(100, (type.used / type.allocated) * 100) : 0}%` }} />
            </div>
          </article>
        ))}
      </section>
      <section className="section grid grid-2">
        <LeaveForm types={data.types} />
        <div className="card">
          <div className="section-title">
            <h2>My requests</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Days</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((request) => (
                  <tr key={request.id}>
                    <td>{request.type}</td>
                    <td>{request.dates}</td>
                    <td>{request.days}</td>
                    <td>
                      <StatusPill value={request.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.requests.length && <div className="empty">No leave requests yet.</div>}
          </div>
        </div>
      </section>
    </>
  );
}
