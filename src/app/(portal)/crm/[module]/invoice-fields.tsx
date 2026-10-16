"use client";
import { useId, useState } from "react";
import type { CrmRecord } from "@/modules/crm/config";
import {
  defaultInvoiceDetails,
  type InvoiceDetails,
  type InvoiceItem,
  invoiceDetailsSchema,
  invoiceTotals,
} from "@/modules/crm/invoice-details";

export function InvoiceFields({ item }: { item?: CrmRecord }) {
  const id = useId();
  const [details, setDetails] = useState<InvoiceDetails>(() => {
    const parsed = invoiceDetailsSchema.safeParse(item?.invoice_details);
    return parsed.success
      ? parsed.data
      : defaultInvoiceDetails(
          item?.title ?? "Professional services",
          Number(item?.amount ?? 0),
          item?.created_at ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
        );
  });
  const [rowKeys, setRowKeys] = useState(() => details.items.map(() => crypto.randomUUID()));
  const locked = Boolean(item && item.status !== "draft");
  const update = <K extends keyof InvoiceDetails>(key: K, value: InvoiceDetails[K]) =>
    setDetails((previous) => ({ ...previous, [key]: value }));
  const updateItem = (index: number, values: Partial<InvoiceItem>) =>
    update(
      "items",
      details.items.map((row, i) => (i === index ? { ...row, ...values } : row)),
    );
  let total = 0,
    subtotal = 0,
    discount = 0,
    error = "";
  try {
    ({ total, subtotal, discount } = invoiceTotals(details));
  } catch (failure) {
    error = failure instanceof Error ? failure.message : "Check the invoice amounts.";
  }
  return (
    <section className="section">
      <h3>Invoice design and billing details</h3>
      {locked && (
        <p className="stat-note">
          Issued invoice billing details are locked. Both PDF designs remain available when downloading.
        </p>
      )}
      <input
        name="invoice_details"
        type="hidden"
        value={locked && !invoiceDetailsSchema.safeParse(item?.invoice_details).success ? "" : JSON.stringify(details)}
      />
      <input name="amount" type="hidden" value={total} />
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="sr-only">Billing details</legend>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor={`${id}-template`}>PDF template</label>
            <select
              id={`${id}-template`}
              value={details.template}
              onChange={(e) => update("template", e.target.value as InvoiceDetails["template"])}
            >
              <option value="modern">Green invoice - Template 2</option>
              <option value="classic">Classic bordered - Template 1</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-kind`}>PDF heading</label>
            <select
              id={`${id}-kind`}
              value={details.documentType}
              onChange={(e) => update("documentType", e.target.value as InvoiceDetails["documentType"])}
            >
              <option value="invoice">Invoice</option>
              <option value="quotation">Quotation</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-reference`}>Invoice / quotation reference</label>
            <input
              id={`${id}-reference`}
              value={details.reference}
              maxLength={40}
              placeholder="Automatic if left empty"
              onChange={(e) => update("reference", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-date`}>Invoice date</label>
            <input
              id={`${id}-date`}
              type="date"
              required
              value={details.invoiceDate}
              onChange={(e) => update("invoiceDate", e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${id}-address`}>Billing address</label>
          <textarea
            id={`${id}-address`}
            value={details.address}
            maxLength={300}
            onChange={(e) => update("address", e.target.value)}
          />
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor={`${id}-attention`}>Kind attention (classic template)</label>
            <input
              id={`${id}-attention`}
              value={details.attention}
              maxLength={100}
              onChange={(e) => update("attention", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-gstin`}>Client GSTIN (optional)</label>
            <input
              id={`${id}-gstin`}
              value={details.gstin}
              maxLength={15}
              onChange={(e) => update("gstin", e.target.value.toUpperCase())}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-pos`}>Place of supply</label>
            <input
              id={`${id}-pos`}
              value={details.placeOfSupply}
              maxLength={80}
              placeholder="27 - Maharashtra"
              onChange={(e) => update("placeOfSupply", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-discount`}>Discount (%)</label>
            <input
              id={`${id}-discount`}
              type="number"
              min="0"
              max="99.99"
              step="0.01"
              value={details.discountPercent}
              onChange={(e) => update("discountPercent", Number(e.target.value))}
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>HSN/SAC</th>
                <th>Qty</th>
                <th>Rate (INR)</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {details.items.map((row, index) => (
                <tr key={rowKeys[index]}>
                  <td style={{ minWidth: 210 }}>
                    <input
                      aria-label={`Item ${index + 1} description`}
                      value={row.description}
                      maxLength={200}
                      required
                      onChange={(e) => updateItem(index, { description: e.target.value })}
                    />
                    <textarea
                      aria-label={`Item ${index + 1} details`}
                      value={row.details}
                      placeholder="Details (optional)"
                      maxLength={300}
                      onChange={(e) => updateItem(index, { details: e.target.value })}
                    />
                  </td>
                  <td style={{ minWidth: 80 }}>
                    <input
                      aria-label={`Item ${index + 1} HSN SAC`}
                      value={row.hsnSac}
                      maxLength={12}
                      onChange={(e) => updateItem(index, { hsnSac: e.target.value })}
                    />
                  </td>
                  <td style={{ minWidth: 80 }}>
                    <input
                      aria-label={`Item ${index + 1} quantity`}
                      type="number"
                      required
                      min="0.01"
                      max="100000"
                      step="0.01"
                      value={row.quantity}
                      onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
                    />
                  </td>
                  <td style={{ minWidth: 110 }}>
                    <input
                      aria-label={`Item ${index + 1} rate`}
                      type="number"
                      required
                      min="0"
                      max="9999999999.99"
                      step="0.01"
                      value={row.rate}
                      onChange={(e) => updateItem(index, { rate: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={details.items.length === 1}
                      aria-label={`Remove item ${index + 1}`}
                      onClick={() => {
                        setRowKeys((keys) => keys.filter((_, i) => i !== index));
                        update(
                          "items",
                          details.items.filter((_, i) => i !== index),
                        );
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="button button-secondary section"
          disabled={details.items.length >= 50}
          onClick={() => {
            setRowKeys((keys) => [...keys, crypto.randomUUID()]);
            update("items", [...details.items, { description: "", details: "", hsnSac: "", quantity: 1, rate: 0 }]);
          }}
        >
          Add service
        </button>
      </fieldset>
      <p>
        Subtotal INR {subtotal.toFixed(2)} · Discount INR {discount.toFixed(2)} ·{" "}
        <strong>Total INR {total.toFixed(2)}</strong>
      </p>
      <p className="stat-note">
        The PDF uses the selected reference design, including its bank details and footer. GST tax is not added
        automatically.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
