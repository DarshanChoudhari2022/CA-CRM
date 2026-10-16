# PSB invoice designs

Administrators can select either supplied design from CRM → Invoice generator → Generate invoice PDF. The Employee directory also has a Create invoice / PDF shortcut, opening `/crm/invoices?create=1` with the creation form expanded. The selected design can be changed for a download without changing the saved financial details. Employees cannot open the invoice page, export invoices, read billing details or access PDF URLs.

## Creating an invoice

1. Open CRM → Invoice generator → Create invoice (or use Create invoice / PDF in Employees).
2. Select the customer, record name, status and due date.
3. Under Invoice design and billing details, choose Green invoice (Template 2) or Classic bordered (Template 1).
4. Choose the printed PDF heading: Invoice or Quotation. This changes the document heading; it does not create a separate quotation pipeline or change how the existing invoice ledger classifies records. Keep a quotation in draft until it is ready to become an invoice.
5. Enter the invoice date and optional reference. Leaving the reference empty uses the existing generated invoice number. Non-empty references are unique within the organization.
6. Enter the billing address, optional GSTIN, place of supply and classic-template attention line.
7. Add service descriptions, optional explanatory lines and HSN/SAC codes, quantities and rates. Up to 50 lines are supported. The total updates after applying the percentage discount. The server and database validate the same rounding and saved total. GST tax amounts are not inferred from the GSTIN or HSN/SAC.
8. Save the record, choose the PDF design on its card and click Generate invoice PDF.

Issued billing details are locked. Existing aggregate-only invoices remain downloadable: the generator derives a single service line using the saved title and amount. Their notes remain editable. Additional notes and unusually long billing text continue onto additional pages rather than overlapping the supplied layout. Long item lists continue on further pages with the matching design.

## Reference fidelity

The classic design retains the original US Letter dimensions, firm header, green bordered tables, bank block, seal and contact footer. The modern design retains the original A4 page, green heading and borders, billing labels, item columns, payment section, terms, signature block and footer. Static artwork is rasterized at 216 dpi from the supplied PDFs; line items and financial values remain selectable PDF text. Original classic font subsets are embedded, with a standard-font fallback for characters absent from those subsets.

The source customer, dates, invoice number, items, totals and amount-in-words fields are permanently erased from the prepared artwork. Original PDFs and their hidden text are not embedded or required at runtime. Prepared artwork is under `assets/invoices`, outside the public directory. The extraction script is `scripts/prepare-invoice-templates.py` and requires Python, PyMuPDF and Pillow only when re-preparing artwork; production rendering uses Node.js.

The modern reference QR decodes to a UPI payment for `PSBA@ICICI`, with a sample amount of INR 40,500 and reference PSB/3. Copying that image would make every invoice request the sample amount. Its pixels are removed from the background. The generator creates a fresh QR in the same location using that supplied payee, the current balance and the current document reference. Fully paid or void invoices do not include a payment-request QR. QR generation does not confirm a payment or update the payment ledger.

## Release and verification

Apply `20261016120000_invoice_templates.sql` together with the matching application version, after the attendance/access migrations. The migration adds invoice details and validated, audited persistence through the existing `crm_save` function. The migration runner already includes it. No new external API key is required.

The invoice route's deployment file tracing includes the prepared artwork, so Vercel receives the required assets. Fonts, PDF generation and QR encoding stay on the server. Immutable artwork bytes are cached; PDF documents and customer data are constructed separately for each request.

Run `node --env-file=.env.local scripts/test-invoice-templates-db.mjs` for a rollback-only migration and permission check. Run `npm test`, `npm run lint`, `npm run typecheck` and `npm run build` for application validation. For visual samples, set `INVOICE_RENDER_PREVIEWS=1` and run `npx vitest run src/modules/crm/invoice-pdf.test.ts`. This writes the two samples to `output/pdf/` and payment verification examples to `tmp/pdfs/invoice-templates/`.
