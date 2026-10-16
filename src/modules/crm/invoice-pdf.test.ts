import { PDFDocument } from "pdf-lib";
import { expect, it } from "vitest";
import { generateInvoicePdf } from "./invoice-pdf";

it("generates a valid paginated PDF for long notes and unsupported glyphs", async () => {
  const bytes = await generateInvoicePdf({
    number: "PSB-00000001",
    title: "Tax services ₹ ✅",
    status: "issued",
    createdAt: "2026-10-16T06:00:00Z",
    dueDate: "2026-11-01",
    client: { title: "Test client", email: "demo@example.invalid" },
    amount: 10000,
    received: 2000,
    notes: "Service notes ".repeat(300),
  });
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getTitle()).toContain("PSB-00000001");
  expect(pdf.getPageCount()).toBeGreaterThan(1);
});
