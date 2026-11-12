import { getSupplementalDocumentPdf } from "@/modules/billing/documents-pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return getSupplementalDocumentPdf((await params).id, ["proforma"]);
}
