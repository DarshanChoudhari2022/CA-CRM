import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import { afterEach, expect, it, vi } from "vitest";
import { defaultInvoiceDetails, invoiceTotals } from "./invoice-details";
import { generateInvoicePdf } from "./invoice-pdf";

afterEach(() => vi.restoreAllMocks());

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

it.each(["classic", "modern"] as const)(
  "renders the supplied %s design, with live data and original page dimensions",
  async (template) => {
    const classic = template === "classic";
    const details = defaultInvoiceDetails("Services", 0, classic ? "2026-08-10" : "2026-06-11");
    details.template = template;
    details.documentType = classic ? "quotation" : "invoice";
    details.reference = classic ? "PSB/2627/Q6" : "PSB/3";
    details.address = classic ? "Chh. Sambhajinaagr." : "";
    details.attention = classic ? "Demo Contact" : "";
    details.gstin = classic ? "" : "27AAACA0000A1Z8";
    details.placeOfSupply = classic ? "" : "27 - Maharashtra";
    details.discountPercent = classic ? 0 : 10;
    details.items = classic
      ? [
          ["Accounting/Bookkeeping services", "", 10000],
          ["GST Monthly & Annual return filing", "( 2 Returns per Month & 1 Annual return )", 14000],
          ["TDS Computation & Compliance", "( 2 Returns per quarter as applicable )", 8000],
          ["Monthly payroll & Payslip", "", 12000],
          ["Professional Tax/PF/ESI Compliance", "( PF & ESIC fees will be extra when applicable)", 2000],
          ["HR related services", "", 6000],
          ["Monthly MIS & Accounting Finalisation", "", 8000],
          ["Statutory Audit", "(Applicable as per companies Act)", 10000],
          ["MCA/ROC Annual filing", "(Filing of AOC-4 & MGT-7 form)", 5000],
          ["IT return filing & Tax Audit", "( Tax Audit fees will be extra if applicable.)", 5000],
        ].map(([description, details, rate]) => ({
          description: String(description),
          details: String(details),
          hsnSac: "",
          rate: Number(rate),
          quantity: 1,
        }))
      : [
          ["Account & Book Keeping", 1, 10000],
          ["GST Return filing", 24, 500],
          ["Income Tax Audit", 1, 5000],
          ["Statutory Audit", 1, 10000],
          ["TDS Return filing", 4, 2000],
        ].map(([description, quantity, rate]) => ({
          description: String(description),
          details: "",
          hsnSac: "",
          quantity: Number(quantity),
          rate: Number(rate),
        }));
    const bytes = await generateInvoicePdf({
      number: details.reference,
      title: "Professional services",
      status: "issued",
      createdAt: details.invoiceDate,
      dueDate: "2026-06-18",
      client: { title: classic ? "New Private Limited Company" : "DUMMY" },
      amount: invoiceTotals(details).total,
      received: 0,
      notes: "",
      details,
    });
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getPage(0).getWidth()).toBeCloseTo(classic ? 612 : 595.28);
    expect(document.getPage(0).getHeight()).toBeCloseTo(classic ? 792 : 841.89);
    if (process.env.INVOICE_RENDER_PREVIEWS === "1") {
      await mkdir("output/pdf", { recursive: true });
      await writeFile(`output/pdf/psb-invoice-${template}-sample.pdf`, bytes);
    }
  },
);

it("continues large item lists onto further template pages and rejects inconsistent totals", async () => {
  const details = defaultInvoiceDetails("Services", 100, "2026-10-16");
  details.items = Array.from({ length: 12 }, (_, i) => ({ ...details.items[0], description: `Service ${i + 1}` }));
  const invoice = {
    number: "TEST",
    title: "Services",
    status: "issued",
    createdAt: details.invoiceDate,
    client: { title: "Test" },
    amount: 1200,
    received: 0,
    notes: "",
    details,
  };
  expect((await PDFDocument.load(await generateInvoicePdf(invoice))).getPageCount()).toBe(3);
  await expect(generateInvoicePdf({ ...invoice, amount: 1199 })).rejects.toThrow("saved total");
});

it("generates a balance-specific payment QR and keeps fully paid invoices marked paid", async () => {
  const qr = vi.spyOn(QRCode, "toBuffer");
  const invoice = {
    number: "BALANCE-TEST",
    title: "Bookkeeping",
    status: "issued",
    createdAt: "2026-10-16",
    client: { title: "Demo client" },
    amount: 10000,
    received: 2000,
    notes: "",
  };
  const partial = await generateInvoicePdf(invoice);
  expect(qr).toHaveBeenCalledTimes(1);
  const payment = new URL(String(qr.mock.calls[0][0]));
  expect(payment.protocol).toBe("upi:");
  expect(payment.hostname).toBe("pay");
  expect(Object.fromEntries(payment.searchParams)).toEqual({
    pa: "PSBA@ICICI",
    pn: "P S B & ASSOCIATES LLP",
    am: "8000.00",
    cu: "INR",
    tn: "BALANCE-TEST",
  });
  qr.mockClear();
  const paid = await generateInvoicePdf({ ...invoice, received: 10000 });
  expect(qr).not.toHaveBeenCalled();
  expect((await PDFDocument.load(partial)).getPageCount()).toBe(1);
  expect((await PDFDocument.load(paid)).getPageCount()).toBe(1);
  if (process.env.INVOICE_RENDER_PREVIEWS === "1") {
    await mkdir("tmp/pdfs/invoice-templates", { recursive: true });
    await writeFile("tmp/pdfs/invoice-templates/partial-payment.pdf", partial);
    await writeFile("tmp/pdfs/invoice-templates/fully-paid.pdf", paid);
  }
});

it.each([
  ["draft", "invoice", 0],
  ["void", "invoice", 0],
  ["issued", "quotation", 0],
  ["draft", "quotation", 0],
  ["issued", "invoice", 100],
  ["issued", "invoice", 110],
] as const)("does not generate a payment QR for %s %s with received %s", async (status, documentType, received) => {
  const qr = vi.spyOn(QRCode, "toBuffer");
  const details = defaultInvoiceDetails("Services", 100, "2026-10-26");
  details.documentType = documentType;
  const bytes = await generateInvoicePdf({
    number: "NO-PAYMENT",
    title: "Services",
    status,
    createdAt: details.invoiceDate,
    client: { title: "Test client" },
    amount: 100,
    received,
    notes: "",
    details,
  });
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  expect(qr).not.toHaveBeenCalled();
});
