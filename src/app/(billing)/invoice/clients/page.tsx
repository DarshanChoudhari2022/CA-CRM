import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { billingHref, containsPattern, pageNumber, pageSize, queryText, type SearchParams } from "../receipts/format";
import { Pagination } from "../receipts/pagination";
import { ClientForm } from "./client-form";

const path = "/invoice/clients";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { organizationId } = await requireCrmIdentity();
  const params = await searchParams;
  const q = queryText(params.q, 200);
  const status = params.status === "active" || params.status === "inactive" ? params.status : undefined;
  const page = pageNumber(params.page);
  const adding = params.new === "1";
  const offset = (page - 1) * pageSize;
  const db = await createClient();
  let query = db.from("crm_clients").select("id,title,email,phone,status").eq("organization_id", organizationId);
  if (q) query = query.ilike("title", containsPattern(q));
  if (status) query = query.eq("status", status);
  const { data, error } = await query
    .order("title")
    .order("id")
    .range(offset, offset + pageSize);
  if (error) throw new Error("Could not load the client directory.");

  return (
    <>
      <header className="billing-toolbar billing-heading">
        <h1>Client Directory</h1>
        <Link
          className={`billing-button${adding ? "" : " billing-primary"}`}
          href={billingHref(path, { q, status, page, new: adding ? undefined : "1" })}
        >
          {adding ? "Cancel" : "Add client"}
        </Link>
      </header>
      {adding && (
        <section className="billing-card mb-4">
          <h2 className="mb-3">Add client</h2>
          <ClientForm />
        </section>
      )}
      <section className="billing-card" aria-label="Client records">
        <form action={path} className="billing-toolbar items-end" key={`${q}:${status}`}>
          <label className="grid gap-1">
            Client name
            <input type="search" name="q" defaultValue={q} maxLength={200} />
          </label>
          <label className="grid gap-1">
            Status
            <select name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <button className="billing-button" type="submit">
            Apply filters
          </button>
          {(q || status) && (
            <Link className="billing-button" href={path}>
              Clear
            </Link>
          )}
        </form>
        <div className="billing-scroll">
          <table className="billing-table">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, pageSize).map((client) => (
                <tr key={client.id}>
                  <td>{client.title}</td>
                  <td>{client.email || "—"}</td>
                  <td>{client.phone || "—"}</td>
                  <td className="capitalize">{client.status}</td>
                  <td className="whitespace-nowrap">
                    <Link href={`${path}/${client.id}`} aria-label={`View ledger for ${client.title}`}>
                      View ledger
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.length && <p className="billing-empty">No clients match these filters.</p>}
        <Pagination
          page={page}
          hasNext={data.length > pageSize}
          href={(next) => billingHref(path, { q, status, page: next })}
        />
      </section>
    </>
  );
}
