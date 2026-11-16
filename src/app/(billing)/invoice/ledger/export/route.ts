import { createClient } from "@/lib/supabase/server";
import { ledgerFilters, ledgerStatus, readLedger } from "@/modules/billing/ledger";
import { requireCrmIdentity } from "@/modules/identity/crm";

function csvCell(value: string | number | null) {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  await requireCrmIdentity();
  const filters = ledgerFilters.parse(Object.fromEntries(new URL(request.url).searchParams));
  const client = await createClient();
  const result = await readLedger(client, { ...filters, page: 1, size: 5000 }).catch(() => null);
  if (!result) return new Response("Ledger unavailable. Check the date range.", { status: 503 });
  if (result.total > 5000)
    return new Response("Select a narrower date range to export up to 5,000 invoices.", { status: 413 });
  const csv = [
    ["Date", "Invoice #", "Client", "Due date", "Amount", "Received", "Balance", "Status"],
    ...result.rows.map((row) => [
      row.invoice_date,
      row.invoice_number,
      row.client_name,
      row.due_date,
      row.amount,
      row.received,
      row.balance,
      ledgerStatus[row.status],
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="invoice-ledger.csv"',
      "Cache-Control": "no-store",
    },
  });
}
