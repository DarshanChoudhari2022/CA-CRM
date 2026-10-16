import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Only immutable bytes are shared. Each request gets its own PDFDocument.
let artwork:
  | Promise<{
      classic: Uint8Array;
      bank: Uint8Array;
      modern: Uint8Array;
      regular: Uint8Array;
      bold: Uint8Array;
      heading: Uint8Array;
    }>
  | undefined;
export function loadInvoiceArtwork() {
  artwork ??= Promise.all(
    [
      "classic-background.png",
      "classic-bank.png",
      "modern-background.png",
      "classic-regular.ttf",
      "classic-bold.ttf",
      "classic-heading.ttf",
    ].map((name) => readFile(join(process.cwd(), "assets", "invoices", name))),
  )
    .then(([classic, bank, modern, regular, bold, heading]) => ({ classic, bank, modern, regular, bold, heading }))
    .catch((error) => {
      artwork = undefined;
      throw error;
    });
  return artwork;
}
