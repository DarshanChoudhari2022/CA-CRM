import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export type InvoicePdfData = {
  number: string;
  title: string;
  status: string;
  createdAt: string;
  dueDate?: string | null;
  client: { title: string; email?: string | null; phone?: string | null };
  amount: number;
  received: number;
  notes: string;
};

// Standard PDF fonts support Latin text; normalize unsupported glyphs instead of
// failing the whole download on an emoji or Indian rupee symbol in a record.
const printable = (value: string) =>
  value
    .replaceAll("₹", "INR ")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E\n]/g, "?");
export async function generateInvoicePdf(invoice: InvoicePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${invoice.number} - PSB & Associates LLP`);
  pdf.setAuthor("PSB & Associates LLP");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.09, 0.17, 0.25),
    muted = rgb(0.38, 0.43, 0.49);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 785;
  const line = (text: string, size = 11, strong = false, color = navy) => {
    if (y < 65) {
      page = pdf.addPage([595.28, 841.89]);
      y = 785;
    }
    page.drawText(printable(text), { x: 48, y, size, font: strong ? bold : regular, color });
    y -= size + 10;
  };
  const wrapped = (text: string, size = 11) => {
    for (const paragraph of printable(text).split("\n")) {
      let current = "";
      // Split very long words too; user-entered notes cannot overflow the page.
      for (const word of paragraph.split(/\s+/)) {
        for (const token of word.match(/.{1,30}/g) ?? [""]) {
          const candidate = current ? `${current} ${token}` : token;
          if (regular.widthOfTextAtSize(candidate, size) > 490 && current) {
            line(current, size);
            current = token;
          } else current = candidate;
        }
      }
      line(current, size);
    }
  };
  line("PSB & Associates LLP", 21, true);
  line("Chartered Accountants", 10, false, muted);
  y -= 22;
  line(invoice.status === "draft" ? "DRAFT INVOICE" : invoice.status === "void" ? "VOID INVOICE" : "INVOICE", 25, true);
  line(invoice.number, 12, true);
  line(`Created: ${new Date(invoice.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`, 10);
  if (invoice.dueDate) line(`Due: ${invoice.dueDate}`, 10);
  y -= 18;
  line("BILL TO", 10, true, muted);
  wrapped(invoice.client.title, 14);
  if (invoice.client.email) wrapped(invoice.client.email);
  if (invoice.client.phone) line(invoice.client.phone);
  y -= 18;
  line("SERVICE / DESCRIPTION", 10, true, muted);
  wrapped(invoice.title, 13);
  y -= 12;
  const money = (value: number) =>
    `INR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  line(`Invoice total: ${money(invoice.amount)}`, 15, true);
  line(`Payments recorded: ${money(invoice.received)}`, 11);
  line(`Balance due: ${money(Math.max(0, invoice.amount - invoice.received))}`, 15, true);
  if (invoice.notes) {
    y -= 20;
    line("NOTES", 10, true, muted);
    wrapped(invoice.notes, 10);
  }
  y -= 20;
  wrapped("Generated from PSB Workspace. Amounts reflect the recorded invoice and payment ledger.", 9);
  for (const [index, sheet] of pdf.getPages().entries())
    sheet.drawText(`${invoice.number}  |  ${index + 1} / ${pdf.getPageCount()}`, {
      x: 48,
      y: 28,
      font: regular,
      size: 8,
      color: muted,
    });
  return pdf.save();
}
