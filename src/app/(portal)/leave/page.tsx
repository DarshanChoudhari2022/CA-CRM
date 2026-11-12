import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { requireIdentity } from "@/modules/identity/session";
import { rpc } from "@/modules/portal/queries";
import { CancelRequest } from "../operations/forms";
import { LeaveForm } from "./leave-form";

type LeaveData = {
  types: Array<{ id: string; name: string; allocated: number; used: number; available: number }>;
  requests: Array<{ id: string; type: string; dates: string; days: number; state: string; submittedAt: string }>;
};

export default async function LeavePage() {
  const identity = await requireIdentity();
  if (["admin", "partner"].includes(identity.role)) redirect("/approvals");
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
        <LeaveForm types={data.types} joinedOn={identity.joinedOn} />
        <div className="card">
          <div className="section-title">
            <h2>My requests</h2>
          </div>
          {data.requests.length ? (
            <ul className="leave-requests">
              {data.requests.map((request) => (
                <li key={request.id}>
                  <div className="leave-request-heading">
                    <strong>{request.type}</strong>
                    <StatusPill value={request.state} />
                  </div>
                  <p className="stat-note">
                    {request.dates} · {request.days} {request.days === 1 ? "day" : "days"}
                  </p>
                  {request.state === "pending" && <CancelRequest id={request.id} kind="leave" />}
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">No leave requests yet.</div>
          )}
        </div>
      </section>
    </>
  );
}
