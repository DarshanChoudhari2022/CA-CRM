import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ saveRecord: vi.fn(), recordPayment: vi.fn(), convertLead: vi.fn() }));

import { RecordEditor } from "./record-form";

it("opens the invoice creation shortcut with both PDF templates and billing inputs ready", () => {
  const html = renderToStaticMarkup(
    <RecordEditor
      module="invoices"
      admin
      initialOpen
      clients={[{ id: "client", title: "Demo client" }]}
      employees={[]}
    />,
  );
  expect(html).toContain('open=""');
  expect(html).toContain("Create invoice");
  expect(html).toContain('value="classic"');
  expect(html).toContain('value="modern"');
  expect(html).toContain('name="invoice_details"');
  expect(html).toContain("Demo client");
});
