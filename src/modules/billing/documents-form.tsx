"use client";

import Image from "next/image";
import { type CSSProperties, useActionState, useState } from "react";
import {
  type DocumentPresentation,
  documentLayouts,
  documentPresentationSchema,
  type InvoiceDetails,
  type InvoiceItem,
  invoiceTotals,
} from "@/modules/crm/invoice-details";
import { type BillingKind, billingLabels, billingPath, formatBillingAmount, isAdjustment } from "./documents";
import styles from "./documents.module.css";
import { saveBillingDocument, transitionBillingDocument } from "./documents-actions";

export type ClientChoice = { id: string; title: string; email: string | null; phone: string | null };
export type ServiceChoice = { id: string; name: string; description: string; sac_code: string; unit_price: number };
export type SourceInvoice = { id: string; client_id: string; invoice_number: string; title: string };
export type BillingFormData = {
  id: string | null;
  updatedAt: string | null;
  status: string;
  number: string | null;
  title: string;
  notes: string;
  clientId: string;
  dueDate: string;
  sourceId: string;
  details: InvoiceDetails;
};

const emptyItem: InvoiceItem = { description: "", details: "", hsnSac: "", quantity: 1, rate: 0 };
const presentationFields = [
  ["issuer", "Firm name", 160, 1],
  ["issuerDetails", "Firm address, contact and tax details", 700, 3],
  ["recipient", "Billing name override", 200, 1],
  ["recipientContact", "Billing contact details", 250, 2],
  ["payment", "Payment instructions", 700, 3],
  ["signatory", "Issued by / signatory", 120, 1],
  ["terms", "Terms and conditions", 3000, 5],
  ["footer", "Document footer", 500, 2],
] as const;
const fields = [
  ["reference", "Reference", 40],
  ["attention", "Attention", 100],
  ["gstin", "GSTIN", 15],
  ["placeOfSupply", "Place of supply", 80],
] as const;

