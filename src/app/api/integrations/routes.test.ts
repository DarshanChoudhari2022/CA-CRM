import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as receiveCrm } from "./crm/route";
import { POST as receiveWhatsApp } from "./whatsapp/route";

const store = vi.hoisted(() => ({ ingest: vi.fn(), automationStore: vi.fn() }));
vi.mock("@/modules/crm/automation/store", () => ({
  ...store,
  automationOrganization: () => "test-organization",
}));

const secret = "test-webhook-secret";
const signature = (value: string) => `sha256=${createHmac("sha256", secret).update(value).digest("hex")}`;
function request(kind: "crm" | "whatsapp", body: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> =
    kind === "crm"
      ? { "x-crm-timestamp": timestamp, "x-crm-signature": signature(`${timestamp}.${body}`) }
      : { "x-hub-signature-256": signature(body) };
  return new Request(`https://example.invalid/api/integrations/${kind}`, { method: "POST", headers, body });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRM_WEBHOOK_SECRET", secret);
  vi.stubEnv("WHATSAPP_APP_SECRET", secret);
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "test-sender");
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["crm", receiveCrm],
  ["whatsapp", receiveWhatsApp],
] as const)("%s rejects malformed and oversized payloads before persistence", async (kind, handler) => {
  expect((await handler(request(kind, "{"))).status).toBe(400);
  expect((await handler(request(kind, "{}"))).status).toBe(400);
  expect((await handler(request(kind, "x".repeat(128_001)))).status).toBe(413);
  expect(store.automationStore).not.toHaveBeenCalled();
  expect(store.ingest).not.toHaveBeenCalled();
});

it("keeps transient CRM intake failures retryable without revealing provider details", async () => {
  store.ingest.mockRejectedValueOnce(new Error("Internal provider detail"));
  const response = await receiveCrm(
    request(
      "crm",
      JSON.stringify({
        id: "demo",
        kind: "website",
        data: { name: "Demo", email: "demo@example.invalid", message: "An enquiry" },
      }),
    ),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Event could not be processed" });
});
