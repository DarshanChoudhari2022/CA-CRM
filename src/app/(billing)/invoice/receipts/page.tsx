import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { AdvanceSection } from "./advance-section";
import {
  billingDate,
  billingHref,
  containsPattern,
  money,
  pageNumber,
  pageSize,
  queryId,
  queryText,
  type SearchParams,
  toPaise,
} from "./format";
import { Pagination } from "./pagination";
import { ReceiptForm } from "./receipt-form";

const path = "/invoice/receipts";

type ReceiptRow = {
  id: string;
  created_at: string;
  amount: number;
  reference: string;
  invoice: {
    id: string;
    title: string;
    invoice_number: string;
    client_id: string;
    client: { title: string } | null;
  };
};

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organizationId } = await requireCrmIdentity();
  const params = await searchParams;
  const invoice = queryId(params.invoice);
  const client = queryId(params.client);
  const q = queryText(params.q);
  const number = queryText(params.number, 40);
  const from = z.iso.date().safeParse(params.from).data;
  const to = z.iso.date().safeParse(params.to).data;
  const invalidRange = Boolean(from && to && from > to);
  const invalidSelection = (params.invoice !== undefined && !invoice) || (params.client !== undefined && !client);
  const page = pageNumber(params.page);
  const offset = (page - 1) * pageSize;
  const db = await createClient();

  let query = db
    .from("crm_payments")
    .select(
      "id,created_at,amount,reference,invoice:crm_invoices!inner(id,title,invoice_number,client_id,client:crm_clients!inner(title))",
    )
    .eq("organization_id", organizationId)
    .eq("invoice.organization_id", organizationId)
    .eq("invoice.client.organization_id", organizationId);
  if (invoice) query = query.eq("invoice_id", invoice);
  if (client) query = query.eq("invoice.client_id", client);
  if (q) query = query.ilike("reference", containsPattern(q));
  if (number) {
    const pattern = containsPattern(number).replace(/["\\]/g, "\\$&");
    query = query.or(`invoice_number.ilike."${pattern}",invoice_details->>reference.ilike."${pattern}"`, {
      referencedTable: "invoice",
    });
  }
  if (from) query = query.gte("created_at", `${from}T00:00:00+05:30`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999999+05:30`);

  const [receiptResult, invoiceResult, clientResult] = await Promise.all([
    invalidRange || invalidSelection
      ? null
      : query
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + pageSize)
          .returns<ReceiptRow[]>(),
    invoice && !invalidSelection
      ? db
          .from("crm_invoices")
          .select("id,title,status,amount,client_id,invoice_number,invoice_details")
          .eq("organization_id", organizationId)
          .eq("id", invoice)
          .maybeSingle()
      : null,
    client && !invalidSelection
      ? db.from("crm_clients").select("title").eq("organization_id", organizationId).eq("id", client).maybeSingle()
      : null,
  ]);
  if (receiptResult?.error || invoiceResult?.error || clientResult?.error) throw new Error("Could not load receipts.");
  const candidate = invoiceResult?.data;
  const selected = candidate && (!client || client === candidate.client_id) ? candidate : null;
  const rows = receiptResult?.data ?? [];
  const payable = selected?.status === "issued" && (selected.invoice_details?.documentType ?? "invoice") === "invoice";
  const paymentTotal = payable ? await db.rpc("billing_receipt_total", { p_invoice: selected.id }) : null;
  if (paymentTotal?.error) throw new Error("Could not load the invoice payment total.");
  const paid = paymentTotal ? toPaise(z.number().parse(paymentTotal.data)) : 0;
  const total = payable ? toPaise(selected.amount) : 0;
  const outstanding = total - paid;
  const filter = { invoice, client, q, number, from, to };

  return (
    <>
      <header className="billing-toolbar billing-heading">
        <h1>Receipts</h1>
        <Link href="/invoice/ledger" className="billing-button">
          Find an invoice
        </Link>
      </header>
      {invalidSelection || (invoice && !selected) || (client && !clientResult?.data) ? (
        <p role="alert" className="billing-card mb-4">
          The selected invoice or client is unavailable.{" "}
          <Link href={path} className="underline">
            View all receipts
          </Link>
        </p>
      ) : null}
      {selected && (
        <section className="billing-card mb-4">
          <div className="billing-toolbar billing-heading">
            <div>
              <h2>{selected.title}</h2>
              <p className="billing-muted">{selected.invoice_details?.reference || selected.invoice_number}</p>
            </div>
            <Link className="billing-button" href={`/invoice/clients/${selected.client_id}`}>
              Client ledger
            </Link>
          </div>
          {payable ? (
            <>
              <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <dt className="billing-muted">Invoice total</dt>
                  <dd className="font-semibold">{money(total)}</dd>
                </div>
                <div>
                  <dt className="billing-muted">Received</dt>
                  <dd className="font-semibold">{money(paid)}</dd>
                </div>
                <div>
                  <dt className="billing-muted">Outstanding</dt>
                  <dd className="font-semibold">{money(outstanding)}</dd>
                </div>
                <div>
                  <dt className="billing-muted">Settlement</dt>
                  <dd className="font-semibold">
                    {outstanding <= 0 ? "Paid in full" : paid ? "Partially paid" : "Unpaid"}
                  </dd>
                </div>
              </dl>
              {outstanding > 0 && <ReceiptForm key={selected.id} invoice={selected.id} outstanding={outstanding} />}
            </>
          ) : (
            <p className="billing-muted">Only issued invoices accept payments.</p>
          )}
        </section>
      )}
      <section className="billing-card mb-4" aria-labelledby="receipt-history">
        <h2 id="receipt-history" className="mb-3">
          Payment history{clientResult?.data ? ` · ${clientResult.data.title}` : ""}
        </h2>
        <form action={path} className="billing-toolbar" key={billingHref(path, filter)}>
          {invoice && <input type="hidden" name="invoice" value={invoice} />}
          {client && <input type="hidden" name="client" value={client} />}
          <label className="grid gap-1">
            Reference
            <input type="search" name="q" defaultValue={q} maxLength={120} />
          </label>
          <label className="grid gap-1">
            Invoice number
            <input type="search" name="number" defaultValue={number} maxLength={40} />
          </label>
          <label className="grid gap-1">
            Recorded from
            <input type="date" name="from" defaultValue={from} />
          </label>
          <label className="grid gap-1">
            Recorded through
            <input type="date" name="to" defaultValue={to} />
          </label>
          <button type="submit" className="billing-button self-end">
            Apply filters
          </button>
          {(q || number || from || to || invoice || client) && (
            <Link className="billing-button self-end" href={path}>
              Clear filters
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
                <th scope="col">Recorded</th>
                <th scope="col">Reference</th>
                <th scope="col">Client</th>
                <th scope="col">Invoice</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, pageSize).map((receipt) => (
                <tr key={receipt.id}>
                  <td className="whitespace-nowrap">{billingDate(receipt.created_at)}</td>
                  <td>{receipt.reference}</td>
                  <td>
                    {receipt.invoice.client ? (
                      <Link href={`/invoice/clients/${receipt.invoice.client_id}`}>{receipt.invoice.client.title}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <Link href={billingHref(path, { invoice: receipt.invoice.id })}>
                      {receipt.invoice.invoice_number}
                    </Link>
                    <small>{receipt.invoice.title}</small>
                  </td>
                  <td className="whitespace-nowrap">{money(toPaise(receipt.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && !invalidRange && !invalidSelection && (
          <p className="billing-empty">No payments match these filters.</p>
        )}
        <Pagination
          page={page}
          hasNext={rows.length > pageSize}
          href={(next) => billingHref(path, { ...filter, page: next })}
        />
      </section>
      <AdvanceSection selection={params.advance} notice={params.advanceResult} />
    </>
  );
}
