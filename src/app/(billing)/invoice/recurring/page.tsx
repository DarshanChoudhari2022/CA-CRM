import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ConfigurationForm } from "@/modules/billing/configuration-form";
import { configurationInput } from "@/modules/billing/configuration-panel";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { createRecurringSchedule, runDueRecurring, setRecurringActive } from "./actions";

const recurringPath = "/invoice/recurring";
const frequencies: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 12: "Yearly" };

function count(value: unknown) {
  return typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : null;
}

export default async function RecurringPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { organizationId } = await requireCrmIdentity();
  const { client: clientParam, saved, updated, created, failed, more } = await searchParams;
  const selectedClient = z.uuid().safeParse(clientParam);
  const client = await createClient();
  const [clients, templates, schedules] = await Promise.all([
    client.from("crm_clients").select("id,title").eq("organization_id", organizationId).order("title").order("id"),
    selectedClient.success
      ? client
          .from("crm_invoices")
          .select("id,title,invoice_number")
          .eq("organization_id", organizationId)
          .eq("client_id", selectedClient.data)
          .in("status", ["draft", "issued"])
          .eq("invoice_details->>documentType", "invoice")
          .order("created_at", { ascending: false })
          .order("id")
      : null,
    client
      .from("billing_recurring_schedules")
      .select("id,client_id,template_title,interval_months,next_due_on,active")
      .eq("organization_id", organizationId)
      .order("next_due_on")
      .order("id"),
  ]);

  const clientNames = new Map<string, string>((clients.data ?? []).map((row) => [row.id, row.title]));
  const clientId = selectedClient.success && clientNames.has(selectedClient.data) ? selectedClient.data : null;
  const generated = count(created);
  const failures = count(failed);

  return (
    <div className="space-y-4">
      <header className="billing-toolbar flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Recurring invoices</h1>
          <p className="text-sm text-slate-600">Run due schedules manually to create invoice drafts for review.</p>
        </div>
        <ConfigurationForm action={runDueRecurring} submit="Run due schedules" />
      </header>

      {saved === "1" && (
        <p role="status" className="text-sm text-emerald-700">
          Schedule created.
        </p>
      )}
      {updated === "1" && (
        <p role="status" className="text-sm text-emerald-700">
          Schedule updated.
        </p>
      )}
      {generated !== null && (
        <div role="status" className="billing-card space-y-1 p-4 text-sm">
          <p>
            {generated === 0 ? "No drafts created." : `${generated} ${generated === 1 ? "draft" : "drafts"} created.`}
          </p>
          {Boolean(failures) && (
            <p className="text-red-700">{failures} due schedules could not run. Their due dates were kept for retry.</p>
          )}
          {more === "1" && <p>More periods are due. Run due schedules again to continue.</p>}
          {generated > 0 && (
            <Link href="/invoice/ledger?status=draft" className="billing-button">
              View drafts
            </Link>
          )}
        </div>
      )}

      <section className="billing-card space-y-4 p-4 sm:p-5" aria-labelledby="recurring-editor">
        <h2 id="recurring-editor" className="text-base font-semibold">
          Add schedule
        </h2>
        {clients.error ? (
          <p role="alert" className="text-sm text-red-700">
            Could not load clients. Reload this page to try again.
          </p>
        ) : (
          <form action={recurringPath} method="get" className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-0 gap-1.5 text-sm font-medium">
              Client
              <select
                key={clientId ?? "unselected"}
                name="client"
                className={configurationInput}
                required
                defaultValue={clientId ?? ""}
              >
                <option value="" disabled>
                  Choose a client
                </option>
                {[...clientNames].map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="billing-button">
              Load invoices
            </button>
          </form>
        )}
        {clientId &&
          (templates?.error ? (
            <p role="alert" className="text-sm text-red-700">
              Could not load invoices for this client.
            </p>
          ) : templates?.data?.length ? (
            <ConfigurationForm
              key={clientId}
              action={createRecurringSchedule.bind(null, crypto.randomUUID(), clientId)}
              submit="Create schedule"
            >
              <label className="grid gap-1.5 text-sm font-medium">
                Template invoice for {clientNames.get(clientId)}
                <select name="template" className={configurationInput} defaultValue="" required>
                  <option value="" disabled>
                    Choose an invoice
                  </option>
                  {templates.data.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.title} ({row.invoice_number})
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Frequency
                <select name="interval" className={configurationInput} defaultValue="1">
                  {Object.entries(frequencies).map(([months, label]) => (
                    <option key={months} value={months}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                First draft date
                <input
                  type="date"
                  name="first_due"
                  className={configurationInput}
                  required
                  min="2000-01-01"
                  max="2100-12-31"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Payment terms in days (optional)
                <input type="number" name="payment_terms" className={configurationInput} min="0" max="999" step="1" />
              </label>
            </ConfigurationForm>
          ) : (
            <p className="text-sm text-slate-600">
              This client has no structured draft or issued invoices to use as a template.
            </p>
          ))}
      </section>

      <section className="billing-card overflow-hidden" aria-label="Recurring schedules">
        {schedules.error ? (
          <p role="alert" className="p-4 text-sm text-red-700">
            Could not load recurring schedules. Reload this page to try again.
          </p>
        ) : !schedules.data?.length ? (
          <p className="p-4 text-sm text-slate-600">No recurring schedules yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="billing-table w-full text-sm">
              <thead>
                <tr>
                  <th scope="col">Client and template</th>
                  <th scope="col">Frequency</th>
                  <th scope="col">Next draft date</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedules.data.map((schedule) => (
                  <tr key={schedule.id}>
                    <td>
                      {clientNames.get(schedule.client_id) ?? "Client"}
                      <small>{schedule.template_title}</small>
                    </td>
                    <td>{frequencies[schedule.interval_months]}</td>
                    <td className="whitespace-nowrap">
                      <time dateTime={schedule.next_due_on}>{schedule.next_due_on}</time>
                    </td>
                    <td>{schedule.active ? "Active" : "Paused"}</td>
                    <td>
                      <ConfigurationForm
                        action={setRecurringActive.bind(null, schedule.id, !schedule.active)}
                        submit={schedule.active ? "Pause" : "Resume"}
                        secondary
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
