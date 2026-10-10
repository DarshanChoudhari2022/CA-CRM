import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";
import { OperationForm } from "./forms";
export default async function OperationsPage() {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) redirect("/modules");
  const client = await createClient();
  const [employees, branches, holidays, audit] = await Promise.all([
    client.from("employees").select("id,full_name,profile_user_id,manager_id,department,active,last_working_on"),
    client.from("branches").select("id,name"),
    client.from("holidays").select("id,name,holiday_date").order("holiday_date"),
    client
      .from("audit_logs")
      .select("id,action,entity_type,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const { data: profiles } = await client.from("profiles").select("user_id,role");
  if (employees.error || branches.error || holidays.error || audit.error)
    throw new Error("People operations unavailable.");
  const people = (employees.data ?? []).map((e) => ({
    id: e.id,
    name: e.full_name,
    manager: e.manager_id,
    department: e.department,
    active: e.active,
    lastDate: e.last_working_on,
    role: profiles?.find((p) => p.user_id === e.profile_user_id)?.role ?? "employee",
  }));
  return (
    <>
      <PageHead
        eyebrow="Administration"
        title="People, calendar & audit"
        description="Manage access and working days."
      />
      <section className="grid grid-2">
        {(["holiday", "employee", "excuse"] as const).map((kind) => (
          <OperationForm key={kind} kind={kind} employees={people} branches={branches.data ?? []} />
        ))}
      </section>
      <section className="section card">
        <h2>Branch holidays</h2>
        {(holidays.data ?? []).map((h) => (
          <p key={h.id}>
            {h.holiday_date} · {h.name}
          </p>
        ))}
      </section>
      <section className="section card">
        <h2>Recent audit</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td>{a.action.replaceAll("_", " ")}</td>
                  <td>{a.entity_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
