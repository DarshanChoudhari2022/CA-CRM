import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { requireIdentity } from "@/modules/identity/session";
import { rpc } from "@/modules/portal/queries";
import { reportTimezone } from "../reports/data";
import { localMonth, monthSchema } from "../reports/report";
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

type History = {
  total: number;
  items: Array<{
    id: string;
    employee: string;
    employee_code: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
    portion: string;
    state: string;
    reason: string;
    reviewedAt: string | null;
    reviewedBy: string | null;
    decisionReason: string | null;
  }>;
};
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; state?: string; page?: string }>;
}) {
  const identity = await requireIdentity();
  if (identity.role === "employee") redirect("/leave");
  const timezone = await reportTimezone(identity);
  const input = await searchParams;
  const parsed = z
    .object({
      month: monthSchema,
      state: z.enum(["approved", "rejected", "all"]).default("approved"),
      page: z.coerce.number().int().min(1).max(100000).default(1),
    })
    .safeParse({ ...input, month: input.month ?? localMonth(new Date(), timezone) });
  const filters = parsed.success
    ? parsed.data
    : { month: localMonth(new Date(), timezone), state: "approved" as const, page: 1 };
  const [items, history] = await Promise.all([
    rpc<Approval[]>("pending_approvals"),
    rpc<History>("leave_approval_history", { p_month: filters.month, p_state: filters.state, p_page: filters.page }),
  ]);
  const historyLink = (page: number) =>
    `/approvals?${new URLSearchParams({ month: filters.month, state: filters.state, page: String(page) })}#leave-history`;
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
      <section className="card section" id="leave-history">
        <h2>Leave approval history</h2>
        <p className="stat-note">
          Approved and rejected requests overlapping the selected month. Days are the complete request; monthly leave
          taken is calculated in Attendance reports.
        </p>
        {!parsed.success && (
          <p className="form-error" role="alert">
            Invalid history filters. Showing this month’s approved leave.
          </p>
        )}
        <form className="filters section" action="/approvals">
          <label htmlFor="history-month">Leave month</label>
          <input
            id="history-month"
            type="month"
            name="month"
            key={filters.month}
            defaultValue={filters.month}
            required
          />
          <label htmlFor="history-state">Decision</label>
          <select id="history-state" name="state" defaultValue={filters.state}>
            <option value="approved">Approved leave</option>
            <option value="rejected">Rejected leave</option>
            <option value="all">All decisions</option>
          </select>
          <button className="button button-secondary" type="submit">
            View history
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave</th>
                <th>Dates / days</th>
                <th>Reason</th>
                <th>Decision</th>
                <th>Reviewed by / date</th>
              </tr>
            </thead>
            <tbody>
              {history.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.employee}
                    <br />
                    <small>{item.employee_code}</small>
                  </td>
                  <td>
                    {item.leaveType}
                    <br />
                    <small>{item.portion.replaceAll("_", " ")}</small>
                  </td>
                  <td>
                    {item.startDate} – {item.endDate}
                    <br />
                    {item.days} days
                  </td>
                  <td>
                    {item.reason}
                    {item.decisionReason && <p className="stat-note">Decision note: {item.decisionReason}</p>}
                  </td>
                  <td>
                    <StatusPill value={item.state === "approved" ? "leave_approved" : item.state} />
                  </td>
                  <td>
                    {item.reviewedBy ?? "—"}
                    <br />
                    <small>
                      {item.reviewedAt
                        ? new Date(item.reviewedAt).toLocaleString("en-IN", { timeZone: timezone })
                        : "—"}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.items.length && (
            <div className="empty">
              No {filters.state === "all" ? "decided" : filters.state} leave requests in this month.
            </div>
          )}
        </div>
        <div className="filters section">
          <span className="stat-note">
            {history.total} requests · Page {filters.page}
          </span>
          {filters.page > 1 && <Link href={historyLink(filters.page - 1)}>Previous</Link>}
          {filters.page * 50 < history.total && <Link href={historyLink(filters.page + 1)}>Next</Link>}
        </div>
      </section>
    </>
  );
}
