import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  send: vi.fn(),
  link: vi.fn(),
  provider: vi.fn(),
  ready: vi.fn(),
  answer: vi.fn(),
}));
vi.mock("./store", () => ({
  automationOrganization: () => "org",
  automationStore: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("../providers", () => ({ integrationStatus: mocks.ready, sendGmail: mocks.send, sendWhatsApp: vi.fn() }));
vi.mock("../authkey", () => ({ whatsappProvider: mocks.provider }));
vi.mock("./collection", () => ({ createCollectionLink: mocks.link }));
vi.mock("./agent", () => ({ answerEnquiry: mocks.answer }));

import { runAutomation } from "./worker";

let updates: { table: string; values: Record<string, unknown>; filters: Record<string, unknown> }[];
beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubEnv("TELEGRAM_PARTNER_CHAT_ID", "");
  mocks.ready.mockReturnValue({ Gmail: true, Groq: false, WhatsApp: true });
  mocks.provider.mockReturnValue("authkey");
  mocks.send.mockResolvedValue("gmail-provider-id");
  mocks.link.mockResolvedValue("https://crm.example.invalid/collect/private-token");
  updates = [];
  mocks.from.mockImplementation((table: string) => {
    let update: (typeof updates)[number] | undefined;
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        if (update) update.filters[key] = value;
        return chain;
      },
      neq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: { enabled: true, knowledge: "Approved firm information" }, error: null }),
      update: (values: Record<string, unknown>) => {
        update = { table, values, filters: {} };
        updates.push(update);
        return chain;
      },
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are intentionally awaitable.
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "crm_schedule_dispatch" ? 0 : [],
    error: null,
  }));
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

function jobs(items: Record<string, unknown>[]) {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "crm_schedule_dispatch" ? 0 : name === "crm_claim_dispatch" ? items.splice(0, 1) : [],
    error: null,
  }));
}
function job(source = "compliance") {
  return {
    id: "message-id",
    lease: "lease-id",
    source_module: source,
    source_id: "source-id",
    channel: "gmail",
    recipient: "demo@example.invalid",
    subject: "Demo reminder",
    body: "Reviewed reminder",
  };
}
it("adds a private collection link and records provider acceptance against the claimed lease", async () => {
  jobs([job("documents")]);
  expect(await runAutomation()).toMatchObject({ dispatched: 1, failures: 0 });
  expect(mocks.link).toHaveBeenCalledWith("source-id", "org");
  expect(mocks.send).toHaveBeenCalledWith(
    "demo@example.invalid",
    "Demo reminder",
    "Reviewed reminder\nSecure upload: https://crm.example.invalid/collect/private-token",
  );
  expect(updates).toContainEqual({
    table: "crm_dispatch",
    values: expect.objectContaining({ status: "accepted", provider_id: "gmail-provider-id" }),
    filters: { id: "message-id", lease: "lease-id" },
  });
});
it("records an uncertain send without replaying it when the provider drops the connection", async () => {
  jobs([job()]);
  mocks.send.mockRejectedValue(new Error("transport failure"));
  expect(await runAutomation()).toMatchObject({ dispatched: 0, failures: 1 });
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(updates).toContainEqual(
    expect.objectContaining({
      values: expect.objectContaining({ status: "uncertain" }),
      filters: { id: "message-id", lease: "lease-id" },
    }),
  );
});
it("bounds each run to two messages so recurring runs can drain the queue", async () => {
  jobs([job(), job("invoices"), job("documents")]);
  expect(await runAutomation()).toMatchObject({ dispatched: 2 });
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.link).not.toHaveBeenCalled();
});
it("does not claim generic WhatsApp reminders when only the Authkey leave template is configured", async () => {
  await runAutomation();
  expect(mocks.rpc).toHaveBeenCalledWith("crm_claim_dispatch", { p_org: "org", p_channels: ["gmail"] });
});
it("reports a scheduling failure before sending any message", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "database failure" } });
  await expect(runAutomation()).rejects.toThrow("Reminder scheduling failed");
  expect(mocks.send).not.toHaveBeenCalled();
});
