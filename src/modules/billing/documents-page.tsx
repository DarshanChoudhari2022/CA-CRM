import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { defaultInvoiceDetails, invoiceDetailsSchema } from "@/modules/crm/invoice-details";
import { requireCrmIdentity } from "@/modules/identity/crm";
import {
  type BillingKind,
  billingDocumentNumber,
  billingLabels,
  billingPath,
  formatBillingAmount,
  isAdjustment,
} from "./documents";
import styles from "./documents.module.css";
import {
  BillingDocumentForm,
  BillingDocumentTransition,
  type BillingFormData,
  type ClientChoice,
  type ServiceChoice,
  type SourceInvoice,
} from "./documents-form";
import { InvoiceSharing } from "./invoice-sharing";

const documentFields = "id,title,notes,status,client_id,amount,due_date,created_at,updated_at,invoice_details";
const invoiceFields = `${documentFields},invoice_number` as const;
const supplementalFields = `${documentFields},kind,source_invoice_id,accepted_at,converted_invoice_id` as const;
const standardInvoice = "invoice_details->>documentType.is.null,invoice_details->>documentType.eq.invoice";
const pageSize = 25;

function clientTitle(joined: unknown) {
  const row: unknown = Array.isArray(joined) ? joined[0] : joined;
  return row && typeof row === "object" && "title" in row && typeof row.title === "string" ? row.title : "—";
}

export type BillingSearch = Promise<{ id?: string | string[]; new?: string | string[]; page?: string | string[] }>;

