import Link from "next/link";
import { PageHead } from "@/components/page-head";
import { crmModules } from "@/modules/crm/config";
import { requireIdentity } from "@/modules/identity/session";

export default async function ModulesPage() {
  const identity = await requireIdentity();
  return (
    <>
      <PageHead eyebrow="PSB Workspace" title="Your modules" description="Choose your workspace." />
      <section className="grid grid-2">
        <Link href="/dashboard" className="card">
          <span className="eyebrow">Available</span>
          <h2>Attendance &amp; leave</h2>
          <p>Attendance, leave and daily work.</p>
          <span className="button button-primary">Open module</span>
        </Link>
        {["admin", "partner"].includes(identity.role) && (
          <Link href="/employees" className="card">
            <h2>People &amp; access</h2>
            <p>Employee records and login management.</p>
            <span className="button button-secondary">Manage team</span>
          </Link>
        )}
      </section>
      <section className="grid grid-2 section">
        {Object.entries(crmModules).map(([key, module]) => (
          <Link className="card" key={key} href={`/crm/${key}`}>
            <h2>{module.title}</h2>
            <span className="button button-secondary">Open module</span>
          </Link>
        ))}
        <Link className="card" href="/crm/reports">
          <h2>CRM reports</h2>
        </Link>
        <Link className="card" href="/crm/automations">
          <h2>Automations & integrations</h2>
        </Link>
      </section>
    </>
  );
}
