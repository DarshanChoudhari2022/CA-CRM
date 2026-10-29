import { requireCrmIdentity } from "@/modules/identity/crm";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await requireCrmIdentity();
  return children;
}
