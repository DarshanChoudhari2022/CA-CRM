import Link from "next/link";
import { requireCrmIdentity } from "@/modules/identity/crm";

export default async function WhatsNew() {
  await requireCrmIdentity();
  return (
    <>
      <header className="billing-toolbar">
        <div>
          <h1>What's New</h1>
          <p className="billing-muted">Updates to the PSB Invoice workspace</p>
        </div>
      </header>
      <section className="billing-card">
        <h2>Invoice workspace</h2>
        <p>Review billing and collections, download invoices, and manage billing activity from one workspace.</p>
        <Link className="billing-button billing-primary" href="/invoice">
          Open dashboard
        </Link>
      </section>
    </>
  );
}
