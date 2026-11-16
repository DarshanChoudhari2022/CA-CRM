import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/(portal)/actions";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { BillingNavigation } from "./navigation";
import "./workspace.css";

async function InvoiceWorkspace({ children }: { children: React.ReactNode }) {
  const identity = await requireCrmIdentity();
  return (
    <div className="invoice-workspace">
      <aside className="billing-sidebar">
        <Link href="/invoice" className="billing-brand">
          <span>PSB</span> Invoice
        </Link>
        <BillingNavigation />
        <div className="billing-account">
          <strong>{identity.fullName}</strong>
          <small>Administrator</small>
          <Link href="/modules">Switch workspace</Link>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="billing-main" id="billing-content">
        {children}
      </main>
    </div>
  );
}

export default function InvoiceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p role="status">Loading Invoice workspace…</p>}>
      <InvoiceWorkspace>{children}</InvoiceWorkspace>
    </Suspense>
  );
}
