// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { defaultInvoiceDetails } from "@/modules/crm/invoice-details";
import { InvoiceFields } from "./invoice-fields";

it("preserves remaining service data and recalculates the submitted amount after removing an item", async () => {
  const details = defaultInvoiceDetails("First", 100, "2026-10-16");
  details.discountPercent = 10;
  details.items.push({ description: "Second", details: "Quarterly", hsnSac: "9982", quantity: 2, rate: 200 });
  const item = {
    id: "invoice",
    title: "Services",
    status: "draft",
    notes: "",
    owner_id: null,
    amount: 450,
    created_at: "2026-10-16",
    invoice_details: details,
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <form>
          <InvoiceFields item={item} />
        </form>,
      ),
    );
    expect(container.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe("450");
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove item 1"]')?.click());
    expect(container.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe("360");
    const saved = JSON.parse(container.querySelector<HTMLInputElement>('input[name="invoice_details"]')?.value ?? "{}");
    expect(saved.items).toEqual([details.items[1]]);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Item 1 description"]')?.value).toBe("Second");
  } finally {
    await act(async () => root.unmount());
  }
});

it("locks issued billing fields without disabling the existing aggregate-only invoice's hidden total", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <InvoiceFields
          item={{
            id: "legacy",
            title: "Services",
            status: "issued",
            notes: "",
            owner_id: null,
            amount: 1000,
            created_at: "2026-10-16",
          }}
        />,
      ),
    );
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe("1000");
    expect(container.querySelector<HTMLInputElement>('input[name="invoice_details"]')?.value).toBe("");
  } finally {
    await act(async () => root.unmount());
  }
});
