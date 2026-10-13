import Link from "next/link";
import { PageHead } from "@/components/page-head";
import { crmModules } from "@/modules/crm/config";
export default function CrmHome() {
  return (
    <>
      <PageHead eyebrow="CA CRM" title="Firm workspace" description="Your client records and assigned work." />
      <section className="grid grid-3 workspace-cards">
        <Link className="card workspace-card" href="/crm/ai-team">
          <h2>CA AI team</h2>
          <p>Tax, compliance, legal, document and finance workpapers.</p>
          <span>Open workbench →</span>
        </Link>
        {Object.entries(crmModules).map(([key, module]) => (
          <Link className="card workspace-card" href={`/crm/${key}`} key={key}>
            <h2>{module.title}</h2>
            <span>Open module →</span>
          </Link>
        ))}
      </section>
    </>
  );
}
