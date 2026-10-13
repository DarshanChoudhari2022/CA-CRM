// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ path: "/attendance", count: 0 }));
vi.mock("@/modules/portal/approval-count", () => ({ getPendingApprovalCount: async () => state.count }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("@/app/(portal)/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/image", () => ({
  default: ({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) => (
    <span role="img" aria-label={alt} data-src={src} style={{ width, height }} />
  ),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onNavigate,
    ...props
  }: {
    children: ReactNode;
    href: string;
    onNavigate?: () => void;
  }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
      }}
    >
      {children}
    </a>
  ),
}));

import { PortalShell } from "./portal-shell";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  state.path = "/attendance";
  state.count = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <PortalShell
        identity={{
          userId: "fixture",
          organizationId: "fixture",
          employeeId: "fixture",
          fullName: "Fixture administrator",
          role: "admin",
        }}
      >
        <p>Page contents</p>
      </PortalShell>,
    ),
  );
}
describe("workspace shell mobile interactions", () => {
  it("shows the pending count in desktop and mobile navigation and clears it after a decision", async () => {
    state.count = 3;
    await render();
    expect(container.querySelector('.sidebar a[href="/approvals"] .approval-badge')?.textContent).toBe("3");
    expect(container.querySelector('#mobile-workspace-menu a[href="/approvals"] .approval-badge')?.textContent).toBe(
      "3",
    );
    expect(container.querySelector('.sidebar a[href="/approvals"]')?.getAttribute("aria-label")).toBe(
      "Approvals: 3 pending requests",
    );
    state.count = 0;
    await act(async () => window.dispatchEvent(new Event("approvals-changed")));
    expect(container.querySelector(".approval-badge")).toBeNull();
  });
  it("caps the circle at 99+ but keeps the exact accessible count", async () => {
    state.count = 120;
    await render();
    expect(container.querySelector(".approval-badge")?.textContent).toBe("99+");
    expect(container.querySelector('.sidebar a[href="/approvals"]')?.getAttribute("title")).toBe(
      "Approvals: 120 pending requests",
    );
    state.path = "/crm/tasks";
    await render();
    expect(container.querySelector(".approval-badge")).toBeNull();
  });
  it("starts with mobile navigation hidden, opens and closes from its accessible menu button", async () => {
    await render();
    const menu = container.querySelector<HTMLElement>("#mobile-workspace-menu");
    const button = container.querySelector<HTMLButtonElement>('[aria-controls="mobile-workspace-menu"]');
    expect(menu?.hidden).toBe(true);
    await act(async () => button?.click());
    expect(menu?.hidden).toBe(false);
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".mobile-nav-backdrop")).not.toBeNull();
    await act(async () => button?.click());
    expect(menu?.hidden).toBe(true);
  });
  it("closes the drawer from the backdrop and Escape", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-controls="mobile-workspace-menu"]')?.click(),
    );
    await act(async () => container.querySelector<HTMLButtonElement>(".mobile-nav-backdrop")?.click());
    expect(container.querySelector<HTMLElement>("#mobile-workspace-menu")?.hidden).toBe(true);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-controls="mobile-workspace-menu"]')?.click(),
    );
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector<HTMLElement>("#mobile-workspace-menu")?.hidden).toBe(true);
  });
  it("closes the mobile menu when a route is selected", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-controls="mobile-workspace-menu"]')?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLAnchorElement>('#mobile-workspace-menu a[href="/leave"]')?.click(),
    );
    expect(container.querySelector<HTMLElement>("#mobile-workspace-menu")?.hidden).toBe(true);
  });
  it("renders separate route-aware menus and highlights the current destination", async () => {
    await render();
    expect(container.querySelector('.sidebar a[href="/crm/automations"]')).toBeNull();
    expect(container.querySelector('.sidebar a[href="/attendance"]')?.getAttribute("aria-current")).toBe("page");
    state.path = "/crm/tasks";
    await render();
    expect(container.querySelector('.sidebar a[href="/attendance"]')).toBeNull();
    expect(container.querySelector('.sidebar a[href="/crm/tasks"]')?.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector(".portal")?.getAttribute("data-workspace")).toBe("crm");
  });
});
