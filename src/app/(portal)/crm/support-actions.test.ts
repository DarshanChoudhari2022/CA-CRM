import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  client: vi.fn(),
  permission: vi.fn(),
  rpc: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/modules/identity/session", () => ({ requireIdentity: mocks.identity }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/crm/providers", () => ({ integrationStatus: () => ({ WhatsApp: true }), sendWhatsApp: mocks.send }));

import { supportDraft, supportSend } from "./support-actions";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
function setup() {
  vi.stubEnv("WHATSAPP_PROVIDER", "authkey");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  mocks.identity.mockResolvedValue({ role: "admin", organizationId: "org-demo" });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: mocks.permission };
  mocks.client.mockResolvedValue({ from: () => query, rpc: mocks.rpc });
  const form = new FormData();
  for (const [key, value] of Object.entries({
    id: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    channel: "whatsapp",
    recipient: "+919999999999",
    subject: "Demo",
    body: "demo",
    confirmed: "yes",
    leaveName: "Demo",
    leaveDates: "26 October",
    leaveStatus: "approved",
  }))
    form.set(key, value);
  return form;
}
describe("Authkey admin send boundary", () => {
  it.each(["employee", "manager"])("rejects %s AI drafts before accessing data or providers", async (role) => {
    const form = setup();
    mocks.identity.mockResolvedValue({ role });
    expect(await supportDraft({}, form)).toEqual({ error: "Administrator required." });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects employee sends before any data access", async () => {
    const form = setup();
    mocks.identity.mockResolvedValue({ role: "employee" });
    expect(await supportSend({}, form)).toEqual({ error: "Administrator required." });
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("requires recorded recipient permission", async () => {
    const form = setup();
    mocks.permission.mockResolvedValue({ data: { allowed: false } });
    expect((await supportSend({}, form)).error).toContain("recipient permission");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("reserves readable template content and blocks duplicate requests", async () => {
    const form = setup();
    mocks.permission.mockResolvedValue({ data: { allowed: true } });
    mocks.rpc.mockResolvedValue({ error: { message: "Already submitted" } });
    expect(await supportSend({}, form)).toEqual({ error: "Already submitted" });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "crm_reserve_send",
      expect.objectContaining({
        p_body:
          "Dear Demo, your leave request for 26 October has been approved. Please contact PSB Associates if you need assistance.",
      }),
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
