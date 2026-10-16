import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { createClient } from "@/lib/supabase/server";
import { type CrmOption, type CrmRecord, crmModules, isCrmModule } from "@/modules/crm/config";
import type { DocumentVersion } from "@/modules/crm/documents";
import { canUseCrmModule } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";
import { SupportTools } from "../support-tools";
import { DocumentUpload } from "./document-upload";
import { ConvertButton, PaymentForm, RecordEditor } from "./record-form";

export default async function CrmPage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { module } = await params;
  if (!isCrmModule(module)) notFound();
  const identity = await requireIdentity();
  if (!canUseCrmModule(identity.role, module)) redirect("/crm");
  const admin = ["admin", "partner"].includes(identity.role);
  const client = await createClient();
  const filters = await searchParams;
  const page = Math.max(1, Math.min(100000, Number.parseInt(filters.page ?? "1", 10) || 1));
  const search = new URLSearchParams({ q: filters.q ?? "", status: filters.status ?? "" });
  let query = client
    .from(`crm_${module}`)
    .select("*", { count: "exact" })
    .eq("organization_id", identity.organizationId)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 50, page * 50 - 1);
  if (filters.status && crmModules[module].statuses.some((s) => s === filters.status))
    query = query.eq("status", filters.status);
  if (filters.q) query = query.ilike("title", `%${filters.q.replace(/[%_]/g, "").slice(0, 100)}%`);
  const [records, clients, employees] = await Promise.all([
    query,
    client.from("crm_clients").select("id,title").order("title"),
    client.from("employees").select("id,full_name").eq("active", true),
  ]);
  if (records.error) throw new Error(records.error.message);
  if (clients.error || employees.error) throw new Error("Record assignments unavailable. Please try again.");
  const items = (records.data ?? []) as CrmRecord[];
  const options = (clients.data ?? []) as CrmOption[];
  const people = (employees.data ?? []).map((e) => ({ id: e.id, title: e.full_name }));
  const versions =
    module === "documents" && items.length
      ? await client
          .from("crm_document_versions")
          .select("id,document_id,version,filename,byte_size,state,storage_path,uploaded_by,created_at")
          .eq("organization_id", identity.organizationId)
          .in(
            "document_id",
            items.map((item) => item.id),
          )
          .order("version", { ascending: false })
      : null;
  if (versions?.error) throw new Error("Document versions unavailable.");
  const payments =
    module === "invoices" ? await client.rpc("crm_invoice_receipts", { p_ids: items.map((i) => i.id) }) : null;
  if (payments?.error) throw new Error("Payment totals unavailable.");
  const receipts = (payments?.data ?? []) as Array<{ invoice_id: string; received: number }>;
  const clientNames = new Map(options.map((item) => [item.id, item.title]));
  const employeeNames = new Map(people.map((item) => [item.id, item.title]));
  const receivedAmounts = new Map(receipts.map((item) => [item.invoice_id, item.received]));
  const documentVersions = new Map<string, DocumentVersion[]>();
  for (const version of (versions?.data ?? []) as DocumentVersion[]) {
    const group = documentVersions.get(version.document_id) ?? [];
    group.push(version);
    documentVersions.set(version.document_id, group);
  }
  return (
    <>
      <PageHead eyebrow="CA CRM" title={crmModules[module].title} description="Your firm's records and work." />
      <form className="filters" style={{ marginBottom: 24 }}>
        <input
          name="q"
          type="search"
          defaultValue={filters.q}
          placeholder="Search records"
          aria-label="Search records"
        />
        <select name="status" defaultValue={filters.status ?? ""} aria-label="Status">
          <option value="">All statuses</option>
          {crmModules[module].statuses.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <button className="button button-secondary" type="submit">
          Filter
        </button>
        <Link className="button button-secondary" href={`/crm/${module}/export?${search}`}>
          Export CSV
        </Link>
      </form>
      <div className="filters">
        <span>
          {records.count ?? 0} records · Page {page}
        </span>
        {page > 1 && <Link href={`?${search}&page=${page - 1}`}>Previous</Link>}
        {page * 50 < (records.count ?? 0) && <Link href={`?${search}&page=${page + 1}`}>Next</Link>}
      </div>
      {admin && <RecordEditor module={module} clients={options} employees={people} admin />}
      <section className="section grid grid-2">
        {items.map((item) => (
          <article className="card" key={item.id}>
            <span className="eyebrow">{item.status.replaceAll("_", " ")}</span>
            <h2>{item.title}</h2>
            {(item.email || item.phone) && (
              <p>
                {item.email} {item.phone}
              </p>
            )}
            {item.notes && <p style={{ whiteSpace: "pre-wrap" }}>{item.notes}</p>}
            <p>{clientNames.get(item.client_id ?? "") ?? ""}</p>
            <p className="stat-note">
              {employeeNames.get(item.owner_id ?? "") ?? "Unassigned"}
              {item.due_date && ` · Due ${item.due_date}`}
            </p>
            {item.amount && (
              <p>
                INR {item.amount} · Received INR {receivedAmounts.get(item.id) ?? 0}
              </p>
            )}
            {module === "invoices" && admin && (
              <form action={`/crm/invoices/${item.id}/pdf`} method="get" className="filters">
                <select
                  name="template"
                  aria-label={`PDF design for ${item.title}`}
                  defaultValue={item.invoice_details?.template ?? "modern"}
                >
                  <option value="modern">Green invoice - Template 2</option>
                  <option value="classic">Classic bordered - Template 1</option>
                </select>
                <button className="button button-secondary" type="submit">
                  Generate invoice PDF
                </button>
              </form>
            )}
            {(admin || !["clients", "leads", "invoices"].includes(module)) && (
              <RecordEditor module={module} item={item} clients={options} employees={people} admin={admin} />
            )}
            {module === "leads" && admin && !item.client_id && <ConvertButton id={item.id} />}
            {module === "support" && <SupportTools id={item.id} admin={admin} />}
            {module === "documents" && (
              <DocumentUpload
                id={item.id}
                userId={identity.userId}
                admin={admin}
                versions={documentVersions.get(item.id) ?? []}
                storagePath={item.storage_path}
              />
            )}
            {module === "invoices" && admin && item.status === "issued" && (
              <details>
                <summary>Add payment</summary>
                <PaymentForm invoice={item.id} />
              </details>
            )}
          </article>
        ))}
      </section>
      {!items.length && <div className="empty">No records match these filters.</div>}
    </>
  );
}
