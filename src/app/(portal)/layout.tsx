import { PortalShell } from "@/components/portal-shell";
import { requireIdentity } from "@/modules/identity/session";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireIdentity();
  return <PortalShell identity={identity}>{children}</PortalShell>;
}
