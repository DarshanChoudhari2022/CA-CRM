import { Suspense } from "react";
import { PortalShell } from "@/components/portal-shell";
import { requireIdentity } from "@/modules/identity/session";
import PortalLoading from "./loading";

async function AuthenticatedWorkspace({ children }: { children: React.ReactNode }) {
  const identity = await requireIdentity();
  return <PortalShell identity={identity}>{children}</PortalShell>;
}
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="content">
          <PortalLoading />
        </div>
      }
    >
      <AuthenticatedWorkspace>{children}</AuthenticatedWorkspace>
    </Suspense>
  );
}
