import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";

const labels = {
  invoice_history_created: "Created",
  invoice_history_edit: "Edited",
  invoice_history_delete: "Draft deleted",
  invoice_history_cancel: "Cancelled",
};
const historyDetails = z.object({
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
});
const fieldNames: Record<string, string> = {
  title: "Title",
  notes: "Notes",
  client_id: "Client",
  amount: "Amount",
  due_date: "Due date",
  status: "Status",
  invoice_details: "Invoice details",
};

export default async function InvoiceHistory({ params }: { params: Promise<{ id: string }> }) {
  const identity = await requireCrmIdentity();
  const invoiceId = z.uuid().safeParse((await params).id);
  if (!invoiceId.success) notFound();
  const db = await createClient();
  const [invoice, history] = await Promise.all([
    db
      .from("crm_invoices")
      .select("invoice_number")
      .eq("organization_id", identity.organizationId)
      .eq("id", invoiceId.data)
      .maybeSingle(),
    db
      .from("audit_logs")
      .select("id,action,metadata,actor_user_id,created_at")
      .eq("organization_id", identity.organizationId)
      .eq("entity_type", "crm_invoices")
      .eq("entity_id", invoiceId.data)
      .in("action", Object.keys(labels))
      .order("id", { ascending: false })
      .limit(100),
  ]);
  if (invoice.error || history.error) throw new Error("Invoice history unavailable.");
  if (!invoice.data) notFound();
  const actorIds = [...new Set(history.data.flatMap((row) => (row.actor_user_id ? [row.actor_user_id] : [])))];
  const actors = actorIds.length
    ? await db
        .from("profiles")
        .select("user_id,full_name")
        .eq("organization_id", identity.organizationId)
        .in("user_id", actorIds)
    : null;
  const names = new Map(actors?.data?.map((actor) => [actor.user_id, actor.full_name]));
  return (
    <>
      <header className="billing-toolbar billing-heading">
        <h1>Invoice history · {invoice.data.invoice_number}</h1>
        <Link className="billing-button" href="/invoice/ledger">
          Back to ledger
        </Link>
      </header>
      <section className="billing-card">
        {!history.data.length && <p>No changes have been recorded for this invoice since history tracking began.</p>}
        {history.data.map((row) => {
          const parsed = historyDetails.safeParse(row.metadata);
          const changes =
            parsed.success && parsed.data.before
              ? Object.entries(parsed.data.before).filter(
                  ([key, value]) => JSON.stringify(value) !== JSON.stringify(parsed.data.after[key]),
                )
              : [];
          return (
            <details key={row.id} className="section">
              <summary>
                {labels[row.action as keyof typeof labels]} ·{" "}
                {new Date(row.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} ·{" "}
                {row.actor_user_id ? (names.get(row.actor_user_id) ?? "Administrator") : "System"}
              </summary>
              {parsed.success && parsed.data.reason && <p>Reason {parsed.data.reason}</p>}
              {parsed.success &&
                changes.map(([key, value]) => (
                  <div key={key} className="section">
                    <strong>{fieldNames[key] ?? key.replaceAll("_", " ")}</strong>
                    <div>Before</div>
                    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {JSON.stringify(value, null, 2)}
                    </pre>
                    <div>After</div>
                    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {JSON.stringify(parsed.data.after[key], null, 2)}
                    </pre>
                  </div>
                ))}
            </details>
          );
        })}
      </section>
    </>
  );
}
