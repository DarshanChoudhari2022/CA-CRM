import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generateInvoicePdf } from "@/modules/crm/invoice-pdf";
import { isAdministrator } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await requireIdentity();
  if (!isAdministrator(identity.role)) return new Response("Administrator access required", { status: 403 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Invalid invoice", { status: 400 });
  const client = await createClient();
  const { data: invoice, error } = await client
    .from("crm_invoices")
    .select("id,invoice_number,title,status,client_id,amount,notes,due_date,created_at")
    .eq("id", id.data)
    .eq("organization_id", identity.organizationId)
    .single();
  if (error || !invoice) return new Response("Invoice unavailable", { status: 404 });
  const [customer, payments] = await Promise.all([
    client
      .from("crm_clients")
      .select("title,email,phone")
      .eq("id", invoice.client_id)
      .eq("organization_id", identity.organizationId)
      .single(),
    client.rpc("crm_invoice_receipts", { p_ids: [id.data] }),
  ]);
  if (!customer.data || customer.error || payments.error)
    return new Response("Invoice data unavailable", { status: 503 });
  const bytes = await generateInvoicePdf({
    number: invoice.invoice_number,
    title: invoice.title,
    status: invoice.status,
    client: customer.data,
    createdAt: invoice.created_at,
    dueDate: invoice.due_date,
    amount: Number(invoice.amount),
    received: Number(payments.data?.[0]?.received ?? 0),
    notes: invoice.notes,
  });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoice_number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
