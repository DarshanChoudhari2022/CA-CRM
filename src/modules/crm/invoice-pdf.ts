import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { loadInvoiceArtwork } from "./invoice-artwork";
import {
  amountInWords,
  defaultInvoiceDetails,
  type InvoiceDetails,
  type InvoiceItem,
  invoiceDetailsSchema,
  invoiceTotals,
} from "./invoice-details";

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
  details?: InvoiceDetails;
  documentLabel?: string;
};
type TextStyle = {
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
  width?: number;
  align?: "left" | "right" | "center";
};
const black = rgb(0, 0, 0),
  ink = rgb(0.1, 0.14, 0.2),
  muted = rgb(0.43, 0.47, 0.54);
const green = rgb(0.09, 0.77, 0.33),
  pale = rgb(226 / 255, 239 / 255, 217 / 255);
const money = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function generateInvoicePdf(invoice: InvoicePdfData): Promise<Uint8Array> {
  const details = invoiceDetailsSchema.parse(
    invoice.details ?? defaultInvoiceDetails(invoice.title, invoice.amount, invoice.createdAt),
  );
  const totals = invoiceTotals(details);
  if (Math.abs(totals.total - invoice.amount) > 0.004) throw new Error("Invoice items do not match the saved total.");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const reference = details.reference || invoice.number;
  pdf.setTitle(`${reference} - PSB & Associates LLP`);
  pdf.setAuthor("PSB & Associates LLP");
  const art = await loadInvoiceArtwork();
  const classic = details.template === "classic";
  const balance = Math.max(0, Math.round((invoice.amount - invoice.received) * 100) / 100);
  const payment = new URLSearchParams({
    pa: "PSBA@ICICI",
    pn: "P S B & ASSOCIATES LLP",
    am: balance.toFixed(2),
    cu: "INR",
    tn: reference,
  });
  const paymentQr =
    !details.presentation &&
    !classic &&
    details.documentType === "invoice" &&
    invoice.status === "issued" &&
    balance > 0
      ? await pdf.embedPng(
          await QRCode.toBuffer(`upi://pay?${payment}`, { margin: 0, scale: 5, errorCorrectionLevel: "M" }),
        )
      : null;
  const [background, bank, regular, bold, heading, fallback, fallbackBold, italic] = await Promise.all([
    details.presentation ? Promise.resolve(null) : pdf.embedPng(classic ? art.classic : art.modern),
    !details.presentation && classic ? pdf.embedPng(art.bank) : Promise.resolve(null),
    pdf.embedFont(art.regular, { subset: true }),
    pdf.embedFont(art.bold, { subset: true }),
    pdf.embedFont(art.heading, { subset: true }),
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.HelveticaOblique),
  ]);
  const sets = new Map<PDFFont, Set<number>>();
  for (const font of [regular, bold, heading, fallback, fallbackBold, italic])
    sets.set(font, new Set(font.getCharacterSet()));
  const runs = (value: string, primary: PDFFont) => {
    const output: Array<{ text: string; font: PDFFont }> = [];
    for (const char of value.replace(/[\r\n\t]/g, " ")) {
      const font =
        [primary, primary === bold ? fallbackBold : fallback, regular].find((f) =>
          sets.get(f)?.has(char.codePointAt(0) ?? 0),
        ) ?? fallback;
      const text = sets.get(font)?.has(char.codePointAt(0) ?? 0) ? char : "?";
      const previous = output.at(-1);
      if (previous?.font === font) previous.text += text;
      else output.push({ text, font });
    }
    return output;
  };
  const measure = (value: string, font: PDFFont, size: number) =>
    runs(value, font).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
  const overflow = new Set<string>();
  const text = (page: PDFPage, value: string, x: number, baseline: number, style: TextStyle) => {
    let size = style.size;
    const initial = measure(value, style.font, size);
    if (style.width && initial > style.width) size = Math.max(5, (size * style.width) / initial);
    if (style.width && measure(value, style.font, size) > style.width) {
      overflow.add(value);
      while (value && measure(`${value}...`, style.font, size) > style.width) value = value.slice(0, -1);
      value += "...";
    }
    const width = measure(value, style.font, size);
    let cursor = x - (style.align === "right" ? width : style.align === "center" ? width / 2 : 0);
    for (const run of runs(value, style.font)) {
      page.drawText(run.text, {
        x: cursor,
        y: page.getHeight() - baseline,
        font: run.font,
        size,
        color: style.color ?? black,
      });
      cursor += run.font.widthOfTextAtSize(run.text, size);
    }
  };
  const wrap = (value: string, font: PDFFont, size: number, width: number) => {
    const lines: string[] = [];
    for (const paragraph of value.split(/\r?\n/)) {
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        let token = "";
        for (const char of word) {
          if (token && measure(token + char, font, size) > width) {
            if (current) {
              lines.push(current);
              current = "";
            }
            lines.push(token);
            token = char;
          } else token += char;
        }
        const candidate = current ? `${current} ${token}` : token;
        if (current && measure(candidate, font, size) > width) {
          lines.push(current);
          current = token;
        } else current = candidate;
      }
      if (current) lines.push(current);
    }
    return lines;
  };
  const rect = (
    page: PDFPage,
    x: number,
    top: number,
    width: number,
    height: number,
    color = rgb(1, 1, 1),
    borderWidth = 0,
  ) =>
    page.drawRectangle({
      x,
      y: page.getHeight() - top - height,
      width,
      height,
      color,
      borderColor: black,
      borderWidth,
    });
  const rule = (page: PDFPage, x: number, top: number, x2: number, top2: number, color = black, thickness = 0.6) =>
    page.drawLine({
      start: { x, y: page.getHeight() - top },
      end: { x: x2, y: page.getHeight() - top2 },
      color,
      thickness,
    });
  const date = (value: string, dotted = false) => {
    const [year, month, day] = value.slice(0, 10).split("-");
    return dotted
      ? `${day}.${month}.${year}`
      : `${day}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1]}-${year}`;
  };
  if (details.presentation) {
    const presentation = details.presentation;
    const minimal = presentation.layout === "minimal";
    const modern = presentation.layout === "modern";
    const issuerFont = modern || minimal ? bold : await pdf.embedFont(StandardFonts.TimesRomanBold);
    sets.set(issuerFont, new Set(issuerFont.getCharacterSet()));
    const accentHex = presentation.accent.slice(1);
    const accent = minimal
      ? ink
      : rgb(
          parseInt(accentHex.slice(0, 2), 16) / 255,
          parseInt(accentHex.slice(2, 4), 16) / 255,
          parseInt(accentHex.slice(4, 6), 16) / 255,
        );
    const issuer = presentation.issuer || "PSB & Associates LLP";
    const label = invoice.documentLabel ?? (details.documentType === "quotation" ? "Quotation" : "Invoice");
    pdf.setTitle(`${reference} - ${issuer}`);
    pdf.setAuthor(issuer);
    const left = 42;
    const right = 553;
    const width = right - left;
    let top = 0;
    const startPage = () => {
      const sheet = pdf.addPage([595.28, 841.89]);
      if (!minimal) rect(sheet, left, 34, width, modern ? 5 : 2, accent);
      top = 61;
      return sheet;
    };
    let page = startPage();
    const draw = (value: string, x: number, style: TextStyle) => text(page, value, x, top, style);
    const ensure = (height: number) => {
      if (top + height <= 792) return false;
      page = startPage();
      return true;
    };
    const bodyStyle = { font: regular, size: 10, color: ink };
    const labelStyle = { font: bold, size: 10, color: ink };
    const paragraph = (value: string, x = left, available = width, style = bodyStyle) => {
      if (!value) return;
      for (const block of value.split(/\r?\n/)) {
        if (!block.trim()) {
          top += 9;
          continue;
        }
        for (const line of wrap(block, style.font, style.size, available)) {
          ensure(15);
          draw(line, x, style);
          top += 15;
        }
      }
    };
    const issuerX = presentation.showLogo ? left + 48 : left;
    if (presentation.showLogo) {
      const logo = await pdf.embedPng(await readFile(join(process.cwd(), "public", "brand", "ca-india-logo.png")));
      const dimensions = logo.scaleToFit(35, 35);
      page.drawImage(logo, { x: left, y: page.getHeight() - 49 - dimensions.height, ...dimensions });
    }
    draw(label, right, { font: bold, size: 23, align: "right", color: ink, width: 220 });
    paragraph(issuer, issuerX, 300 - (issuerX - left), {
      font: issuerFont,
      size: 16,
      color: ink,
    });
    top += 9;
    draw(invoice.status.toUpperCase(), right, { font: bold, size: 9, align: "right", color: muted });
    paragraph(presentation.issuerDetails, issuerX, 300 - (issuerX - left));
    top = Math.max(top, 91);
    top += 12;
    rule(page, left, top, right, top, accent, 1);
    top += 23;
    const meta = [
      ["Number", invoice.number],
      ["Reference", details.reference],
      ["Date", date(details.invoiceDate)],
      [label === "Invoice" ? "Due" : "Valid until", invoice.dueDate ? date(invoice.dueDate) : ""],
    ].filter(([, value]) => value);
    const recipientTop = top;
    for (const [key, value] of meta) {
      draw(key, 388, { ...bodyStyle, color: muted });
      draw(value, right, { ...bodyStyle, align: "right", width: 108 });
      top += 16;
    }
    const metadataEnd = top;
    top = recipientTop;
    paragraph("Bill to", left, 300, labelStyle);
    paragraph(presentation.recipient || invoice.client.title, left, 310);
    paragraph(
      [
        details.attention,
        presentation.recipientContact,
        details.address,
        details.gstin && `GSTIN ${details.gstin}`,
        details.placeOfSupply && `Place of supply ${details.placeOfSupply}`,
      ]
        .filter(Boolean)
        .join("\n"),
      left,
      310,
    );
    top = Math.max(top, metadataEnd) + 13;
    paragraph(invoice.title, left, width, labelStyle);
    top += 11;
    const tableHead = () => {
      if (modern) rect(page, left, top - 13, width, 22, ink);
      const style = { ...labelStyle, color: modern ? rgb(1, 1, 1) : ink };
      draw("Description", left + 6, style);
      for (const [value, x] of [
        ["Qty", 370],
        ["Rate", 455],
        ["Amount", 547],
      ] as const)
        draw(value, x, { ...style, align: "right" });
      top += 12;
      rule(page, left, top, right, top, accent);
      top += 16;
    };
    ensure(60);
    tableHead();
    details.items.forEach((item, index) => {
      const description = [item.description, item.hsnSac && `HSN / SAC ${item.hsnSac}`, item.details]
        .filter(Boolean)
        .join("\n");
      const lines = wrap(description, regular, 10, 280);
      if (ensure(34)) tableHead();
      for (const [value, x, columnWidth] of [
        [String(item.quantity), 370, 39],
        [money(item.rate), 455, 76],
        [money(totals.lines[index]), 547, 85],
      ] as const)
        draw(value, x, { ...bodyStyle, align: "right", width: columnWidth });
      for (const line of lines) {
        if (ensure(20)) tableHead();
        draw(line, left + 6, bodyStyle);
        top += 15;
      }
      rule(page, left, top - 5, right, top - 5, rgb(0.85, 0.87, 0.88));
      top += 6;
    });
    const summary = [
      ["Subtotal", totals.subtotal],
      ["Discount", totals.discount],
      ["Total", totals.total],
      ...(label === "Invoice" && invoice.received > 0
        ? ([
            ["Received", invoice.received],
            ["Balance due", balance],
          ] as const)
        : []),
    ] as const;
    ensure(summary.length * 21 + 15);
    top += 12;
    for (const [key, value] of summary) {
      const style = key === "Total" || key === "Balance due" ? labelStyle : bodyStyle;
      if (key === "Total") rule(page, 350, top - 13, right, top - 13, accent);
      draw(key, 353, style);
      draw(`INR ${money(value)}`, right, { ...style, align: "right", width: 130 });
      top += 21;
    }
    for (const [key, value] of [
      ["Payment instructions", presentation.payment],
      ["Notes", invoice.notes],
      ["Terms and conditions", presentation.terms],
      ["Issued by", presentation.signatory],
      ["", presentation.footer],
    ]) {
      if (!value) continue;
      ensure(48);
      top += 12;
      if (key) paragraph(key, left, width, labelStyle);
      paragraph(value);
    }
    const pages = pdf.getPages();
    pages.forEach((sheet, index) => {
      text(sheet, `${index + 1} / ${pages.length}`, right, sheet.getHeight() - 28, {
        font: regular,
        size: 8,
        align: "right",
        color: muted,
      });
    });
    return pdf.save();
  }
  const sheet = () => {
    const page = pdf.addPage(classic ? [612, 792] : [595.28, 841.89]);
    if (background) page.drawImage(background, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    if (classic) {
      text(page, details.documentType === "quotation" ? "quotation" : "INVOICE", 291, 123.5, {
        font: details.documentType === "quotation" ? heading : fallbackBold,
        size: 17.13,
        align: "center",
      });
      text(page, date(details.invoiceDate, true), 451.2, 153, { font: bold, size: 7.55, width: 64 });
      text(page, reference, 451.2, 165.72, { font: bold, size: 7.55, width: 64 });
      const addressLines = wrap(details.address, bold, 7.55, 230);
      const address = addressLines.slice(0, 2);
      if (addressLines.length > 2) overflow.add(`Billing address: ${details.address}`);
      text(page, invoice.client.title, 131.16, 178.3, { font: bold, size: 8.5, width: 230 });
      address.forEach((line, i) => {
        text(page, line, 131.04, 191 + i * 11, { font: bold, size: 7.55 });
      });
      if (details.attention)
        text(page, `Kind Attention : ${details.attention}`, 131.04, address.length > 1 ? 214 : 204, {
          font: regular,
          size: 8.5,
          width: 230,
        });
    } else {
      if (details.documentType === "quotation") {
        rect(page, 475, 30, 98, 20);
        text(page, "Quotation", 571, 45, { font: fallbackBold, size: 14, color: green, align: "right" });
      }
      text(page, `#${reference}`, 571, 61, { font: fallback, size: 7.5, color: muted, align: "right", width: 160 });
      text(page, invoice.client.title, 23, 122, { font: fallbackBold, size: 10, color: ink, width: 350 });
      let y = 134;
      if (details.address) {
        text(page, details.address.replace(/\n/g, ", "), 23, y, {
          font: fallback,
          size: 7.5,
          color: muted,
          width: 350,
        });
        y += 10;
      }
      if (details.gstin) {
        text(page, `GSTIN: ${details.gstin}`, 23, y, { font: fallback, size: 7.5, color: muted });
        y += 12;
      }
      if (details.placeOfSupply)
        text(page, `POS: ${details.placeOfSupply}`, 23, y, { font: fallback, size: 7.5, color: muted, width: 350 });
      text(page, date(details.invoiceDate), 571, 115.5, { font: fallbackBold, size: 9, color: ink, align: "right" });
      text(page, invoice.dueDate ? date(invoice.dueDate) : "—", 571, 143.5, {
        font: fallbackBold,
        size: 9,
        color: ink,
        align: "right",
      });
      if (paymentQr) page.drawImage(paymentQr, { x: 526.5, y: 841.89 - 436 - 45.5, width: 45.5, height: 45.5 });
      else
        text(
          page,
          invoice.status === "void"
            ? "VOID"
            : invoice.status !== "issued"
              ? "DRAFT"
              : details.documentType === "quotation"
                ? "QUOTATION"
                : "PAID",
          549,
          462,
          {
            font: fallbackBold,
            size: 10,
            color: green,
            align: "center",
          },
        );
      if (invoice.received > 0)
        text(page, `Payments recorded: ₹${money(invoice.received)}   Balance: ₹${money(balance)}`, 23, 416, {
          font: fallback,
          size: 7.5,
          color: ink,
        });
    }
    if (invoice.status !== "issued")
      text(page, invoice.status === "void" ? "VOID" : "DRAFT", classic ? 66 : 23, classic ? 145 : 85, {
        font: fallbackBold,
        size: 7,
        color: muted,
      });
    return page;
  };
  type LayoutItem = { item: InvoiceItem; index: number; description: string[]; detail: string[]; height: number };
  const pages: LayoutItem[][] = [[]];
  const capacity = classic ? 276 : invoice.received > 0 ? 100 : 110;
  let used = 0;
  details.items.forEach((item, index) => {
    const description = wrap(item.description, classic ? bold : fallback, classic ? 9.46 : 7.4, classic ? 225 : 312);
    const extra = [item.details, classic && item.quantity !== 1 ? `Qty: ${item.quantity}` : ""]
      .filter(Boolean)
      .join(" · ");
    const detail = wrap(extra, classic ? regular : fallback, classic ? 8.5 : 7, classic ? 225 : 312);
    const height = classic
      ? Math.max(2, description.length + detail.length) * 13.8
      : Math.max(20, (description.length + detail.length) * 9 + 9);
    if (height > capacity) throw new Error("Shorten the item description or details so it fits the selected template.");
    if (used + height > capacity) {
      pages.push([]);
      used = 0;
    }
    pages.at(-1)?.push({ item, index, description, detail, height });
    used += height;
  });
  for (const [pageIndex, items] of pages.entries()) {
    const page = sheet();
    const last = pageIndex === pages.length - 1;
    if (classic) {
      rect(page, 442, 234.5, 76, 303.6, pale);
      for (const col of [60.8, 129.5, 368, 442, 518]) {
        rule(page, col, 234.5, col, 538);
        rule(page, col + 1.4, 234.5, col + 1.4, 538);
      }
      for (let y = 234.5; y <= 538; y += 13.8) {
        rule(page, 60.8, y, 518, y);
        rule(page, 60.8, y + 1.4, 518, y + 1.4);
      }
      let top = 248.3;
      for (const row of items) {
        text(page, `${row.index + 1}`, 96, top + 9.5, { font: bold, size: 9.46, align: "center" });
        row.description.forEach((line, i) => {
          text(page, line, 139.56, top + 10.4 + i * 13.8, { font: bold, size: 9.46 });
        });
        row.detail.forEach((line, i) => {
          text(page, line, 139.32, top + 10.4 + (row.description.length + i) * 13.8, { font: regular, size: 8.5 });
        });
        text(page, money(row.item.rate), 436, top + 9.5, { font: regular, size: 9.46, align: "right", width: 65 });
        text(page, money(totals.lines[row.index]), 513, top + 9.5, {
          font: regular,
          size: 9.46,
          align: "right",
          width: 65,
        });
        top += row.height;
      }
      const extra = last && totals.discount > 0 ? 13.8 : 0;
      const bottom = 565.6 + extra;
      rect(page, 60.8, 538, 457.2, 27.6 + extra, pale, 0.7);
      rule(page, 368, 538, 368, bottom);
      rule(page, 442, 538, 442, bottom);
      if (last) {
        text(page, amountInWords(totals.total), 214, 554 + extra / 2, {
          font: bold,
          size: 9.46,
          align: "center",
          width: 297,
        });
        const rows: Array<[string, number]> = [
          ["SUBTOTAL", totals.subtotal],
          ...(totals.discount ? [[`DISC. ${details.discountPercent}%`, -totals.discount] as [string, number]] : []),
          ["TOTAL", totals.total],
        ];
        rows.forEach(([label, value], i) => {
          if (i) rule(page, 368, 538 + i * 13.8, 518, 538 + i * 13.8);
          text(page, label, 405, 547.5 + i * 13.8, { font: regular, size: 9.46, align: "center", width: 69 });
          text(page, `₹ ${money(value)}`, 513, 547.5 + i * 13.8, {
            font: i === rows.length - 1 ? bold : regular,
            size: 9.46,
            align: "right",
            width: 69,
          });
        });
      } else text(page, "Continued on next page", 214, 554, { font: regular, size: 9.46, align: "center" });
      rect(page, 60.8, bottom, 457.2, 13.4, rgb(1, 1, 1), 0.7);
      text(page, "PAN No : AAOFP7066K", 71.4, bottom + 10.5, { font: bold, size: 9.46 });
      if (bank) page.drawImage(bank, { x: 60, y: 792 - (579 + extra) - 149, width: 460, height: 149 });
      if (invoice.received > 0)
        text(page, `Payments recorded: ₹${money(invoice.received)}   Balance: ₹${money(balance)}`, 62, 751, {
          font: regular,
          size: 7.5,
          width: 453,
        });
    } else {
      let top = 185;
      for (const row of items) {
        if (row.index % 2) rect(page, 23, top, 549, row.height, rgb(0.97, 0.975, 0.98));
        text(page, String(row.index + 1), 28, top + 15, { font: fallback, size: 7.4, color: muted });
        row.description.forEach((line, i) => {
          text(page, line, 46, top + 15 + i * 9, { font: fallback, size: 7.4, color: ink });
        });
        row.detail.forEach((line, i) => {
          text(page, line, 46, top + 15 + (row.description.length + i) * 9, { font: fallback, size: 7, color: muted });
        });
        text(page, row.item.hsnSac, 386, top + 15, { font: fallback, size: 7, align: "right", width: 25, color: ink });
        text(page, String(row.item.quantity), 418, top + 15, {
          font: fallback,
          size: 7.4,
          align: "right",
          width: 26,
          color: ink,
        });
        text(page, `₹${money(row.item.rate)}`, 468, top + 15, {
          font: fallback,
          size: 7.4,
          align: "right",
          width: 47,
          color: ink,
        });
        text(page, `₹${money(totals.lines[row.index])}`, 517, top + 15, {
          font: fallback,
          size: 7.4,
          align: "right",
          width: 47,
          color: ink,
        });
        text(page, `₹${money(totals.lines[row.index])}`, 567, top + 15, {
          font: fallbackBold,
          size: 7.4,
          align: "right",
          width: 47,
          color: ink,
        });
        top += row.height;
      }
      const subtotalY = Math.max(311, top + 26);
      if (last) {
        text(page, "Subtotal", 388, subtotalY, { font: fallback, size: 8.2, color: muted });
        text(page, `₹${money(totals.subtotal)}`, 572, subtotalY, {
          font: fallback,
          size: 8.2,
          align: "right",
          color: ink,
        });
        if (totals.discount) {
          text(page, `Discount (${details.discountPercent}%)`, 388, subtotalY + 15, {
            font: fallback,
            size: 8.2,
            color: muted,
          });
          text(page, `-₹${money(totals.discount)}`, 572, subtotalY + 15, {
            font: fallback,
            size: 8.2,
            color: rgb(0.95, 0.2, 0.2),
            align: "right",
          });
        }
        rule(page, 388, subtotalY + 20, 572, subtotalY + 20, green, 1);
        text(page, "Total", 388, subtotalY + 39, { font: fallbackBold, size: 10.2, color: ink });
        text(page, `₹${money(totals.total)}`, 572, subtotalY + 39, {
          font: fallbackBold,
          size: 10.2,
          color: green,
          align: "right",
        });
        rect(page, 23, subtotalY + 56, 549, 35, rgb(0.97, 0.975, 0.98));
        text(page, "Amount in Words", 32, subtotalY + 74, { font: fallback, size: 7.5, color: muted });
        text(page, amountInWords(totals.total), 32, subtotalY + 88, {
          font: italic,
          size: 8.2,
          color: ink,
          width: 531,
        });
      } else text(page, "Continued on next page", 23, 330, { font: fallback, size: 9, color: muted });
    }
  }
  const notes = wrap(
    [invoice.notes, ...overflow].filter(Boolean).join("\n\n"),
    classic ? regular : fallback,
    9,
    classic ? 430 : 530,
  );
  const linesPerPage = classic ? 24 : 18;
  for (let i = 0; i < notes.length; i += linesPerPage) {
    const page = sheet();
    rect(
      page,
      classic ? 60.8 : 23,
      classic ? 220 : 162,
      classic ? 457.2 : 549,
      classic ? 358 : 261,
      rgb(1, 1, 1),
      classic ? 0.7 : 0,
    );
    text(page, "Additional notes", classic ? 72 : 23, classic ? 244 : 180, { font: bold, size: 11, color: ink });
    notes.slice(i, i + linesPerPage).forEach((line, index) => {
      text(page, line, classic ? 72 : 23, (classic ? 265 : 201) + index * 12, {
        font: classic ? regular : fallback,
        size: 9,
        color: ink,
      });
    });
    if (bank) page.drawImage(bank, { x: 60, y: 792 - 579 - 149, width: 460, height: 149 });
  }
  if (pdf.getPageCount() > 1)
    pdf.getPages().forEach((page, i) => {
      text(page, `Page ${i + 1} of ${pdf.getPageCount()}`, classic ? 518 : 572, classic ? 741 : 720, {
        font: fallback,
        size: 6.5,
        color: muted,
        align: "right",
      });
    });
  return pdf.save();
}
