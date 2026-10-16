import { createClient } from "@/lib/supabase/server";
import { leaveWeb3FormsKey } from "@/modules/leave/email-config";
import { EmailRetry } from "./email-retry";

type Notice = {
  id: string;
  state: string;
  last_error: string | null;
  created_at: string;
  leave_requests: { start_date: string; end_date: string; employees: { full_name: string } } | null;
};
export async function LeaveEmailLog() {
  const client = await createClient();
  const result = await client
    .from("leave_email_notifications")
    .select("id,state,last_error,created_at,leave_requests(start_date,end_date,employees(full_name))")
    .order("created_at", { ascending: false })
    .limit(20);
  const configured = Boolean(leaveWeb3FormsKey());
  return (
    <details className="card section">
      <summary>Office leave emails</summary>
      <p className="stat-note">
        {configured
          ? "Recent leave application notifications."
          : "Email setup required. Leave requests are saved and can be approved normally."}
      </p>
      {result.error ? (
        <p role="status">Email history is unavailable.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Leave dates</th>
                <th>Email status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {((result.data ?? []) as unknown as Notice[]).map((notice) => (
                <tr key={notice.id}>
                  <td>{notice.leave_requests?.employees?.full_name ?? "Employee"}</td>
                  <td>
                    {notice.leave_requests?.start_date} – {notice.leave_requests?.end_date}
                  </td>
                  <td>
                    {notice.state === "sent"
                      ? "Accepted for delivery"
                      : notice.state === "sending"
                        ? "Awaiting confirmation"
                        : notice.state}
                    <div className="stat-note">{notice.last_error}</div>
                  </td>
                  <td>{notice.state !== "sent" && <EmailRetry id={notice.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!result.data?.length && <p>No office email notifications yet.</p>}
        </div>
      )}
    </details>
  );
}