export function BillingDocumentForm({
  kind,
  initial,
  clients,
  sources,
  services,
  requestId,
}: {
  kind: BillingKind;
  initial: BillingFormData;
  clients: ClientChoice[];
  sources: SourceInvoice[];
  services: ServiceChoice[];
  requestId: string;
}) {
  const [creationKey] = useState(requestId);
  const action = saveBillingDocument.bind(null, kind, initial.id, creationKey, initial.updatedAt);
  const [state, submit, pending] = useActionState(action, {});
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes);
  const [clientId, setClientId] = useState(initial.clientId);
  const [sourceId, setSourceId] = useState(initial.sourceId);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [details, setDetails] = useState(initial.details);
  const [lineKeys, setLineKeys] = useState(() => initial.details.items.map((_, index) => String(index)));
  const adjustment = isAdjustment(kind);
  const locked = initial.status !== "draft";
  const presentation = details.presentation ?? documentPresentationSchema.parse({ layout: details.template });
  const client = clients.find((choice) => choice.id === clientId);
  const source = sources.find((choice) => choice.id === sourceId);
  const pdf =
    initial.id && (kind === "invoice" ? `/crm/invoices/${initial.id}/pdf` : `${billingPath(kind)}/${initial.id}/pdf`);
  let totals: ReturnType<typeof invoiceTotals> | undefined;
  try {
    totals = invoiceTotals(details);
  } catch {
    // The builder stays usable while an out-of-range amount is being edited.
  }
  function addItem(item: InvoiceItem) {
    setDetails((previous) => ({ ...previous, items: [...previous.items, item] }));
    setLineKeys((previous) => [...previous, crypto.randomUUID()]);
  }
  const updateDetails = (patch: Partial<InvoiceDetails>) => setDetails((previous) => ({ ...previous, ...patch }));
  const updatePresentation = (patch: Partial<DocumentPresentation>) =>
    updateDetails({ presentation: { ...presentation, ...patch } });
  function updateItem(index: number, patch: Partial<InvoiceItem>) {
    setDetails((previous) => ({
      ...previous,
      items: previous.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  }

  return (
    <div className={styles.split}>
      <form action={submit} className={styles.form}>
        <input type="hidden" name="invoice_details" value={JSON.stringify(details)} />
        {adjustment && <input type="hidden" name="client_id" value={clientId} />}
        <fieldset className="billing-card" disabled={locked || pending}>
          <legend>Document details</legend>
          <label>
            Title
            <input
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={200}
            />
          </label>
          {adjustment ? (
            <>
              <label>
                Source invoice
                <select
                  name="source_invoice_id"
                  value={sourceId}
                  required
                  onChange={(event) => {
                    const selected = sources.find((invoice) => invoice.id === event.target.value);
                    setSourceId(event.target.value);
                    setClientId(selected?.client_id ?? "");
                  }}
                >
                  <option value="">Choose an issued invoice</option>
                  {sourceId && !source && (
                    <option value={sourceId} disabled>
                      Source invoice no longer eligible
                    </option>
                  )}
                  {sources.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.invoice_number} · {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Client
                <input value={client?.title ?? ""} readOnly />
              </label>
            </>
          ) : (
            <label>
              Client
              <select name="client_id" value={clientId} onChange={(event) => setClientId(event.target.value)} required>
                <option value="">Choose a client</option>
                {clients.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.title}
                    {choice.email ? ` · ${choice.email}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className={styles.fields}>
            <label>
              Document date
              <input
                type="date"
                required
                value={details.invoiceDate}
                onChange={(event) => updateDetails({ invoiceDate: event.target.value })}
              />
            </label>
            <label>
              {kind === "quotation" || kind === "proforma" ? "Valid until" : "Due date"}
              <input type="date" name="due_date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
            {fields.map(([key, label, maxLength]) => (
              <label key={key}>
                {label}
                <input
                  maxLength={maxLength}
                  value={details[key]}
                  onChange={(event) => updateDetails({ [key]: event.target.value })}
                />
              </label>
            ))}
          </div>
          <label>
            Billing address
            <textarea
              value={details.address}
              maxLength={300}
              rows={2}
              onChange={(event) => updateDetails({ address: event.target.value })}
            />
          </label>
          {!locked && (
            <label>
              PDF template
              <select
                value={presentation.layout}
                onChange={(event) =>
                  updatePresentation({ layout: documentPresentationSchema.shape.layout.parse(event.target.value) })
                }
              >
                {Object.entries(documentLayouts).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
        <fieldset className="billing-card" disabled={locked || pending}>
          <legend>Line items</legend>
          {!locked && services.length > 0 && details.items.length < 50 && (
            <label>
              Add from service catalog
              <select
                value=""
                onChange={(event) => {
                  const service = services.find((choice) => choice.id === event.target.value);
                  if (!service) return;
                  const item = {
                    description: service.name,
                    details: service.description,
                    hsnSac: service.sac_code,
                    quantity: 1,
                    rate: Number(service.unit_price),
                  };
                  if (
                    details.items.length === 1 &&
                    details.items[0].rate === 0 &&
                    (!details.items[0].description ||
                      (!initial.id && details.items[0].description === "Professional services"))
                  ) {
                    updateItem(0, item);
                  } else {
                    addItem(item);
                  }
                }}
              >
                <option value="">Choose a service</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {details.items.map((item, index) => (
            <div className={styles.item} key={lineKeys[index]}>
              <label>
                Description
                <input
                  required
                  maxLength={200}
                  value={item.description}
                  onChange={(event) => updateItem(index, { description: event.target.value })}
                />
              </label>
              <label>
                Details
                <input
                  maxLength={300}
                  value={item.details}
                  onChange={(event) => updateItem(index, { details: event.target.value })}
                />
              </label>
              <div className={styles.fields}>
                <label>
                  HSN / SAC
                  <input
                    maxLength={12}
                    pattern="[0-9A-Za-z\x2F\x2D]*"
                    value={item.hsnSac}
                    onChange={(event) => updateItem(index, { hsnSac: event.target.value })}
                  />
                </label>
                <label>
                  Quantity
                  <input
                    type="number"
                    min=".01"
                    max="100000"
                    step=".01"
                    required
                    value={item.quantity || ""}
                    onChange={(event) => updateItem(index, { quantity: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Rate (INR)
                  <input
                    type="number"
                    min="0"
                    max="9999999999.99"
                    step=".01"
                    required
                    value={item.rate}
                    onChange={(event) => updateItem(index, { rate: Number(event.target.value) })}
                  />
                </label>
              </div>
              {!locked && details.items.length > 1 && (
                <button
                  type="button"
                  className="billing-button"
                  aria-label={`Remove item ${index + 1}`}
                  onClick={() => {
                    updateDetails({ items: details.items.filter((_, itemIndex) => itemIndex !== index) });
                    setLineKeys(lineKeys.filter((_, itemIndex) => itemIndex !== index));
                  }}
                >
                  Remove item
                </button>
              )}
            </div>
          ))}
          {!locked && details.items.length < 50 && (
            <button type="button" className="billing-button" onClick={() => addItem(emptyItem)}>
              Add item
            </button>
          )}
          <label>
            Discount (%)
            <input
              type="number"
              min="0"
              max="99.99"
              step=".01"
              value={details.discountPercent}
              onChange={(event) => updateDetails({ discountPercent: Number(event.target.value) })}
            />
          </label>
          <label>
            {adjustment ? "Reason for adjustment" : "Notes"}
            <textarea
              name="notes"
              rows={3}
              maxLength={4000}
              value={notes}
              required={adjustment}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </fieldset>
        {(!locked || details.presentation) && (
          <fieldset className="billing-card" disabled={locked || pending}>
            <legend>Branding, payment and terms</legend>
            <label>
              <span>
                <input
                  type="checkbox"
                  checked={presentation.showLogo}
                  onChange={(event) => updatePresentation({ showLogo: event.target.checked })}
                />{" "}
                Show firm logo
              </span>
            </label>
            {presentationFields.map(([key, label, maxLength, rows]) => (
              <label key={key} htmlFor={`document-${key}`}>
                {label}
                {rows === 1 ? (
                  <input
                    id={`document-${key}`}
                    value={presentation[key]}
                    maxLength={maxLength}
                    onChange={(event) => updatePresentation({ [key]: event.target.value })}
                  />
                ) : (
                  <textarea
                    id={`document-${key}`}
                    value={presentation[key]}
                    maxLength={maxLength}
                    rows={rows}
                    onChange={(event) => updatePresentation({ [key]: event.target.value })}
                  />
                )}
              </label>
            ))}
            <label>
              Document accent
              <input
                type="color"
                value={presentation.accent}
                onChange={(event) => updatePresentation({ accent: event.target.value })}
              />
            </label>
          </fieldset>
        )}
        {state.error && <p role="alert">{state.error}</p>}
        <div className="billing-toolbar">
          {!locked && (
            <>
              <button
                type="submit"
                className={`billing-button${adjustment ? " billing-primary" : ""}`}
                name="intent"
                value="draft"
                disabled={pending || (adjustment && !source)}
              >
                Save draft
              </button>
              {!adjustment && (
                <button
                  type="submit"
                  className="billing-button billing-primary"
                  name="intent"
                  value="issued"
                  disabled={pending}
                >
                  Issue {billingLabels[kind].toLowerCase()}
                </button>
              )}
            </>
          )}
          {pdf && (
            <a className="billing-button" href={pdf}>
              Download {locked ? "" : "saved "}PDF
            </a>
          )}
          {pending && <span role="status">Saving…</span>}
        </div>
      </form>
      <aside className={styles.preview} aria-label="Document preview">
        <p className={styles.previewLabel}>Document preview</p>
        <div
          className={styles.paper}
          data-layout={presentation.layout}
          style={{ "--document-accent": presentation.accent } as CSSProperties}
        >
          <header className={styles.paperHeader}>
            <div className={styles.issuer}>
              {presentation.showLogo && <Image src="/brand/ca-india-logo.png" width={42} height={42} alt="" />}
              <div>
                <strong>{presentation.issuer || "PSB & Associates LLP"}</strong>
                {presentation.issuerDetails && <p>{presentation.issuerDetails}</p>}
              </div>
            </div>
            <div>
              <h2>{billingLabels[kind]}</h2>
              <span className={styles.status}>{initial.status}</span>
            </div>
          </header>
          <div className={styles.paperDetails}>
            <div>
              <span className={styles.caption}>Bill to</span>
              <strong>{presentation.recipient || client?.title || "Choose a client"}</strong>
              {presentation.recipientContact && <span>{presentation.recipientContact}</span>}
              {details.attention && <span>{details.attention}</span>}
              {details.address && <span>{details.address}</span>}
              {details.gstin && <span>GSTIN {details.gstin.toUpperCase()}</span>}
              {details.placeOfSupply && <span>Place of supply {details.placeOfSupply}</span>}
            </div>
            <dl>
              <dt>Reference</dt>
              <dd>{details.reference || initial.number || "—"}</dd>
              <dt>Date</dt>
              <dd>{details.invoiceDate || "—"}</dd>
              {dueDate && (
                <>
                  <dt>{kind === "quotation" || kind === "proforma" ? "Valid until" : "Due"}</dt>
                  <dd>{dueDate}</dd>
                </>
              )}
              {source && (
                <>
                  <dt>Source invoice</dt>
                  <dd>{source.invoice_number}</dd>
                </>
              )}
            </dl>
          </div>
          {title && <h3>{title}</h3>}
          <div className={styles.scroll}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Description</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Rate</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {details.items.map((item, index) => (
                  <tr key={lineKeys[index]}>
                    <td>
                      {item.description || "Service"}
                      {item.hsnSac && <small>HSN / SAC {item.hsnSac}</small>}
                      {item.details && <small>{item.details}</small>}
                    </td>
                    <td>{item.quantity || "—"}</td>
                    <td>{formatBillingAmount.format(item.rate)}</td>
                    <td>{totals ? formatBillingAmount.format(totals.lines[index]) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className={styles.totals}>
            <dt>Subtotal</dt>
            <dd>{totals ? formatBillingAmount.format(totals.subtotal) : "—"}</dd>
            <dt>Discount</dt>
            <dd>{totals ? formatBillingAmount.format(totals.discount) : "—"}</dd>
            <dt>
              <strong>Total</strong>
            </dt>
            <dd>
              <strong>{totals ? formatBillingAmount.format(totals.total) : "—"}</strong>
            </dd>
          </dl>
          {(
            [
              ["Payment instructions", presentation.payment],
              ["Notes", notes],
              ["Terms and conditions", presentation.terms],
              ["Issued by", presentation.signatory],
            ] as const
          ).map(
            ([label, value]) =>
              value && (
                <section key={label} className={styles.notes}>
                  <h4>{label}</h4>
                  <p>{value}</p>
                </section>
              ),
          )}
          {presentation.footer && <footer className={styles.paperFooter}>{presentation.footer}</footer>}
        </div>
      </aside>
    </div>
  );
}

export function BillingDocumentTransition({
  kind,
  id,
  accepted,
}: {
  kind: "quotation" | "proforma";
  id: string;
  accepted: boolean;
}) {
  const [state, submit, pending] = useActionState(transitionBillingDocument.bind(null, kind, id), {});
  const accepting = kind === "quotation" && !accepted;
  return (
    <form action={submit} className="billing-toolbar">
      {accepted && <span>Accepted</span>}
      <button
        type="submit"
        className="billing-button billing-primary"
        name="intent"
        value={accepting ? "accept" : "convert"}
        disabled={pending}
      >
        {accepting ? "Mark accepted" : "Convert to invoice draft"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
      {pending && <span role="status">Saving…</span>}
    </form>
  );
}
