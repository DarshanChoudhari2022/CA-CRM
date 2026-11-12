import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ingest: vi.fn(), rpc: vi.fn() }));
vi.mock("@/modules/crm/automation/store", () => ({
  automationOrganization: () => "11111111-1111-4111-8111-111111111111",
  automationStore: () => ({ rpc: mocks.rpc }),
  ingest: mocks.ingest,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.stubEnv("CRM_WEBHOOK_SECRET", "test-signing-secret");
  mocks.ingest.mockResolvedValue("enquiry-id");
  mocks.rpc.mockResolvedValue({ data: { outstanding: 60 }, error: null });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
const website = {
  id: "website-demo-1",
  kind: "website",
  data: {
    name: "Demo enquiry",
    email: "DEMO@example.invalid",
    message: "I need bookkeeping for a company this month.",
  },
};
function signed(event: unknown, age = 0) {
  const raw = JSON.stringify(event);
  const stamp = String(Math.floor(Date.now() / 1000) - age);
  return new Request("https://crm.example.invalid/api/integrations/crm", {
    method: "POST",
    headers: {
      "x-crm-timestamp": stamp,
      "x-crm-signature": `sha256=${createHmac("sha256", "test-signing-secret").update(`${stamp}.${raw}`).digest("hex")}`,
    },
    body: raw,
  });
}
it("accepts a signed website enquiry and preserves its event ID and contact", async () => {
  const response = await POST(signed(website));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: "enquiry-id" });
  expect(mocks.ingest).toHaveBeenCalledWith(
    "website",
    website.id,
    "demo@example.invalid",
    website.data.name,
    website.data.message,
    undefined,
  );
});
it("rejects forged signatures before recording any enquiry", async () => {
  const request = signed(website);
  request.headers.set("x-crm-signature", "sha256=forged");
  expect((await POST(request)).status).toBe(401);
  expect(mocks.ingest).not.toHaveBeenCalled();
});
it("rejects expired signed requests before accessing the database", async () => {
  expect((await POST(signed(website, 301))).status).toBe(401);
  expect(mocks.ingest).not.toHaveBeenCalled();
});
it("requires an email or international phone contact", async () => {
  expect((await POST(signed({ ...website, data: { name: "Demo", message: "Help" } }))).status).toBe(400);
  expect(mocks.ingest).not.toHaveBeenCalled();
});
it("passes payment event IDs to the idempotent payment boundary", async () => {
  const data = { invoice_id: "22222222-2222-4222-8222-222222222222", amount: 40 };
  const response = await POST(signed({ id: "payment-demo-1", kind: "payment", data }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ outstanding: 60 });
  expect(mocks.rpc).toHaveBeenCalledWith("crm_external_update", {
    p_org: "11111111-1111-4111-8111-111111111111",
    p_id: "payment-demo-1",
    p_kind: "payment",
    p_data: data,
  });
});
it("returns a conflict without disclosing database error details", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "private database detail" } });
  const response = await POST(
    signed({
      id: "payment-demo-1",
      kind: "payment",
      data: { invoice_id: "22222222-2222-4222-8222-222222222222", amount: 40 },
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain("private database detail");
});
