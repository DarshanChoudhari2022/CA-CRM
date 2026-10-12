import { ArrowRight, CalendarCheck, Layers3 } from "lucide-react";
import Link from "next/link";
import { PageHead } from "@/components/page-head";
export default function ModulesPage() {
  return (
    <>
      <PageHead
        eyebrow="PSB Workspace"
        title="Choose your workspace"
        description="Separate spaces. One secure account."
      />
      <section className="grid grid-2 workspace-cards">
        <Link href="/dashboard" className="card workspace-card">
          <CalendarCheck size={28} />
          <h2>Attendance</h2>
          <p>People, attendance, leave and daily work.</p>
          <span>
            Open attendance <ArrowRight size={16} />
          </span>
        </Link>
        <Link href="/crm" className="card workspace-card">
          <Layers3 size={28} />
          <h2>CA CRM</h2>
          <p>Client records and firm operations.</p>
          <span>
            Open CRM <ArrowRight size={16} />
          </span>
        </Link>
      </section>
    </>
  );
}
