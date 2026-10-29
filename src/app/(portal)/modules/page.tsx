import { ArrowRight, CalendarCheck, Layers3 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { isAdministrator } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";
export default async function ModulesPage() {
  const identity = await requireIdentity();
  if (!isAdministrator(identity.role)) redirect("/dashboard");
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
