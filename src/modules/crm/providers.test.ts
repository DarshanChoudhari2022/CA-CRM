import { afterEach, describe, expect, it, vi } from "vitest";
import { draftReply, sendGmail, sendWhatsApp } from "./providers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("CRM providers (mocked, no external sends)", () => {
  it("requires Groq configuration before network calls", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(draftReply("Title", "Query")).rejects.toThrow("not configured");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requests a human-reviewed draft without tools", async () => {
    vi.stubEnv("GROQ_API_KEY", "fixture");
    vi.stubEnv("GROQ_MODEL", "test-model");
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ choices: [{ message: { content: "Review this reply" } }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await draftReply("Query", "Question")).toBe("Review this reply");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe("test-model");
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).toContain("Never invent");
  });
  it("encodes UTF-8 Gmail MIME and returns acceptance id", async () => {
    for (const name of ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]) vi.stubEnv(name, "fixture");
    vi.stubEnv("GMAIL_SENDER", "office@example.invalid");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "fixture-token" }))
      .mockResolvedValueOnce(Response.json({ id: "accepted-123" }));
    vi.stubGlobal("fetch", fetch);
    expect(await sendGmail("recipient@example.invalid", "Reply ₹", "Hello ₹")).toBe("accepted-123");
    const mime = Buffer.from(JSON.parse(fetch.mock.calls[1][1].body).raw, "base64url").toString("utf8");
    expect(mime).toContain("To: recipient@example.invalid");
    expect(mime).toContain(Buffer.from("Hello ₹").toString("base64"));
  });
  it("uses WhatsApp approved template, not unsolicited free-text messages", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "fixture");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
    vi.stubEnv("WHATSAPP_GRAPH_VERSION", "v99.0");
    vi.stubEnv("WHATSAPP_TEMPLATE_NAME", "reviewed_reply");
    vi.stubEnv("WHATSAPP_TEMPLATE_LANGUAGE", "en");
    const fetch = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wa-accepted" }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await sendWhatsApp("+919999999999", "Reviewed reply")).toBe("wa-accepted");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("reviewed_reply");
    expect(body.to).toBe("919999999999");
  });
});
