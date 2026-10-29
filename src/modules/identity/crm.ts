import { redirect } from "next/navigation";
import { isAdministrator } from "./access";
import { requireIdentity } from "./session";

// Recheck on every CRM request/action, including direct URLs and exports.
export async function requireCrmIdentity() {
  const identity = await requireIdentity();
  if (!isAdministrator(identity.role)) redirect("/dashboard");
  return identity;
}
