import { z } from "zod";

export const invoiceTemplates = ["classic", "modern"] as const;
export const invoiceDetailsSchema = z.object({
  template: z.enum(invoiceTemplates).default("modern"),
  documentType: z.enum(["invoice", "quotation"]).default("invoice"),
  reference: z.string().trim().max(40).default(""),
  invoiceDate: z.iso.date(),
  address: z.string().trim().max(300).default(""),
  attention: z.string().trim().max(100).default(""),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^$|^[0-9A-Z]{15}$/, "GSTIN must contain 15 letters/digits.")
    .default(""),
  placeOfSupply: z.string().trim().max(80).default(""),
  discountPercent: z.number().finite().min(0).max(99.99).multipleOf(0.01).default(0),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        details: z.string().trim().max(300).default(""),
        hsnSac: z
          .string()
          .trim()
          .max(12)
          .regex(/^[0-9A-Za-z/-]*$/)
          .default(""),
        quantity: z.number().finite().positive().max(100000).multipleOf(0.01),
        rate: z.number().finite().min(0).max(9999999999.99).multipleOf(0.01),
      }),
    )
    .min(1)
    .max(50),
});
export type InvoiceDetails = z.infer<typeof invoiceDetailsSchema>;
export type InvoiceItem = InvoiceDetails["items"][number];

export function invoiceTotals(details: Pick<InvoiceDetails, "items" | "discountPercent">) {
  // Integer hundredths, including fractional quantities, match PostgreSQL numeric rounding.
  const lineCents = details.items.map(
    (item) => (BigInt(Math.round(item.quantity * 100)) * BigInt(Math.round(item.rate * 100)) + 50n) / 100n,
  );
  const subtotalCents = lineCents.reduce((a, b) => a + b, 0n);
  if (subtotalCents > 999999999999n) throw new Error("Invoice amount exceeds the supported limit.");
  const discountCents = (subtotalCents * BigInt(Math.round(details.discountPercent * 100)) + 5000n) / 10000n;
  return {
    lines: lineCents.map((cents) => Number(cents) / 100),
    subtotal: Number(subtotalCents) / 100,
    discount: Number(discountCents) / 100,
    total: Number(subtotalCents - discountCents) / 100,
  };
}
export function defaultInvoiceDetails(title: string, amount: number, date: string): InvoiceDetails {
  const invoiceDate =
    date.length > 10 ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(date)) : date;
  return {
    template: "modern",
    documentType: "invoice",
    reference: "",
    invoiceDate,
    address: "",
    attention: "",
    gstin: "",
    placeOfSupply: "",
    discountPercent: 0,
    items: [{ description: title || "Professional services", details: "", hsnSac: "", quantity: 1, rate: amount }],
  };
}
const small = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function hundreds(value: number): string {
  if (value >= 100) return `${small[Math.floor(value / 100)]} Hundred ${hundreds(value % 100)}`.trim();
  if (value >= 20) return `${tens[Math.floor(value / 10)]} ${small[value % 10]}`.trim();
  return small[value];
}
export function amountInWords(amount: number) {
  let rupees = Math.floor(Math.round(amount * 100) / 100);
  const paise = Math.round(amount * 100) % 100;
  const parts: string[] = [];
  for (const [divisor, name] of [
    [10000000, "Crore"],
    [100000, "Lakh"],
    [1000, "Thousand"],
  ] as const) {
    const count = Math.floor(rupees / divisor);
    if (count) {
      parts.push(`${hundreds(count)} ${name}`);
      rupees %= divisor;
    }
  }
  if (rupees) parts.push(hundreds(rupees));
  return `Rupees ${parts.join(" ") || "Zero"}${paise ? ` and ${hundreds(paise)} Paise` : ""} Only`;
}
