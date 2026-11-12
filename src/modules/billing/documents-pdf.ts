import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { invoiceDetailsSchema } from "@/modules/crm/invoice-details";
import { generateInvoicePdf } from "@/modules/crm/invoice-pdf";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { billingDocumentNumber, billingLabels, isAdjustment, type SupplementKind } from "./documents";

export async function getSupplementalDocumentPdf(id: string, kinds: SupplementKind[]) {
  const { organizationId } = await requireCrmIdentity();
  if (!z.uuid().safeParse(id).success) return new Response("Invalid document", { status: 400 });
  const db = await createClient();
  const { data: document, error } = await db
    .from("billing_documents")
    .select("kind,title,notes,status,client_id,source_invoice_id,created_at,due_date,amount,invoice_details")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .in("kind", kinds)
    .maybeSingle();
  if (error) return new Response("Document unavailable", { status: 503 });
  if (!document) return new Response("Document unavailable", { status: 404 });
  const kind = kinds.find((entry) => entry === document.kind);
  if (!kind) return new Response("Document unavailable", { status: 404 });

  const [customer, source] = await Promise.all([
    db
      .from("crm_clients")
      .select("title,email,phone")
      .eq("organization_id", organizationId)
      .eq("id", document.client_id)
      .single(),
    document.source_invoice_id
      ? db
          .from("crm_invoices")
          .select("invoice_number")
          .eq("organization_id", organizationId)
          .eq("id", document.source_invoice_id)
          .single()
      : Promise.resolve(null),
  ]);
  if (customer.error || source?.error) return new Response("Document data unavailable", { status: 503 });
  const number = billingDocumentNumber(kind, id);
  try {
    const details = invoiceDetailsSchema.parse(document.invoice_details);
    const bytes = await generateInvoicePdf({
      ...document,
      number,
      client: customer.data,
      amount: Number(document.amount),
      received: 0,
      createdAt: document.created_at,
      dueDate: document.due_date,
      documentLabel: billingLabels[kind],
      details: { ...details, template: kind === "quotation" ? details.template : "modern", documentType: "quotation" },
      notes: [
        source?.data ? `Source invoice: ${source.data.invoice_number}` : "",
        isAdjustment(kind) ? "Draft adjustment. Invoice balance is unchanged." : "",
        document.notes,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const output =
      kind === "quotation" || details.presentation ? bytes : await labelSupplement(bytes, kind, document.status);
    return new Response(Buffer.from(output), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${number}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("Shorten the item")) {
      return new Response(cause.message, { status: 422 });
    }
    return new Response("The document PDF could not be generated.", { status: 503 });
  }
}

// The existing modern quotation artwork supplies the branding and document
// layout. Replace its printed type and status at the same template positions.
async function labelSupplement(bytes: Uint8Array, kind: SupplementKind, status: string) {
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const white = rgb(1, 1, 1);
  const green = rgb(0.09, 0.65, 0.28);
  for (const page of pdf.getPages()) {
    const height = page.getHeight();
    const label = billingLabels[kind];
    page.drawRectangle({ x: 423, y: height - 50, width: 152, height: 20, color: white });
    page.drawText(label, { x: 571 - font.widthOfTextAtSize(label, 14), y: height - 45, size: 14, font, color: green });
    if (status === "issued") {
      page.drawRectangle({ x: 517, y: height - 465, width: 64, height: 14, color: white });
      const badge = "PROFORMA";
      page.drawText(badge, {
        x: 549 - font.widthOfTextAtSize(badge, 10) / 2,
        y: height - 462,
        size: 10,
        font,
        color: green,
      });
    }
  }
  return pdf.save();
}
