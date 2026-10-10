import { PageHead } from "@/components/page-head";
import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";
import { WorkForm, type WorkItem } from "./work-form";

export default async function WorkPage() {
  const identity = await requireIdentity();
  const supabase = await createClient();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const { data, error } = await supabase
    .from("daily_work_items")
    .select("id,title,notes,status,work_date")
    .eq("employee_id", identity.employeeId)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const items = (data ?? []) as WorkItem[];
  return (
    <>
      <PageHead eyebrow="My workspace" title="My work" description="Plan today and update your progress." />
      <section className="grid grid-2">
        <WorkForm />
        {items
          .filter((item) => item.work_date === today)
          .map((item) => (
            <WorkForm key={item.id} item={item} />
          ))}
      </section>
      <section className="section card">
        <div className="section-title">
          <h2>Work history</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Work</th>
                <th>Progress</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items
                .filter((item) => item.work_date !== today)
                .map((item) => (
                  <tr key={item.id}>
                    <td>{item.work_date}</td>
                    <td>{item.title}</td>
                    <td>{item.status.replaceAll("_", " ")}</td>
                    <td>{item.notes || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
