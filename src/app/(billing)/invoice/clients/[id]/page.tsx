import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { inr, ledgerStatus, readLedger } from "@/modules/billing/ledger";
import { requireCrmIdentity } from "@/modules/identity/crm";
import {
  billingDate,
  billingHref,
  money,
  pageNumber,
  pageSize,
  queryId,
  type SearchParams,
  toPaise,
} from "../../receipts/format";
import { Pagination } from "../../receipts/pagination";
import { ClientForm } from "../client-form";

const receipts = "/invoice/receipts";

export default async function ClientLedger({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { organizationId } = await requireCrmIdentity();
  const id = queryId((await params).id);
  if (!id) notFound();
  const db = await createClient();
  const { data: client, error } = await db
    .from("crm_clients")
    .select("id,title,status,email,phone,notes,updated_at")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load the client.");
  if (!client) notFound();

  const filters = await searchParams;
  const editing = filters.edit === "1";
  const page = Math.min(pageNumber(filters.page), 100000);
  const from = z.iso.date().safeParse(filters.from).data;
  const to = z.iso.date().safeParse(filters.to).data;
  const invalidRange = Boolean(from && to && from > to);
  const path = `/invoice/clients/${id}`;
  const [ledger, totalsResult] = invalidRange
    ? [{ total: 0, rows: [] }, null]
    : await Promise.all([
        readLedger(db, {
          client: id,
          from: from ?? "",
          to: to ?? "",
          status: "all",
          q: "",
          page,
          size: pageSize,
        }),
        db.rpc("billing_client_totals", { p_client: id, p_from: from ?? null, p_to: to ?? null }),
      ]);
  const totals = z
    .object({ billed: z.number(), received: z.number(), outstanding: z.number(), unapplied: z.number() })
    .safeParse(totalsResult?.data).data;

  return (
    <>
      <Link href="/invoice/clients" className="billing-button mb-3">
        Client Directory
      </Link>
      <header className="billing-toolbar billing-heading">
        <div>
          <h1>{client.title}</h1>
          <p className="billing-muted">
            Client ledger · <span className="capitalize">{client.status}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="billing-button" href={billingHref(receipts, { client: id })}>
            View receipts
          </Link>
          <Link
            className="billing-button billing-primary"
            href={billingHref(path, { from, to, page, edit: editing ? undefined : "1" })}
          >
            {editing ? "Cancel edit" : "Edit client"}
          </Link>
        </div>
      </header>
      <section className="billing-card mb-4" aria-label="Client details">
        {editing ? (
          <ClientForm client={client} />
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="billing-muted">Email</dt>
              <dd>{client.email || "—"}</dd>
            </div>
            <div>
              <dt className="billing-muted">Phone</dt>
              <dd>{client.phone || "—"}</dd>
            </div>
            {client.notes && (
              <div className="sm:col-span-2">
                <dt className="billing-muted">Notes</dt>
                <dd className="whitespace-pre-wrap">{client.notes}</dd>
              </div>
            )}
          </dl>
        )}
      </section>
      {totals && (
        <section className="billing-grid billing-metrics" aria-label="Client balances">
          {(
            [
              ["Total billing", totals.billed],
              ["Amount received", totals.received],
              ["Outstanding", totals.outstanding],
              ["Unapplied advances", totals.unapplied],
            ] as const
          ).map(([label, value]) => (
            <div className="billing-card billing-metric" key={label}>
              <small>{label}</small>
              <strong>{inr.format(value)}</strong>
            </div>
          ))}
        </section>
      )}
      <section className="billing-card" aria-label="Client invoices">
        <h2 className="mb-3">Invoices</h2>
        <form action={path} className="billing-toolbar" key={`${from}:${to}`}>
          <label className="grid gap-1">
            Invoice date from
            <input name="from" type="date" defaultValue={from} />
          </label>
          <label className="grid gap-1">
            Invoice date through
            <input name="to" type="date" defaultValue={to} />
          </label>
          <button className="billing-button self-end" type="submit">
            Apply filters
          </button>
          {(from || to) && (
            <Link href={path} className="billing-button self-end">
              Clear
            </Link>
          )}
        </form>
        {invalidRange && (
          <p role="alert" className="text-red-700">
            The end date must be on or after the start date.
          </p>
        )}
        <div className="billing-scroll">
          <table className="billing-table">
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Invoice date</th>
                <th scope="col">Due date</th>
                <th scope="col">Status</th>
                <th scope="col">Invoice total</th>
                <th scope="col">Received</th>
                <th scope="col">Outstanding</th>
                <th scope="col">Receipts</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoice_number}</td>
                  <td>{billingDate(invoice.invoice_date)}</td>
                  <td>{billingDate(invoice.due_date)}</td>
                  <td>{ledgerStatus[invoice.status]}</td>
                  <td>{money(toPaise(invoice.amount))}</td>
                  <td>{money(toPaise(invoice.received))}</td>
                  <td>{money(toPaise(invoice.balance))}</td>
                  <td className="whitespace-nowrap">
                    {invoice.balance > 0 || invoice.received > 0 ? (
                      <Link href={billingHref(receipts, { invoice: invoice.id })}>
                        {invoice.balance > 0 ? "Record payment" : "View receipts"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ledger.rows.length && !invalidRange && <p className="billing-empty">No invoices match these filters.</p>}
        <Pagination
          page={page}
          hasNext={page < 100000 && page * pageSize < ledger.total}
          href={(next) => billingHref(path, { from, to, page: next })}
        />
      </section>
    </>
  );
}
