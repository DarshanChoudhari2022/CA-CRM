import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { defaultInvoiceDetails, invoiceDetailsSchema, invoiceTemplates } from "@/modules/crm/invoice-details";
import { generateInvoicePdf } from "@/modules/crm/invoice-pdf";
import { isAdministrator } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await requireIdentity();
  if (!isAdministrator(identity.role)) return new Response("Administrator access required", { status: 403 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Invalid invoice", { status: 400 });
  const template = new URL(request.url).searchParams.get("template");
  if (template && !invoiceTemplates.some((value) => value === template))
    return new Response("Unknown invoice template", { status: 400 });
  const client = await createClient();
  const { data: invoice, error } = await client
    .from("crm_invoices")
    .select("id,invoice_number,title,status,client_id,amount,notes,due_date,created_at,invoice_details")
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
  const parsedDetails = invoiceDetailsSchema.safeParse(invoice.invoice_details);
  const details = parsedDetails.success
    ? parsedDetails.data
    : defaultInvoiceDetails(invoice.title, Number(invoice.amount), invoice.created_at);
  if (template === "classic" || template === "modern") details.template = template;
  let bytes: Uint8Array;
  try {
    bytes = await generateInvoicePdf({
      number: invoice.invoice_number,
      title: invoice.title,
      status: invoice.status,
      client: customer.data,
      createdAt: invoice.created_at,
      dueDate: invoice.due_date,
      amount: Number(invoice.amount),
      received: Number(payments.data?.[0]?.received ?? 0),
      notes: invoice.notes,
      details,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Shorten the item"))
      return new Response(error.message, { status: 422 });
    if (error instanceof Error && error.message.includes("saved total"))
      return new Response("Invoice total and billing details disagree. Ask an administrator to review the record.", {
        status: 409,
      });
    return new Response("Invoice PDF could not be generated. Please retry or contact your administrator.", {
      status: 503,
    });
  }
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoice_number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
