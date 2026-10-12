"use client";
import { ArrowLeftRight, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/(portal)/actions";
import type { PortalIdentity } from "@/modules/identity/session";
import { workspaceForPath, workspaceNavigation } from "@/modules/portal/navigation";
import { Brand } from "./brand";
import { navIcons } from "./icons";

export function PortalShell({ children, identity }: { children: React.ReactNode; identity: PortalIdentity }) {
  const path = usePathname();
  const workspace = workspaceForPath(path);
  const links = workspaceNavigation(workspace, identity.role);
  const [menuOpen, setMenuOpen] = useState(false);
  const name = workspace === "crm" ? "CA CRM" : workspace === "attendance" ? "Attendance" : "Workspaces";
  const navigation = links.map(({ href, label, icon }) => {
    const Icon = navIcons[icon];
    return (
      <Link
        href={href}
        key={href}
        title={label}
        aria-label={label}
        aria-current={path === href ? "page" : undefined}
        className={path === href ? "active" : undefined}
        onNavigate={() => setMenuOpen(false)}
      >
        <Icon size={18} />
        <span>{label}</span>
      </Link>
    );
  });
  return (
    <div className="portal" data-workspace={workspace}>
      <aside className="sidebar">
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
        <header className="topbar">
          <div className="mobile-brand">
            <button
              className="icon-button"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-workspace-menu"
              onClick={() => setMenuOpen(!menuOpen)}
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
        <nav
          id="mobile-workspace-menu"
          className={`mobile-nav ${menuOpen ? "is-open" : ""}`}
          aria-label={`${name} mobile navigation`}
          hidden={!menuOpen}
        >
          {navigation}
          <Link href="/change-password" onNavigate={() => setMenuOpen(false)}>
            Change password
          </Link>
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
