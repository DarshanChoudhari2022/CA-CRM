import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyGmailConnection } from "./gmail-connection";
import { sendGmail } from "./providers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function setup() {
  for (const key of ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"])
    vi.stubEnv(key, "private-fixture");
  vi.stubEnv("GMAIL_SENDER", "demo@example.invalid");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("Gmail diagnostics", () => {
  it.each(["invalid_grant", "invalid_client", "unauthorized_client", "invalid_request"])(
    "reports %s without leaking the response or sending",
    async (code) => {
      const fetch = setup().mockResolvedValue(
        Response.json({ error: code, error_description: "private-fixture" }, { status: 400 }),
      );
      await expect(sendGmail("recipient@example.invalid", "Test", "hello")).rejects.toThrow(code);
      await expect(verifyGmailConnection()).rejects.not.toThrow("private-fixture");
      expect(fetch.mock.calls.every(([url]) => url === "https://oauth2.googleapis.com/token")).toBe(true);
    },
  );
  it("checks the configured mailbox without a send request", async () => {
    const fetch = setup()
      .mockResolvedValueOnce(Response.json({ access_token: "secret" }))
      .mockResolvedValueOnce(Response.json({ emailAddress: "demo@example.invalid" }));
    await expect(verifyGmailConnection()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/profile");
  });
  it("detects the wrong connected mailbox", async () => {
    setup()
      .mockResolvedValueOnce(Response.json({ access_token: "secret" }))
      .mockResolvedValueOnce(Response.json({ emailAddress: "other@example.invalid" }));
    await expect(verifyGmailConnection()).rejects.toThrow("does not match GMAIL_SENDER");
  });
  it("identifies insufficient scope", async () => {
    setup()
      .mockResolvedValueOnce(Response.json({ access_token: "secret" }))
      .mockResolvedValueOnce(
        Response.json({ error: { errors: [{ reason: "insufficientPermissions" }] } }, { status: 403 }),
      );
    await expect(sendGmail("recipient@example.invalid", "Test", "hello")).rejects.toThrow("Reauthorize");
  });
  it("preserves uncertainty when the send connection drops", async () => {
    const fetch = setup()
      .mockResolvedValueOnce(Response.json({ access_token: "secret" }))
      .mockRejectedValueOnce(new Error("secret transport failure"));
    await expect(sendGmail("recipient@example.invalid", "Test", "hello")).rejects.toThrow("Delivery is uncertain");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
