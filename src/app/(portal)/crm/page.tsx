import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHead } from "@/components/page-head";
import { createClient } from "@/lib/supabase/server";
import { loadCrmOverview } from "@/modules/crm/overview";
import { requireCrmIdentity as requireIdentity } from "@/modules/identity/crm";
import PortalLoading from "../loading";
import { CrmOverviewView } from "./overview";
import "./overview.css";

async function OverviewData() {
  const identity = await requireIdentity();
  const client = await createClient();
  const data = await loadCrmOverview(client, identity.organizationId);
  return <CrmOverviewView data={data} admin={["admin", "partner"].includes(identity.role)} />;
}
export default function CrmHome() {
  return (
    <>
      <PageHead
        eyebrow="FIRM OVERVIEW"
        title="Your firm, at a glance."
        description="A clear view of clients, commitments and the work ahead."
        action={
          <Link href="/crm/reports" className="button button-secondary">
            View reports <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        }
      />
      <Suspense fallback={<PortalLoading />}>
        <OverviewData />
      </Suspense>
    </>
  );
}
