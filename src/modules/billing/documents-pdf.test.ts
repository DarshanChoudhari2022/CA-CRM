import { PDFDocument } from "pdf-lib";
import { beforeEach, expect, test, vi } from "vitest";
import { defaultInvoiceDetails } from "@/modules/crm/invoice-details";
import { getSupplementalDocumentPdf } from "./documents-pdf";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn() }));
vi.mock("@/modules/identity/crm", () => ({ requireCrmIdentity: mocks.guard }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));

const id = "550e8400-e29b-41d4-a716-446655440000";
const organizationId = "550e8400-e29b-41d4-a716-446655440001";

beforeEach(() => vi.resetAllMocks());

test("the supplemental PDF route authorizes access before querying data", async () => {
  mocks.guard.mockRejectedValue(new Error("redirect"));
  await expect(getSupplementalDocumentPdf(id, ["proforma"])).rejects.toThrow("redirect");
  expect(mocks.client).not.toHaveBeenCalled();
});

test("an issued proforma downloads as a private, branded PDF", async () => {
  mocks.guard.mockResolvedValue({ organizationId });
  const document = {
    kind: "proforma",
    title: "Advisory",
    notes: "",
    status: "issued",
    client_id: "550e8400-e29b-41d4-a716-446655440002",
    source_invoice_id: null,
    created_at: "2026-11-12",
    due_date: "2026-12-12",
    amount: 125,
    invoice_details: defaultInvoiceDetails("Advisory", 125, "2026-11-12"),
  };
  const scope = vi.fn().mockReturnThis();
  mocks.client.mockResolvedValue({
    from: (table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: scope,
      in: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({ data: document }),
      single: async () => ({ data: { title: "Example Client" }, error: null }),
      table,
    }),
  });

  const response = await getSupplementalDocumentPdf(id, ["proforma"]);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/pdf");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Disposition")).toContain("PSB-PF-");
  expect(scope).toHaveBeenCalledWith("organization_id", organizationId);
  const pdf = await PDFDocument.load(await response.arrayBuffer());
  expect(pdf.getAuthor()).toBe("PSB & Associates LLP");
  expect(pdf.getPageCount()).toBe(1);
});
