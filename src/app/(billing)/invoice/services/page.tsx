import Link from "next/link";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CatalogService } from "@/modules/billing/configuration";
import { saveBillingService } from "@/modules/billing/configuration-actions";
import { ConfigurationForm } from "@/modules/billing/configuration-form";
import { configurationInput } from "@/modules/billing/configuration-panel";
import { requireCrmIdentity } from "@/modules/identity/crm";

const catalogPath = "/invoice/services";
const pageSize = 25;
const serviceColumns = "id,name,description,sac_code,unit_price,gst_rate,active";
const priceFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function ServiceEditor({ service }: { service?: CatalogService }) {
  return (
    <section id="service-editor" className="billing-card space-y-4 p-4 sm:p-5" aria-labelledby="service-heading">
      <h2 id="service-heading" className="text-base font-semibold">
        {service ? "Edit service" : "Add service"}
      </h2>
      <ConfigurationForm
        action={saveBillingService.bind(null, service?.id ?? null)}
        submit={service ? "Save changes" : "Add service"}
      >
        <label className="grid gap-1.5 text-sm font-medium">
          Service name
          <input className={configurationInput} name="name" required maxLength={120} defaultValue={service?.name} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          SAC code
          <input className={configurationInput} name="sac_code" maxLength={12} defaultValue={service?.sac_code} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Unit price (₹)
          <input
            className={configurationInput}
            name="unit_price"
            type="number"
            min="0"
            max="9999999999.99"
            step="0.01"
            required
            defaultValue={service?.unit_price}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          GST rate (%)
          <input
            className={configurationInput}
            name="gst_rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            defaultValue={service?.gst_rate ?? 0}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Status
          <select className={configurationInput} name="active" defaultValue={String(service?.active ?? true)}>
            <option value="true">Active</option>
            <option value="false">Archived</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
          Description
          <textarea
            className={configurationInput}
            name="description"
            maxLength={300}
            rows={2}
            defaultValue={service?.description}
          />
        </label>
      </ConfigurationForm>
      <Link href={catalogPath} className="billing-button">
        Cancel
      </Link>
    </section>
  );
}

export default async function ServiceCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[]; saved?: string | string[]; page?: string | string[] }>;
}) {
  const identity = await requireCrmIdentity();
  const { edit, saved, page } = await searchParams;
  const requestedPage = typeof page === "string" && /^\d{1,7}$/.test(page) ? Number(page) : 1;
  const pageNumber = Math.max(requestedPage, 1);
  const offset = (pageNumber - 1) * pageSize;
  const client = await createClient();
  const baseQuery = () =>
    client.from("billing_service_catalog").select(serviceColumns).eq("organization_id", identity.organizationId);
  const editId = z.uuid().safeParse(edit);
  const [catalog, editor] = await Promise.all([
    baseQuery()
      .order("active", { ascending: false })
      .order("name")
      .order("id")
      .range(offset, offset + pageSize),
    editId.success ? baseQuery().eq("id", editId.data).maybeSingle() : null,
  ]);
  const services = (catalog.data ?? []) as CatalogService[];
  const service = editor?.data as CatalogService | undefined;
  const showEditor = edit === "new" || Boolean(service);

  return (
    <div className="space-y-4">
      <header className="billing-toolbar flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Service catalog</h1>
          <p className="text-sm text-slate-600">Manage services, unit prices, SAC codes and GST rates.</p>
        </div>
        <Link href={`${catalogPath}?edit=new#service-editor`} className="billing-button billing-primary">
          Add service
        </Link>
      </header>
      {saved === "1" && (
        <p role="status" className="text-sm text-emerald-700">
          Service saved.
        </p>
      )}
      {edit && !showEditor && (
        <p role="alert" className="text-sm text-red-700">
          {editor?.error
            ? "Could not load this service. Reload the page to try again."
            : "This service is unavailable."}
        </p>
      )}
      {showEditor && <ServiceEditor key={service?.id ?? "new"} service={service} />}
      <section className="billing-card overflow-hidden" aria-label="Catalog entries">
        {catalog.error ? (
          <p role="alert" className="p-4 text-sm text-red-700">
            Could not load the catalog. Reload the page to try again.
          </p>
        ) : services.length === 0 ? (
          <p className="p-4 text-sm text-slate-600">
            {pageNumber === 1 ? "No services yet. Add a service to start your catalog." : "No services on this page."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="billing-table w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">SAC</th>
                  <th scope="col">Unit price</th>
                  <th scope="col">GST</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {services.slice(0, pageSize).map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      <div className="font-medium">{item.name}</div>
                      {item.description && (
                        <div className="max-w-sm break-words font-normal text-slate-600">{item.description}</div>
                      )}
                    </th>
                    <td>{item.sac_code || "—"}</td>
                    <td className="whitespace-nowrap">{priceFormat.format(item.unit_price)}</td>
                    <td>{item.gst_rate}%</td>
                    <td>{item.active ? "Active" : "Archived"}</td>
                    <td>
                      <Link
                        href={`${catalogPath}?page=${pageNumber}&edit=${item.id}#service-editor`}
                        className="billing-button"
                        aria-label={`Edit ${item.name}`}
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!catalog.error && (pageNumber > 1 || services.length > pageSize) && (
          <nav aria-label="Catalog pages" className="flex flex-wrap gap-2 border-t border-slate-200 p-3">
            {pageNumber > 1 && (
              <Link href={`${catalogPath}?page=${pageNumber - 1}`} className="billing-button">
                Previous
              </Link>
            )}
            {services.length > pageSize && (
              <Link href={`${catalogPath}?page=${pageNumber + 1}`} className="billing-button">
                Next
              </Link>
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
