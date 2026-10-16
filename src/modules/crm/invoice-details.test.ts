import { describe, expect, it } from "vitest";
import { amountInWords, defaultInvoiceDetails, invoiceDetailsSchema, invoiceTotals } from "./invoice-details";

describe("invoice template billing", () => {
  it("uses the firm's local invoice date for existing timestamped records", () => {
    expect(defaultInvoiceDetails("Services", 100, "2026-10-16T20:00:00Z").invoiceDate).toBe("2026-10-17");
  });
  it("matches the modern reference's quantities and ten percent discount", () => {
    const details = defaultInvoiceDetails("Services", 0, "2026-06-11");
    details.discountPercent = 10;
    details.items = [10000, 500, 5000, 10000, 2000].map((rate, i) => ({
      description: `Service ${i}`,
      details: "",
      hsnSac: "",
      quantity: [1, 24, 1, 1, 4][i],
      rate,
    }));
    expect(invoiceTotals(details)).toEqual({
      lines: [10000, 12000, 5000, 10000, 8000],
      subtotal: 45000,
      discount: 4500,
      total: 40500,
    });
    expect(amountInWords(40500)).toBe("Rupees Forty Thousand Five Hundred Only");
  });
  it("uses exact line and discount rounding for fractional quantities", () => {
    const details = defaultInvoiceDetails("Services", 0.05, "2026-06-11");
    details.items[0].quantity = 0.1;
    details.discountPercent = 10;
    expect(invoiceTotals(details)).toEqual({ lines: [0.01], subtotal: 0.01, discount: 0, total: 0.01 });
    expect(amountInWords(12345678.99)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Nine Paise Only",
    );
  });
  it("rejects malformed or excessive items and invalid template choices", () => {
    const details = defaultInvoiceDetails("Services", 10, "2026-06-11");
    expect(invoiceDetailsSchema.safeParse({ ...details, template: "../other" }).success).toBe(false);
    expect(invoiceDetailsSchema.safeParse({ ...details, items: [] }).success).toBe(false);
    expect(invoiceDetailsSchema.safeParse({ ...details, discountPercent: 100 }).success).toBe(false);
    expect(invoiceDetailsSchema.safeParse({ ...details, gstin: "bad" }).success).toBe(false);
    expect(() =>
      invoiceTotals({ ...details, items: [{ ...details.items[0], rate: 9999999999.99, quantity: 100000 }] }),
    ).toThrow("supported limit");
  });
});
