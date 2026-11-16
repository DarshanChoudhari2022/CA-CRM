import { invoiceDetailsSchema, invoiceTotals } from "@/modules/crm/invoice-details";

export const billingKinds = ["invoice", "quotation", "proforma", "credit_note", "debit_note"] as const;
export type BillingKind = (typeof billingKinds)[number];
export type SupplementKind = Exclude<BillingKind, "invoice">;

export const billingLabels: Record<BillingKind, string> = {
  invoice: "Invoice",
  quotation: "Quotation",
  proforma: "Proforma Invoice",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
};

export function isAdjustment(kind: BillingKind) {
  return kind === "credit_note" || kind === "debit_note";
}

export function billingPath(kind: BillingKind) {
  switch (kind) {
    case "invoice":
      return "/invoice/raise";
    case "quotation":
      return "/invoice/quotations";
    case "proforma":
      return "/invoice/proformas";
    default:
      return "/invoice/notes";
  }
}

export function parseBillingDetails(kind: BillingKind, input: unknown) {
  const details = invoiceDetailsSchema.parse({
    ...(typeof input === "object" && input !== null ? input : {}),
    documentType: kind === "invoice" ? "invoice" : "quotation",
  });
  const totals = invoiceTotals(details);
  if (totals.total <= 0) throw new Error("Enter a positive document total.");
  return { details, totals };
}

export const formatBillingAmount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export function billingDocumentNumber(kind: SupplementKind, id: string) {
  const prefix = { quotation: "QT", proforma: "PF", credit_note: "CN", debit_note: "DN" }[kind];
  return `PSB-${prefix}-${id.toUpperCase()}`;
}
