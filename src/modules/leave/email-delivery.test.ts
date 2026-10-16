import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverLeaveEmail } from "./email-delivery";

const delivery = {
  id: "request",
  lease: "lease",
  payload: { access_key: "test-key", message: "Saved leave application" },
};
afterEach(() => vi.unstubAllGlobals());
describe("leave browser email delivery", () => {
  it("only reports accepted when the provider confirms success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true })));
    expect(await deliverLeaveEmail(delivery)).toBe("sent");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: false }, { status: 400 })));
    expect(await deliverLeaveEmail(delivery)).toBe("failed");
  });
  it("keeps timeouts and ambiguous responses uncertain instead of resending", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Network lost"));
    vi.stubGlobal("fetch", fetch);
    expect(await deliverLeaveEmail(delivery)).toBe("uncertain");
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "upstream" }, { status: 500 })));
    expect(await deliverLeaveEmail(delivery)).toBe("uncertain");
  });
});
