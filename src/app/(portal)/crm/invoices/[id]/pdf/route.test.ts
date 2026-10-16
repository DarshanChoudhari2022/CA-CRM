import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), client: vi.fn() }));
vi.mock("@/modules/identity/session", () => ({ requireIdentity: mocks.identity }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));

import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());
it("denies a direct invoice PDF URL to an employee before reading financial data", async () => {
  mocks.identity.mockResolvedValue({ role: "employee" });
  const response = await GET(new Request("https://example.invalid/crm/invoices/id/pdf"), {
    params: Promise.resolve({ id: "id" }),
  });
  expect(response.status).toBe(403);
  expect(mocks.client).not.toHaveBeenCalled();
});
it("validates invoice identifiers before reading data", async () => {
  mocks.identity.mockResolvedValue({ role: "admin" });
  const response = await GET(new Request("https://example.invalid/crm/invoices/id/pdf"), {
    params: Promise.resolve({ id: "id" }),
  });
  expect(response.status).toBe(400);
  expect(mocks.client).not.toHaveBeenCalled();
});
