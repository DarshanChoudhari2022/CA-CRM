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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.path = "/attendance";
  state.count = 0;
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
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
  it("moves focus into the dialog, wraps Tab in both directions and restores the opener", async () => {
    await render();
    const button = container.querySelector<HTMLButtonElement>('[aria-controls="mobile-workspace-menu"]');
    button?.focus();
    await act(async () => button?.click());
    const panel = container.querySelector<HTMLElement>('[role="dialog"]');
    const first = panel?.querySelector<HTMLButtonElement>("button");
    const last = panel?.querySelector<HTMLAnchorElement>('a[href="/change-password"]');
    expect(document.activeElement).toBe(first);
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    expect(document.activeElement).toBe(first);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.activeElement).toBe(button);
  });
  it("keeps background focus out and restores preexisting inert/scroll state", async () => {
    await render();
    document.body.style.overflow = "scroll";
    container.querySelector(".sidebar")?.setAttribute("inert", "retained");
    const button = container.querySelector<HTMLButtonElement>('[aria-controls="mobile-workspace-menu"]');
    await act(async () => button?.click());
    expect(container.querySelector(".topbar")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".content")?.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    container.querySelector<HTMLAnchorElement>('.topbar a[href="/modules"]')?.focus();
    expect(container.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>(".mobile-nav-close")?.click());
    expect(container.querySelector(".sidebar")?.getAttribute("inert")).toBe("retained");
    expect(container.querySelector(".topbar")?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector(".content")?.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });
  it("cleans up on desktop resize and remains closed when returning to phone width", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-controls="mobile-workspace-menu"]')?.click(),
    );
    await act(async () => {
      window.innerWidth = 1000;
      window.dispatchEvent(new Event("resize"));
    });
    expect(container.querySelector<HTMLElement>("#mobile-workspace-menu")?.hidden).toBe(true);
    expect(container.querySelector(".content")?.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(container.querySelector(".sidebar")?.contains(document.activeElement)).toBe(true);
    await act(async () => {
      window.innerWidth = 390;
      window.dispatchEvent(new Event("resize"));
    });
    expect(container.querySelector<HTMLElement>("#mobile-workspace-menu")?.hidden).toBe(true);
  });
  it("cleans up on history navigation and unmount", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-controls="mobile-workspace-menu"]')?.click(),
    );
    state.path = "/leave";
    await render();
    expect(container.querySelector<HTMLElement>("#mobile-workspace-menu")?.hidden).toBe(true);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-controls="mobile-workspace-menu"]')?.click(),
    );
    await act(async () => root.render(null));
    expect(document.body.style.overflow).toBe("");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
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
    expect(document.activeElement).toBe(button);
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
