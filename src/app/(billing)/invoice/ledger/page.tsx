import { Download, Plus } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ledgerFilters, ledgerStatus, readLedger } from "@/modules/billing/ledger";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { LedgerTable } from "./table";

export default async function InvoiceLedger({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const identity = await requireCrmIdentity();
  const filters = ledgerFilters.parse(await searchParams);
  const client = await createClient();
  const [ledger, clients] = await Promise.all([
    readLedger(client, filters).catch(() => null),
    client
      .from("crm_clients")
      .select("id,title")
      .eq("organization_id", identity.organizationId)
      .order("title")
      .limit(250),
  ]);
  const params = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]));
  const pageLink = (page: number) => `?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page) })}`;
  return (
    <>
      <header className="billing-toolbar billing-heading">
        <div>
          <h1>Invoice Ledger</h1>
          <div className="billing-muted">Tax invoices and payment tracking</div>
        </div>
        <div className="billing-toolbar">
          <a className="billing-button" href={`/invoice/ledger/export?${params}`}>
            <Download size={16} /> Download report
          </a>
          <Link className="billing-button billing-primary" href="/invoice/raise">
            <Plus size={16} /> New invoice
          </Link>
        </div>
      </header>
      <form method="get" className="billing-toolbar">
        <select name="status" aria-label="Status" defaultValue={filters.status}>
          <option value="all">All statuses</option>
          {Object.entries(ledgerStatus).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="client" aria-label="Client" defaultValue={filters.client}>
          <option value="">All clients</option>
          {clients.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <input
          type="search"
          name="q"
          aria-label="Invoice number, amount or client"
          placeholder="Invoice #, amount, client…"
          defaultValue={filters.q}
          maxLength={100}
        />
        <input type="date" name="from" aria-label="From date" defaultValue={filters.from} />
        <input type="date" name="to" aria-label="To date" defaultValue={filters.to} />
        <select name="size" aria-label="Rows per page" defaultValue={filters.size}>
          {[25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </select>
        <button type="submit" className="billing-button">
          Apply filters
        </button>
      </form>
      {!ledger ? (
        <p className="form-error" role="alert">
          Ledger unavailable. Check the date range and the Invoice database migration.
        </p>
      ) : (
        <section className="billing-card">
          <LedgerTable rows={ledger.rows} />
          <footer className="billing-toolbar billing-heading">
            <p>
              {ledger.rows.length
                ? `${(filters.page - 1) * filters.size + 1}–${(filters.page - 1) * filters.size + ledger.rows.length} of ${ledger.total}`
                : `${ledger.total} invoices`}
            </p>
            <div>
              {filters.page > 1 && (
                <Link className="billing-button" href={pageLink(filters.page - 1)}>
                  Previous
                </Link>
              )}{" "}
              {filters.page * filters.size < ledger.total && (
                <Link className="billing-button" href={pageLink(filters.page + 1)}>
                  Next
                </Link>
              )}
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
