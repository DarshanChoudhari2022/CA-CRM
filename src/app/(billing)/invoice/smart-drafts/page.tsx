import { createClient } from "@/lib/supabase/server";
import { ConfigurationPanel } from "@/modules/billing/configuration-panel";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { FilingForm } from "./filing-form";

export default async function Page({ searchParams }: { searchParams: Promise<{ saved?: string | string[] }> }) {
  const { saved } = await searchParams;
  const { organizationId } = await requireCrmIdentity();
  const client = await createClient();
  const [filings, services] = await Promise.all([
    client
      .from("crm_compliance")
      .select("id,title")
      .eq("organization_id", organizationId)
      .eq("status", "filed")
      .not("client_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(100),
    client
      .from("billing_service_catalog")
      .select("id,name")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .gt("unit_price", 0)
      .order("name")
      .limit(100),
  ]);
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Smart drafts</h1>
        <p className="text-sm text-slate-600">Turn a filed CA CRM compliance record into a reviewable draft.</p>
      </header>
      <section className="billing-card">
        <h2>Create a draft from a filing</h2>
        <p>Choose a filing and a service with a standard fee.</p>
        {filings.error || services.error ? (
          <p role="alert">Filing and service choices are unavailable.</p>
        ) : (
          <>
            {!filings.data.length && <p>Mark a client compliance record as filed in CA CRM to get started.</p>}
            {!services.data.length && <p>Add an active service with a standard fee in Service Catalog.</p>}
            <FilingForm
              filings={filings.data.map(({ id, title }) => ({ id, label: title }))}
              services={services.data.map(({ id, name }) => ({ id, label: name }))}
            />
          </>
        )}
      </section>
      <ConfigurationPanel section="smart-drafts" saved={saved === "1"} />
    </div>
  );
}
