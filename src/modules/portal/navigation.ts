import type { PortalIdentity } from "@/modules/identity/session";
export type Workspace = "attendance" | "crm" | "launcher";
type NavItem = {
  href: string;
  label: string;
  icon: "overview" | "attendance" | "leave" | "work" | "approvals" | "employees" | "reports" | "settings";
};
export function workspaceForPath(path: string): Workspace {
  return path === "/modules" ? "launcher" : path === "/crm" || path.startsWith("/crm/") ? "crm" : "attendance";
}
export function workspaceNavigation(workspace: Workspace, role: PortalIdentity["role"]): NavItem[] {
  if (workspace === "launcher") return [{ href: "/modules", label: "Workspaces", icon: "overview" }];
  if (workspace === "crm")
    return [
      { href: "/crm", label: "CRM overview", icon: "overview" },
      { href: "/crm/clients", label: "Clients", icon: "employees" },
      { href: "/crm/leads", label: "Leads", icon: "overview" },
      { href: "/crm/documents", label: "Documents", icon: "approvals" },
      { href: "/crm/compliance", label: "Compliance", icon: "leave" },
      { href: "/crm/invoices", label: "Invoices", icon: "reports" },
      { href: "/crm/tasks", label: "Tasks", icon: "work" },
      { href: "/crm/support", label: "Support", icon: "employees" },
      { href: "/crm/ai-team", label: "CA AI team", icon: "approvals" },
      { href: "/crm/reports", label: "Reports", icon: "reports" },
      ...(["admin", "partner"].includes(role)
        ? [
            { href: "/crm/automation-center", label: "Automation centre", icon: "settings" as const },
            { href: "/crm/automations", label: "Reminder history", icon: "reports" as const },
          ]
        : []),
    ];
  const links: NavItem[] = [{ href: "/dashboard", label: "Overview", icon: "overview" }];
  if (!["admin", "partner"].includes(role))
    links.push(
      { href: "/attendance", label: "My attendance", icon: "attendance" },
      { href: "/leave", label: "Leave", icon: "leave" },
      { href: "/work", label: "Daily work", icon: "work" },
    );
  if (role !== "employee")
    links.push(
      { href: "/team-attendance", label: "Team attendance", icon: "attendance" },
      { href: "/approvals", label: "Approvals", icon: "approvals" },
    );
  if (["admin", "partner"].includes(role))
    links.push(
      { href: "/employees", label: "Employees", icon: "employees" },
      { href: "/reports", label: "Attendance reports", icon: "reports" },
      { href: "/operations", label: "People & calendar", icon: "employees" },
      { href: "/settings", label: "Attendance settings", icon: "settings" },
    );
  return links;
}
