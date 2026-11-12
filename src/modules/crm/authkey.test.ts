import { afterEach, describe, expect, it, vi } from "vitest";
import { leaveTemplateText, verifyAuthkeyConnection } from "./authkey";
import { integrationStatus, sendWhatsApp } from "./providers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const leave = { name: "Demo Employee", dates: "26 to 27 October 2026", status: "approved" as const };
function setup() {
  vi.stubEnv("WHATSAPP_PROVIDER", "authkey");
  vi.stubEnv("AUTHKEY_API_KEY", "test-key");
  vi.stubEnv("AUTHKEY_TEMPLATE_ID", "52797");
  vi.stubEnv("AUTHKEY_COUNTRY_CODE", "91");
  const fetch = vi.fn().mockResolvedValue(Response.json({ LogID: "demo-123", Message: "Submitted Successfully" }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("Authkey leave demo", () => {
  it("checks balance without sending a message", async () => {
    const fetch = setup().mockResolvedValue(Response.json({ balance: 25.5 }));
    await expect(verifyAuthkeyConnection()).resolves.toBe(25.5);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe("/restapi/getbalance.php");
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
  });
  it("identifies negative balance", async () => {
    setup().mockResolvedValue(Response.json({ Balance: -385.91 }));
    await expect(verifyAuthkeyConnection()).rejects.toThrow("Authkey balance is -385.91");
  });
  it("reports invalid credentials without exposing the raw provider response", async () => {
    setup().mockResolvedValue(new Response("Invalid authkey test-key", { status: 401 }));
    await expect(verifyAuthkeyConnection()).rejects.toThrow("authentication failed");
    setup().mockResolvedValue(new Response("Invalid authkey test-key", { status: 401 }));
    await expect(verifyAuthkeyConnection()).rejects.not.toThrow("test-key");
  });
  it("does not mistake an unknown balance response for a verified connection", async () => {
    setup().mockResolvedValue(Response.json({ success: true, other: "private" }));
    await expect(verifyAuthkeyConnection()).rejects.toThrow("unrecognized balance response");
  });
  it("identifies explicit insufficient-credit rejection from the send API", async () => {
    setup().mockResolvedValue(Response.json({ error: "Insufficient balance" }));
    await expect(sendWhatsApp("+919999999999", "", leave)).rejects.toThrow("insufficient balance");
  });
  it.each(["+919999999999", "919999999999", "9999999999"])(
    "normalizes %s and sends three template values",
    async (phone) => {
      const fetch = setup();
      expect(integrationStatus().WhatsApp).toBe(true);
      expect(await sendWhatsApp(phone, "", leave)).toBe("demo-123");
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe("https://console.authkey.io/restapi/requestjson.php");
      expect(init.headers.Authorization).toBe("Basic test-key");
      expect(init.redirect).toBe("error");
      expect(JSON.parse(init.body)).toEqual({
        country_code: "91",
        mobile: "9999999999",
        wid: "52797",
        type: "text",
        bodyValues: { "1": leave.name, "2": leave.dates, "3": "approved" },
      });
    },
  );
  it("fails closed on missing credentials", async () => {
    const fetch = setup();
    vi.stubEnv("AUTHKEY_API_KEY", "");
    expect(integrationStatus().WhatsApp).toBe(false);
    await expect(sendWhatsApp("+919999999999", "", leave)).rejects.toThrow("not configured");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects generic messages before calling the provider", async () => {
    const fetch = setup();
    await expect(sendWhatsApp("+919999999999", "Invoice reminder")).rejects.toThrow("leave template");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["+449999999999", "invalid", "+911234", "9999999999?secret=x"])(
    "rejects invalid recipient %s",
    async (phone) => {
      const fetch = setup();
      await expect(sendWhatsApp(phone, "", leave)).rejects.toThrow("mobile");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("rejects overlong template values", async () => {
    const fetch = setup();
    await expect(sendWhatsApp("+919999999999", "", { ...leave, name: "x".repeat(101) })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ error: "balance" }, { LogID: "x", Message: "Rejected" }, { Message: "Submitted Successfully" }, null])(
    "does not mistake a malformed or rejected response for acceptance",
    async (result) => {
      setup().mockResolvedValue(Response.json(result));
      await expect(sendWhatsApp("+919999999999", "", leave)).rejects.toThrow("acceptance");
    },
  );
  it("does not retry provider HTTP errors", async () => {
    const fetch = setup().mockResolvedValue(new Response("error", { status: 503 }));
    await expect(sendWhatsApp("+919999999999", "", leave)).rejects.toThrow("503");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("records a readable message for review", () => {
    expect(leaveTemplateText(leave)).toBe(
      "Dear Demo Employee, your leave request for 26 to 27 October 2026 has been approved. Please contact PSB Associates if you need assistance.",
    );
  });
  it("fails closed on an unknown provider", async () => {
    const fetch = setup();
    vi.stubEnv("WHATSAPP_PROVIDER", "typo");
    expect(integrationStatus().WhatsApp).toBe(false);
    await expect(sendWhatsApp("+919999999999", "message")).rejects.toThrow("Invalid WhatsApp provider");
    expect(fetch).not.toHaveBeenCalled();
  });
});
