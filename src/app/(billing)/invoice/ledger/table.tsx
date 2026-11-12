import Link from "next/link";
import { billingDate, inr, type LedgerRow, ledgerStatus } from "@/modules/billing/ledger";
import { CancelInvoiceForm } from "./cancel-form";

export function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const today = billingDate();
  return (
    <div className="billing-scroll">
      <table className="billing-table">
        <thead>
          <tr>
            {[
              "Date / time",
              "Invoice #",
              "Client name",
              "Due date",
              "Total amount",
              "Balance due",
              "Status",
              "Actions",
            ].map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const overdue = row.balance > 0 && row.due_date && row.due_date < today;
            const pdf = `/crm/invoices/${row.id}/pdf`;
            return (
              <tr key={row.id} data-status={row.status}>
                <td>
                  {row.invoice_date}
                  <small>
                    {new Date(row.created_at).toLocaleTimeString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </td>
                <td>
                  <Link href={`/invoice/raise?id=${row.id}`}>{row.invoice_number}</Link>
                </td>
                <td>
                  <Link href={`/invoice/clients/${row.client_id}`}>{row.client_name}</Link>
                </td>
                <td className={overdue ? "billing-amount-due" : undefined}>
                  {row.due_date ?? "—"}
                  {overdue && <small>Overdue</small>}
                </td>
                <td>{inr.format(row.amount)}</td>
                <td className={row.balance > 0 ? "billing-amount-due" : undefined}>{inr.format(row.balance)}</td>
                <td>
                  <span
                    className={`status status-${row.status === "unpaid" ? "red" : row.status === "partial" ? "amber" : row.status === "paid" ? "green" : "blue"}`}
                  >
                    {ledgerStatus[row.status]}
                  </span>
                </td>
                <td>
                  <a href={pdf}>PDF</a>
                  {row.status !== "draft" && row.status !== "cancelled" && (
                    <>
                      {" "}
                      · <Link href={`/invoice/raise?id=${row.id}#invoice-sharing`}>Share</Link>
                    </>
                  )}
                  {row.balance > 0 && (
                    <>
                      {" "}
                      · <Link href={`/invoice/receipts?invoice=${row.id}`}>Record payment</Link>
                    </>
                  )}
                  {row.status === "unpaid" && <CancelInvoiceForm invoice={row.id} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="billing-empty">No invoices match these filters.</p>}
    </div>
  );
}
