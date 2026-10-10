import { Grid2X2, LogOut } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/(portal)/actions";
import type { PortalIdentity } from "@/modules/identity/session";
import { Brand } from "./brand";
import { navIcons } from "./icons";

const nav = [
  ["overview", "/dashboard", "Overview"],
  ["attendance", "/attendance", "My attendance"],
  ["leave", "/leave", "Leave"],
  ["work", "/work", "My work"],
  ["approvals", "/approvals", "Approvals"],
  ["employees", "/employees", "Employees"],
  ["reports", "/reports", "Reports"],
  ["settings", "/settings", "Settings"],
] as const;

export function PortalShell({ children, identity }: { children: React.ReactNode; identity: PortalIdentity }) {
  const allowed = identity.role === "employee" ? nav.slice(0, 4) : identity.role === "manager" ? nav.slice(0, 5) : nav;
  return (
    <div className="portal">
      <aside className="sidebar">
        <Brand />
        <nav className="nav" aria-label="Primary">
          <Link href="/modules">
            <Grid2X2 size={18} />
            <span>All modules</span>
          </Link>
          {allowed.map(([key, href, label]) => {
            const Icon = navIcons[key];
            return (
              <Link key={href} href={href}>
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
          <Link href="/crm/reports">
            <Grid2X2 size={18} />
            <span>CRM reports</span>
          </Link>
          <Link href="/crm/automations">
            <Grid2X2 size={18} />
            <span>Automations</span>
          </Link>
          {["admin", "partner"].includes(identity.role) && (
            <Link href="/operations">
              <Grid2X2 size={18} />
              <span>People operations</span>
            </Link>
          )}
        </nav>
        <div className="sidebar-foot">
          <strong style={{ color: "white", display: "block", marginBottom: 4 }}>{identity.fullName}</strong>
          <span style={{ textTransform: "capitalize" }}>{identity.role}</span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand compact />
          </div>
          <div className="topbar-date">
            <Link href="/modules">PSB Workspace</Link> · <Link href="/change-password">Change password</Link>
          </div>
          <form action={signOut}>
            <button className="button button-secondary" type="submit">
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </header>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <Link href="/modules">All modules</Link>
          {allowed.map(([, href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
          <Link href="/change-password">Password</Link>
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
