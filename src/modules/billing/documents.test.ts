import { expect, test } from "vitest";
import { defaultInvoiceDetails } from "@/modules/crm/invoice-details";
import { parseBillingDetails } from "./documents";

test("the route controls the document type and monetary totals", () => {
  const details = defaultInvoiceDetails("Consulting", 100, "2026-11-12");
  details.discountPercent = 12.5;
  expect(parseBillingDetails("invoice", { ...details, documentType: "quotation" })).toMatchObject({
    details: { documentType: "invoice" },
    totals: { total: 87.5 },
  });
});

test("a document cannot be saved with a zero total", () => {
  const details = defaultInvoiceDetails("Consulting", 0, "2026-11-12");
  expect(() => parseBillingDetails("proforma", details)).toThrow("positive");
});
