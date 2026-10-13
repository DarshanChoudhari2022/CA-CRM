import { PageHead } from "@/components/page-head";
import { rpc } from "@/modules/portal/queries";
import { DecisionButtons } from "./decision-buttons";

type Approval = {
  id: string;
  kind: "leave" | "attendance";
  employee: string;
  summary: string;
  reason: string;
  submittedAt: string;
  originalIn?: string | null;
  originalOut?: string | null;
  proposedIn?: string;
  proposedOut?: string;
  isStale?: boolean;
};

export default async function ApprovalsPage() {
  const items = await rpc<Approval[]>("pending_approvals");
  return (
    <>
      <PageHead
        eyebrow="Approvals"
        title="Requests needing attention"
        description="Review attendance corrections and employee leave requests."
      />
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Request</th>
                <th>Details</th>
                <th>Reason</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.kind}-${item.id}`}>
                  <td>{item.employee}</td>
                  <td style={{ textTransform: "capitalize" }}>{item.kind}</td>
                  <td>
                    {item.summary}
                    {item.kind === "attendance" && (
                      <div className="approval-evidence">
                        <p>
                          Original: {item.originalIn ?? "Missing"} – {item.originalOut ?? "Missing"}
                        </p>
                        <p>
                          Proposed: {item.proposedIn} – {item.proposedOut}
                        </p>
                        {item.isStale && (
                          <p className="form-error">
                            Attendance changed. Reject this request and ask the employee to resubmit.
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td>{item.reason}</td>
                  <td>
                    <DecisionButtons kind={item.kind} id={item.id} stale={item.isStale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <div className="empty">You have no pending approvals.</div>}
        </div>
      </section>
    </>
  );
}
