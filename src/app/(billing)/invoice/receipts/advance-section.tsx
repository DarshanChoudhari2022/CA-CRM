import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { billingDate, inr, ledgerFilters, readLedger } from "@/modules/billing/ledger";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { AdvanceForm, AllocateAdvanceForm } from "./advance-forms";

type Advance = {
  id: string;
  client_id: string;
  received_on: string;
  amount: number;
  remaining: number;
  mode: string;
  reference: string;
  crm_clients: { title: string } | null;
};

export async function AdvanceSection({ selection, notice }: { selection: unknown; notice: unknown }) {
  const { organizationId } = await requireCrmIdentity();
  const client = await createClient();
  const fields = "id,client_id,received_on,amount,remaining,mode,reference,crm_clients(title)";
  const id = z.uuid().safeParse(selection).data;
  const [recent, clients, selected] = await Promise.all([
    client
      .from("billing_advances")
      .select(fields)
      .eq("organization_id", organizationId)
      .order("received_on", { ascending: false })
      .order("id")
      .limit(50)
      .returns<Advance[]>(),
    client
      .from("crm_clients")
      .select("id,title")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("title")
      .limit(250),
    id
      ? client.from("billing_advances").select(fields).eq("organization_id", organizationId).eq("id", id).maybeSingle()
      : null,
  ]);
  const advance = selected?.data;
  const [unpaid, partial] =
    advance && advance.remaining > 0
      ? await Promise.all([
          readLedger(client, ledgerFilters.parse({ client: advance.client_id, status: "unpaid", size: 100 })).catch(
            () => null,
          ),
          readLedger(client, ledgerFilters.parse({ client: advance.client_id, status: "partial", size: 100 })).catch(
            () => null,
          ),
        ])
      : [null, null];
  const invoices = [...(unpaid?.rows ?? []), ...(partial?.rows ?? [])];
  return (
    <section className="billing-card section" aria-labelledby="advances">
      <h2 id="advances">Advance payments</h2>
      {notice === "recorded" && <p role="status">Advance recorded.</p>}
      {notice === "allocated" && <p role="status">Advance applied to the invoice.</p>}
      {recent.error || clients.error ? (
        <p role="alert">Advance payments are unavailable.</p>
      ) : (
        <>
          <AdvanceForm
            clients={clients.data.map(({ id: clientId, title }) => ({ id: clientId, label: title }))}
            today={billingDate()}
          />
          {advance && advance.remaining > 0 && (
            <div className="section">
              <h3>
                Allocate {advance.reference} · {inr.format(advance.remaining)} available
              </h3>
              {unpaid && partial && invoices.length > 0 ? (
                <AllocateAdvanceForm
                  id={advance.id}
                  request={crypto.randomUUID()}
                  balance={advance.remaining}
                  invoices={invoices.map((row) => ({
                    id: row.id,
                    label: `${row.invoice_number} · ${inr.format(row.balance)} due`,
                  }))}
                />
              ) : (
                <p>
                  {unpaid && partial
                    ? "This client has no outstanding invoices."
                    : "Outstanding invoices could not be loaded."}
                </p>
              )}
            </div>
          )}
          <div className="billing-scroll">
            <table className="billing-table">
              <thead>
                <tr>
                  {["Date", "Reference", "Client", "Mode", "Received", "Unapplied", "Action"].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.data.map((row) => (
                  <tr key={row.id}>
                    <td>{row.received_on}</td>
                    <td>{row.reference}</td>
                    <td>
                      <Link href={`/invoice/clients/${row.client_id}`}>{row.crm_clients?.title ?? "Client"}</Link>
                    </td>
                    <td>{row.mode}</td>
                    <td>{inr.format(row.amount)}</td>
                    <td>{inr.format(row.remaining)}</td>
                    <td>
                      {row.remaining > 0 ? <Link href={`?advance=${row.id}#advances`}>Allocate</Link> : "Allocated"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!recent.data.length && <p className="billing-empty">No advance payments recorded.</p>}
        </>
      )}
    </section>
  );
}
