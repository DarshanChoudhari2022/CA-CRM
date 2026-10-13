"use client";
import { ArrowLeftRight, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/(portal)/actions";
import type { PortalIdentity } from "@/modules/identity/session";
import { getPendingApprovalCount } from "@/modules/portal/approval-count";
import { workspaceForPath, workspaceNavigation } from "@/modules/portal/navigation";
import { Brand } from "./brand";
import { navIcons } from "./icons";

export function PortalShell({ children, identity }: { children: React.ReactNode; identity: PortalIdentity }) {
  const path = usePathname();
  const workspace = workspaceForPath(path);
  const links = workspaceNavigation(workspace, identity.role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [approvalCount, setApprovalCount] = useState(0);
  const drawer = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const header = useRef<HTMLElement>(null);
  const content = useRef<HTMLElement>(null);
  const previousPath = useRef(path);
  const closeMenu = () => setMenuOpen(false);
  useEffect(() => {
    // Also close on browser history/programmatic navigation.
    if (previousPath.current !== path) setMenuOpen(false);
    previousPath.current = path;
  }, [path]);
  useEffect(() => {
    if (workspace !== "attendance" || identity.role === "employee") return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      try {
        const count = await getPendingApprovalCount();
        if (!cancelled && count !== null) setApprovalCount(count);
      } catch {
        // Leave the last successful count visible during connection failures.
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("approvals-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("approvals-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [workspace, identity.role]);
  useEffect(() => {
    if (!menuOpen) return;
    if (window.innerWidth > 720) {
      setMenuOpen(false);
      return;
    }
    const panel = drawer.current;
    if (!panel) return;
    const active = document.activeElement;
    const previousFocus =
      active instanceof HTMLElement && active !== document.body && !panel.contains(active) ? active : opener.current;
    const previousOverflow = document.body.style.overflow;
    const backgrounds = [sidebar.current, header.current, content.current].filter((node) => node !== null);
    const inertValues = backgrounds.map((node) => node.getAttribute("inert"));
    const focusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>("*")).filter(
        (node) => node.tabIndex >= 0 && !node.hasAttribute("disabled") && !node.closest("[hidden], [inert]"),
      );
    const focusFirst = () => (focusable()[0] ?? panel).focus();
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) focusFirst();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
      }
      if (event.key !== "Tab") return;
      const targets = focusable();
      const first = targets[0] ?? panel;
      const last = targets.at(-1) ?? panel;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault();
        first.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth > 720) setMenuOpen(false);
    };
    backgrounds.forEach((node) => {
      node.setAttribute("inert", "");
    });
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocus);
    window.addEventListener("resize", onResize);
    document.body.style.overflow = "hidden";
    focusFirst();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", onResize);
      backgrounds.forEach((node, index) => {
        const value = inertValues[index];
        if (value === null) node.removeAttribute("inert");
        else node.setAttribute("inert", value);
      });
      document.body.style.overflow = previousOverflow;
      if (window.innerWidth > 720) {
        const destination =
          sidebar.current?.querySelector<HTMLElement>('a[aria-current="page"]') ??
          sidebar.current?.querySelector<HTMLElement>("a[href]");
        destination?.focus();
      } else if (previousFocus?.isConnected && !previousFocus.closest("[hidden], [inert]")) {
        previousFocus.focus();
      } else if (opener.current?.isConnected) opener.current.focus();
    };
  }, [menuOpen]);
  const name = workspace === "crm" ? "CA CRM" : workspace === "attendance" ? "Attendance" : "Workspaces";
  const navigation = links.map(({ href, label, icon }) => {
    const Icon = navIcons[icon];
    const count = href === "/approvals" ? approvalCount : 0;
    const accessibleLabel = count > 0 ? `${label}: ${count} pending requests` : label;
    return (
      <Link
        href={href}
        key={href}
        title={accessibleLabel}
        aria-label={accessibleLabel}
        aria-current={path === href ? "page" : undefined}
        className={path === href ? "active" : undefined}
        onNavigate={() => setMenuOpen(false)}
      >
        <Icon size={18} />
        <span>{label}</span>
        {count > 0 && (
          <span className="approval-badge" aria-hidden="true">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    );
  });
  return (
    <div className="portal" data-workspace={workspace}>
      <aside className="sidebar" ref={sidebar}>
        <Brand />
        <div className="workspace-label">{name}</div>
        <nav className="nav" aria-label={`${name} navigation`}>
          {navigation}
        </nav>
        <div className="sidebar-foot">
          <strong>{identity.fullName}</strong>
          <span>{identity.role}</span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar" ref={header}>
          <div className="mobile-brand">
            <button
              ref={opener}
              className="icon-button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-workspace-menu"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <Brand compact />
          </div>
          <div className="topbar-date">
            <strong>{name}</strong>
            <span className="topbar-divider" />
            <Link href="/change-password">Change password</Link>
          </div>
          <div className="topbar-actions">
            <Link href="/modules" className="button button-secondary workspace-switch">
              <ArrowLeftRight size={16} />
              <span>Switch workspace</span>
            </Link>
            <form action={signOut}>
              <button className="button button-secondary" type="submit">
                <LogOut size={16} />
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </header>
        {menuOpen && (
          <button
            className="mobile-nav-backdrop"
            type="button"
            aria-label="Close navigation menu"
            tabIndex={-1}
            onClick={closeMenu}
          />
        )}
        <div
          ref={drawer}
          role="dialog"
          aria-modal={menuOpen ? true : undefined}
          tabIndex={-1}
          id="mobile-workspace-menu"
          className={`mobile-nav ${menuOpen ? "is-open" : ""}`}
          aria-label={`${name} mobile navigation`}
          hidden={!menuOpen}
        >
          <div className="mobile-nav-head">
            <div>
              <span className="mobile-nav-kicker">Workspace</span>
              <strong>{name}</strong>
            </div>
            <button
              className="icon-button mobile-nav-close"
              type="button"
              aria-label="Close navigation menu"
              onClick={closeMenu}
            >
              <X size={19} />
            </button>
          </div>
          <nav className="mobile-nav-links" aria-label={`${name} navigation`}>
            {navigation}
            <Link href="/change-password" onNavigate={closeMenu}>
              <span className="mobile-nav-link-icon">↗</span>
              Change password
            </Link>
          </nav>
          <div className="mobile-nav-user">
            <span className="mobile-nav-avatar">{identity.fullName.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{identity.fullName}</strong>
              <small>{identity.role}</small>
            </span>
          </div>
        </div>
        <main className="content" ref={content}>
          {children}
        </main>
      </div>
    </div>
  );
}
