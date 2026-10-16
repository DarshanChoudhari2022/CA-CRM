import { describe, expect, it } from "vitest";
import { workspaceForPath, workspaceNavigation } from "./navigation";

describe("separate workspace navigation", () => {
  it.each(["employee", "manager", "admin", "partner"] as const)(
    "never exposes CRM links in %s attendance menu",
    (role) => {
      const links = workspaceNavigation("attendance", role);
      expect(links.some((l) => l.href.startsWith("/crm"))).toBe(false);
      expect(links.some((l) => l.label.includes("Automation"))).toBe(false);
      expect(links.some((l) => l.href === "/attendance")).toBe(role === "employee" || role === "manager");
    },
  );
  it("never includes attendance management in CRM navigation", () => {
    expect(workspaceNavigation("crm", "admin").every((l) => l.href.startsWith("/crm"))).toBe(true);
  });
  it("limits administration links by role", () => {
    for (const role of ["admin", "partner"] as const)
      expect(
        workspaceNavigation("attendance", role).some((l) => ["/attendance", "/leave", "/work"].includes(l.href)),
      ).toBe(false);
    expect(workspaceNavigation("attendance", "employee").some((l) => l.href === "/employees")).toBe(false);
    expect(workspaceNavigation("attendance", "manager").some((l) => l.href === "/approvals")).toBe(true);
    expect(workspaceNavigation("crm", "employee").some((l) => l.href === "/crm/automations")).toBe(false);
    expect(workspaceNavigation("crm", "employee").some((l) => l.href === "/crm/invoices")).toBe(false);
    expect(workspaceNavigation("crm", "admin").some((l) => l.href === "/crm/invoices")).toBe(true);
  });
  it("classifies the actual route, not similarly named pages", () => {
    expect(workspaceForPath("/crm/automations")).toBe("crm");
    expect(workspaceForPath("/crm")).toBe("crm");
    expect(workspaceForPath("/modules")).toBe("launcher");
    expect(workspaceForPath("/operations")).toBe("attendance");
  });
});
