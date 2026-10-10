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
                  <td>{item.summary}</td>
                  <td>{item.reason}</td>
                  <td>
                    <DecisionButtons kind={item.kind} id={item.id} />
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
