import { CircleAlert, CircleCheck, FilePlus, Plus, Receipt, TrendingUp, UserPlus, Wallet } from "lucide-react";
import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { billingDate, dashboardData, inr, ledgerFilters, readLedger } from "@/modules/billing/ledger";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { LedgerTable } from "./ledger/table";
import { TrendChart } from "./trend-chart";

const periods = [
  ["fy", "Current FY"],
  ["month", "Current month"],
  ["quarter", "Previous quarter"],
  ["custom", "Custom range"],
] as const;
const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });

function periodBounds(query: Record<string, string | string[]>) {
  const today = billingDate();
  const [year, month] = today.split("-").map(Number);
  const period = periods.find(([key]) => key === query.period)?.[0] ?? "fy";
  if (period === "custom") {
    const dates = z.object({ from: z.iso.date(), to: z.iso.date() }).safeParse(query);
    return { period, from: dates.success ? dates.data.from : "", to: dates.success ? dates.data.to : "" };
  }
  if (period === "month") return { period, from: `${today.slice(0, 7)}-01`, to: today };
  if (period === "quarter") {
    const quarterMonth = Math.floor((month - 1) / 3) * 3;
    return {
      period,
      from: new Date(Date.UTC(year, quarterMonth - 3, 1)).toISOString().slice(0, 10),
      to: new Date(Date.UTC(year, quarterMonth, 0)).toISOString().slice(0, 10),
    };
  }
  return { period, from: `${month >= 4 ? year : year - 1}-04-01`, to: today };
}

export default async function InvoiceDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  await requireCrmIdentity();
  const { period, from, to } = periodBounds(await searchParams);
  const client = await createClient();
  const [stats, recent] = await Promise.all([
    from && to ? client.rpc("billing_invoice_dashboard", { p_from: from, p_to: to }) : null,
    readLedger(client, ledgerFilters.parse({}))
      .then((data) => data.rows.slice(0, 5))
      .catch(() => []),
  ]);
  const data = dashboardData.safeParse(stats?.data);
  const totals = data.success ? data.data : null;
  const percent = totals?.billed ? Math.min(100, Math.round((totals.collected * 100) / totals.billed)) : 0;
  return (
    <>
      <header className="billing-toolbar billing-heading">
        <div>
          <h1>Invoice Dashboard</h1>
          <div className="billing-muted">Your practice at a glance</div>
        </div>
        <form className="billing-toolbar" method="get">
          <select name="period" aria-label="Reporting period" defaultValue={period}>
            {periods.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="from"
            aria-label="Custom range start"
            defaultValue={period === "custom" ? from : ""}
          />
          <input type="date" name="to" aria-label="Custom range end" defaultValue={period === "custom" ? to : ""} />
          <button type="submit" className="billing-button">
            Apply
          </button>
        </form>
      </header>
      {totals ? (
        <section className="billing-grid billing-metrics" aria-label="Invoice summary">
          {[
            ["Net invoiced", totals.billed, `${totals.count} issued invoices`, Wallet],
            ["Amount collected", totals.collected, `${percent}% of billed amount`, CircleCheck],
            ["Outstanding", totals.outstanding, "Pending from clients", CircleAlert],
            ["Average invoice value", totals.average, "Per issued invoice", TrendingUp],
          ].map(([label, value, note, Icon]) => {
            const MetricIcon = Icon as typeof Wallet;
            return (
              <div key={String(label)} className="billing-card billing-metric">
                <MetricIcon size={19} aria-hidden="true" />
                <small className="billing-muted">{String(label).toUpperCase()}</small>
                <strong>{inr.format(Number(value))}</strong>
                <small className="billing-muted">{String(note)}</small>
              </div>
            );
          })}
        </section>
      ) : (
        <p className="form-error" role="alert">
          {from && to
            ? "Financial totals unavailable. Check the date range and the Invoice database migration."
            : "Choose both dates for a custom range."}
        </p>
      )}
      <div className="billing-grid billing-metrics">
        <Link className="billing-button" href="/invoice/notes?new=credit_note">
          <Receipt size={18} /> Prepare note
        </Link>
        <Link className="billing-button" href="/invoice/clients?new=1">
          <UserPlus size={18} /> Add client
        </Link>
        <Link className="billing-button" href="/invoice/quotations?new=quotation">
          <FilePlus size={18} /> New quotation
        </Link>
        <Link className="billing-button billing-primary" href="/invoice/raise">
          <Plus size={18} /> New invoice
        </Link>
      </div>
      {totals && (
        <div className="billing-grid billing-charts">
          <section className="billing-card">
            <h2>Revenue Trend</h2>
            <p className="billing-muted">Billed and collected by invoice month</p>
            <div className="billing-chart-labels">
              <span style={{ color: "#2459ab" }}>Billed</span>
              <span style={{ color: "#176948" }}>Collected</span>
            </div>
            <TrendChart
              points={totals.trend.map(({ month, billed, collected }) => ({
                label: monthLabel.format(new Date(month)),
                billed,
                collected,
              }))}
            />
            <details>
              <summary>View monthly amounts</summary>
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Billed</th>
                    <th>Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.trend.map((point) => (
                    <tr key={point.month}>
                      <td>{point.month.slice(0, 7)}</td>
                      <td>{inr.format(point.billed)}</td>
                      <td>{inr.format(point.collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
          <section className="billing-card">
            <h2>Financial Overview</h2>
            <p className="billing-muted">Collection progress for this period</p>
            {totals.billed ? (
              <div className="billing-ring" style={{ "--collected": `${percent}%` } as React.CSSProperties}>
                <small>Collected</small>
                <strong>{percent}%</strong>
              </div>
            ) : (
              <p className="billing-empty">No issued invoices in this period.</p>
            )}
            <p className="billing-toolbar billing-heading">
              <span>Collected</span>
              <strong>{inr.format(totals.collected)}</strong>
            </p>
            <p className="billing-toolbar billing-heading">
              <span>Outstanding</span>
              <strong>{inr.format(totals.outstanding)}</strong>
            </p>
          </section>
        </div>
      )}
      {recent.length > 0 && (
        <section className="billing-card">
          <div className="billing-toolbar billing-heading">
            <h2>Recent invoices</h2>
            <Link href="/invoice/ledger">Open ledger</Link>
          </div>
          <LedgerTable rows={recent} />
        </section>
      )}
    </>
  );
}
