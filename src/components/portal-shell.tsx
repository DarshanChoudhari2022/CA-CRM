import { LogOut } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/(portal)/actions";
import type { PortalIdentity } from "@/modules/identity/session";
import { Brand } from "./brand";
import { navIcons } from "./icons";

const nav = [
  ["overview", "/dashboard", "Overview"],
  ["attendance", "/attendance", "My attendance"],
  ["leave", "/leave", "Leave"],
  ["approvals", "/approvals", "Approvals"],
  ["employees", "/employees", "Employees"],
  ["reports", "/reports", "Reports"],
  ["settings", "/settings", "Settings"],
] as const;

export function PortalShell({ children, identity }: { children: React.ReactNode; identity: PortalIdentity }) {
  const allowed = identity.role === "employee" ? nav.slice(0, 3) : identity.role === "manager" ? nav.slice(0, 4) : nav;
  return (
    <div className="portal">
      <aside className="sidebar">
        <Brand />
        <nav className="nav" aria-label="Primary">
          {allowed.map(([key, href, label]) => {
            const Icon = navIcons[key];
            return (
              <Link key={href} href={href}>
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
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
          <div className="topbar-date">PSB team operations · Asia/Kolkata</div>
          <form action={signOut}>
            <button className="button button-secondary" type="submit">
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
