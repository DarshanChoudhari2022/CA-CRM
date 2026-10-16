import Link from "next/link";
import { PageHead } from "@/components/page-head";
import { createClient } from "@/lib/supabase/server";
import { crmModules } from "@/modules/crm/config";
import { requireIdentity } from "@/modules/identity/session";
export default async function CrmReports() {
  const identity = await requireIdentity();
  const client = await createClient();
  const admin = ["admin", "partner"].includes(identity.role);
  const counts = await Promise.all(
    Object.entries(crmModules)
      .filter(([module]) => admin || module !== "invoices")
      .map(async ([module, config]) => {
        const { count, error } = await client.from(`crm_${module}`).select("id", { count: "exact", head: true });
        if (error) throw new Error("CRM reports unavailable.");
        return { module, title: config.title, count: count ?? 0 };
      }),
  );
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const overdue = await client
    .from("crm_compliance")
    .select("id,title,due_date")
    .lt("due_date", today)
    .neq("status", "filed")
    .order("due_date")
    .limit(100);
  const summary = admin ? await client.rpc("crm_financial_summary") : null;
  if (summary?.error) throw new Error("Financial summary unavailable.");
  const amounts = summary?.data as { issued: number; received: number } | null;
  return (
    <>
      <PageHead eyebrow="CA CRM" title="CRM reports" description="Records visible to your role and assigned team." />
      <section className="grid grid-3">
        {counts.map((c) => (
          <Link href={`/crm/${c.module}`} className="card" key={c.module}>
            <span className="stat-note">{c.title}</span>
            <h2>{c.count}</h2>
          </Link>
        ))}
      </section>
      {admin && (
        <section className="card section">
          <h2>Collections summary</h2>
          <p>Issued invoices INR {Number(amounts?.issued ?? 0).toFixed(2)}</p>
          <p>Recorded payments INR {Number(amounts?.received ?? 0).toFixed(2)}</p>
          <p className="stat-note">Manual payment ledger, not bank reconciliation.</p>
        </section>
      )}
      <section className="card section">
        <h2>Overdue compliance</h2>
        {(overdue.data ?? []).map((t) => (
          <p key={t.id}>
            {t.title} · {t.due_date}
          </p>
        ))}
        {!overdue.data?.length && <p>No overdue records visible.</p>}
      </section>
    </>
  );
}
