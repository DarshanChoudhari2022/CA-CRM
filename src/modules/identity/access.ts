import type { PortalIdentity } from "./session";

export function isAdministrator(role: PortalIdentity["role"]) {
  return role === "admin" || role === "partner";
}

export function roleLabel(role: PortalIdentity["role"]) {
  return isAdministrator(role) ? "Administrator" : "Employee";
}

export function canUseCrmModule(role: PortalIdentity["role"], module: string) {
  return !["invoices", "automation-center", "automations"].includes(module) || isAdministrator(role);
}
