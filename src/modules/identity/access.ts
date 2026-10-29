import type { PortalIdentity } from "./session";

export function isAdministrator(role: PortalIdentity["role"]) {
  return role === "admin" || role === "partner";
}

export function roleLabel(role: PortalIdentity["role"]) {
  return isAdministrator(role) ? "Administrator" : "Employee";
}

export function canUseCrmModule(role: PortalIdentity["role"], _module: string) {
  return isAdministrator(role);
}