export async function BillingDocumentsPage({
  section,
  searchParams,
}: {
  section: "invoice" | "quotation" | "proforma" | "notes";
  searchParams: BillingSearch;
}) {
  const identity = await requireCrmIdentity();
  const organizationId = identity.organizationId;
  const db = await createClient();
  const query = await searchParams;
  const id = query.id ? z.uuid().safeParse(query.id) : undefined;
  if (id && !id.success) notFound();
  const kinds: BillingKind[] = section === "notes" ? ["credit_note", "debit_note"] : [section];
  const path = billingPath(kinds[0]);
  const requestedKind = kinds.find((kind) => kind === query.new);
  const editOrCreate = id?.success || requestedKind || (section === "invoice" && query.page === undefined);
  const rawPage = typeof query.page === "string" && /^\d{1,6}$/.test(query.page) ? Number(query.page) : 1;
  const page = Math.max(1, rawPage);

  const saved = id?.success
    ? section === "invoice"
      ? await db
          .from("crm_invoices")
          .select(invoiceFields)
          .eq("organization_id", organizationId)
          .eq("id", id.data)
          .or(standardInvoice)
          .maybeSingle()
      : await db
          .from("billing_documents")
          .select(supplementalFields)
          .eq("organization_id", organizationId)
          .eq("id", id.data)
          .in("kind", kinds)
          .maybeSingle()
    : null;
  if (saved?.error) throw new Error("Could not load billing document.");
  if (id?.success && !saved?.data) notFound();
  const record = saved?.data;
  const kind =
    record && "kind" in record ? (kinds.find((item) => item === record.kind) ?? kinds[0]) : (requestedKind ?? kinds[0]);

  if (editOrCreate) {
    const editing = !record || record.status === "draft";
    const clients: ClientChoice[] = [];
    const sources: SourceInvoice[] = [];
    const services: ServiceChoice[] = [];
    if (editing && !isAdjustment(kind)) {
      for (let start = 0; ; start += 500) {
        const { data, error } = await db
          .from("billing_service_catalog")
          .select("id,name,description,sac_code,unit_price")
          .eq("organization_id", organizationId)
          .eq("active", true)
          .order("name")
          .order("id")
          .range(start, start + 499);
        if (error) throw new Error("Could not load the billing service catalog.");
        services.push(...data);
        if (data.length < 500) break;
      }
    }
    if (editing) {
      for (let start = 0; ; start += 500) {
        const { data, error } = await db
          .from("crm_clients")
          .select("id,title,email,phone")
          .eq("organization_id", organizationId)
          .order("title")
          .order("id")
          .range(start, start + 499);
        if (error) throw new Error("Could not load billing clients.");
        clients.push(...data);
        if (data.length < 500) break;
      }
      if (isAdjustment(kind)) {
        for (let start = 0; ; start += 500) {
          const { data, error } = await db
            .from("crm_invoices")
            .select("id,client_id,invoice_number,title")
            .eq("organization_id", organizationId)
            .eq("status", "issued")
            .or(standardInvoice)
            .order("created_at", { ascending: false })
            .order("id")
            .range(start, start + 499);
          if (error) throw new Error("Could not load source invoices.");
          sources.push(...data);
          if (data.length < 500) break;
        }
      }
    } else {
      const { data, error } = await db
        .from("crm_clients")
        .select("id,title,email,phone")
        .eq("organization_id", organizationId)
        .eq("id", record.client_id)
        .single();
      if (error) throw new Error("Could not load billing client.");
      clients.push(data);
    }
    const parsed = invoiceDetailsSchema.safeParse(record?.invoice_details);
    const initial: BillingFormData = {
      id: record?.id ?? null,
      updatedAt: record?.updated_at ?? null,
      status: record?.status ?? "draft",
      number: record
        ? kind === "invoice" && "invoice_number" in record
          ? record.invoice_number
          : kind !== "invoice"
            ? billingDocumentNumber(kind, record.id)
            : null
        : null,
      title: record?.title ?? "",
      notes: record?.notes ?? "",
      clientId: record?.client_id ?? "",
      dueDate: record?.due_date ?? "",
      sourceId: record && "source_invoice_id" in record ? (record.source_invoice_id ?? "") : "",
      details: parsed.success
        ? parsed.data
        : defaultInvoiceDetails(
            record?.title ?? "",
            Number(record?.amount ?? 0),
            record?.created_at ?? new Date().toISOString(),
          ),
    };
    return (
      <section>
        <header className="billing-toolbar">
          <div>
            <h1>
              {record
                ? `${editing ? "Edit draft" : "View"} · ${billingLabels[kind]}`
                : section === "invoice"
                  ? "Raise invoice"
                  : `New ${billingLabels[kind].toLowerCase()}`}
            </h1>
            {isAdjustment(kind) && <p>Draft only. This adjustment does not change the invoice balance.</p>}
          </div>
          <Link className="billing-button" href={section === "invoice" ? `${path}?page=1` : path}>
            {section === "invoice"
              ? "Invoice drafts"
              : section === "notes"
                ? "All notes"
                : `All ${billingLabels[kind].toLowerCase()}s`}
          </Link>
        </header>
        <BillingDocumentForm
          key={`${kind}:${initial.id ?? "new"}:${initial.updatedAt ?? ""}`}
          kind={kind}
          initial={initial}
          clients={clients}
          sources={sources}
          services={services}
          requestId={crypto.randomUUID()}
        />
        {kind === "invoice" && record?.status === "issued" && initial.number && clients[0] && (
          <InvoiceSharing
            invoice={record.id}
            number={initial.number}
            amount={Number(record.amount)}
            client={clients[0]}
          />
        )}
        {record?.status === "issued" &&
          "converted_invoice_id" in record &&
          (kind === "quotation" || kind === "proforma") && (
            <div className="billing-card">
              {record.converted_invoice_id ? (
                <Link className="billing-button" href={`/invoice/raise?id=${record.converted_invoice_id}`}>
                  View converted invoice
                </Link>
              ) : (
                <BillingDocumentTransition
                  key={record.updated_at}
                  kind={kind}
                  id={record.id}
                  accepted={Boolean(record.accepted_at)}
                />
              )}
            </div>
          )}
      </section>
    );
  }

  const start = (page - 1) * pageSize;
  const [result, legacy] = await Promise.all([
    section === "invoice"
      ? db
          .from("crm_invoices")
          .select(`${invoiceFields},crm_clients(title)`)
          .eq("organization_id", organizationId)
          .eq("status", "draft")
          .or(standardInvoice)
          .order("updated_at", { ascending: false })
          .order("id")
          .range(start, start + pageSize)
      : db
          .from("billing_documents")
          .select(`${supplementalFields},crm_clients(title)`)
          .eq("organization_id", organizationId)
          .in("kind", kinds)
          .order("updated_at", { ascending: false })
          .order("id")
          .range(start, start + pageSize),
    section === "quotation"
      ? db
          .from("crm_invoices")
          .select("id,invoice_number,title,status,amount,crm_clients(title)")
          .eq("organization_id", organizationId)
          .eq("invoice_details->>documentType", "quotation")
          .order("updated_at", { ascending: false })
          .order("id")
          .range(start, start + pageSize)
      : Promise.resolve(null),
  ]);
  if (result.error || legacy?.error) throw new Error("Could not load billing documents.");
  const rows = result.data.slice(0, pageSize);
  const heading =
    section === "invoice"
      ? "Invoice drafts"
      : section === "notes"
        ? "Credit and debit notes"
        : section === "quotation"
          ? "Quotations"
          : "Proforma invoices";
  return (
    <section>
      <header className="billing-toolbar">
        <div>
          <h1>{heading}</h1>
          {section === "notes" && <p>Draft adjustments linked to issued invoices.</p>}
        </div>
        <div className="billing-toolbar">
          {kinds.map((item) => (
            <Link key={item} className="billing-button billing-primary" href={`${path}?new=${item}`}>
              New {billingLabels[item].toLowerCase()}
            </Link>
          ))}
        </div>
      </header>
      <div className="billing-card">
        {rows.length === 0 ? (
          <p>No documents on this page.</p>
        ) : (
          <div className={styles.scroll}>
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rowKind = "kind" in row ? (kinds.find((item) => item === row.kind) ?? kind) : kind;
                  const details = invoiceDetailsSchema.safeParse(row.invoice_details);
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.title}</strong>
                        <br />
                        {details.data?.reference ||
                          ("invoice_number" in row ? row.invoice_number : billingLabels[rowKind])}
                      </td>
                      <td>{clientTitle(row.crm_clients)}</td>
                      <td className={styles.documentStatus}>
                        {"converted_invoice_id" in row && row.converted_invoice_id
                          ? "Converted"
                          : "accepted_at" in row && row.accepted_at
                            ? "Accepted"
                            : row.status}
                      </td>
                      <td>{formatBillingAmount.format(Number(row.amount))}</td>
                      <td>
                        <Link href={`${path}?id=${row.id}`}>{row.status === "draft" ? "Edit draft" : "View"}</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {legacy?.data.length ? (
        <div className="billing-card">
          <h2>Existing CRM quotations</h2>
          <div className={styles.scroll}>
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Quotation</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>PDF</th>
                </tr>
              </thead>
              <tbody>
                {legacy.data.slice(0, pageSize).map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.title}
                      <br />
                      {row.invoice_number}
                    </td>
                    <td>{clientTitle(row.crm_clients)}</td>
                    <td className={styles.documentStatus}>{row.status}</td>
                    <td>{formatBillingAmount.format(Number(row.amount))}</td>
                    <td>
                      <a href={`/crm/invoices/${row.id}/pdf`}>Download PDF</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {(page > 1 || result.data.length > pageSize || (legacy?.data.length ?? 0) > pageSize) && (
        <nav className="billing-toolbar" aria-label="Document pages">
          {page > 1 && (
            <Link className="billing-button" href={`${path}?page=${page - 1}`}>
              Previous
            </Link>
          )}
          <span>Page {page}</span>
          {(result.data.length > pageSize || (legacy?.data.length ?? 0) > pageSize) && (
            <Link className="billing-button" href={`${path}?page=${page + 1}`}>
              Next
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
