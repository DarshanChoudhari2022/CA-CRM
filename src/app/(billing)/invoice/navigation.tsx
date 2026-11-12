"use client";

import {
  BookOpen,
  BriefcaseBusiness,
  ClipboardList,
  FilePlus,
  FileText,
  LayoutDashboard,
  Receipt,
  Repeat,
  Settings,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["", "Dashboard", LayoutDashboard],
  ["/ledger", "Invoice Ledger", BookOpen],
  ["/raise", "Raise Invoice", FilePlus],
  ["/notes", "Credit & Debit Notes", FileText],
  ["/quotations", "Quotations", ClipboardList],
  ["/proformas", "Proforma Invoices", FileText],
  ["/recurring", "Recurring Invoices", Repeat],
  ["/smart-drafts", "Smart Drafts", Zap],
  ["/receipts", "Receipts", Receipt],
  ["/clients", "Client Directory", Users],
  ["/services", "Service Catalog", BriefcaseBusiness],
  ["/settings", "Practice Settings", Settings],
  ["/whats-new", "What's New", Sparkles],
] as const;

export function BillingNavigation() {
  const path = usePathname();
  return (
    <nav aria-label="Invoice workspace">
      {links.map(([suffix, label, Icon]) => {
        const href = `/invoice${suffix}`;
        const active = path === href || (suffix !== "" && path.startsWith(`${href}/`));
        return (
          <Link href={href} key={href} aria-current={active ? "page" : undefined}>
            <Icon size={17} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
