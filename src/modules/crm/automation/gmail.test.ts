import { afterEach, expect, it, vi } from "vitest";

const ingest = vi.hoisted(() => vi.fn());
vi.mock("./store", () => ({ ingest }));

import { pollGmail } from "./gmail";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function setup() {
  for (const key of ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]) vi.stubEnv(key, "fixture");
  vi.stubEnv("GMAIL_INTAKE_LABEL_ID", " Label_123 ");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("identifies insufficient read scope even if sending works", async () => {
  const fetch = setup()
    .mockResolvedValueOnce(Response.json({ access_token: "private" }))
    .mockResolvedValueOnce(
      Response.json({ error: { errors: [{ reason: "insufficientPermissions" }] } }, { status: 403 }),
    );
  await expect(pollGmail()).rejects.toThrow("required Gmail scopes");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("identifies a rejected label request", async () => {
  setup()
    .mockResolvedValueOnce(Response.json({ access_token: "private" }))
    .mockResolvedValueOnce(Response.json({ error: { message: "raw confidential message" } }, { status: 400 }));
  await expect(pollGmail()).rejects.toThrow("internal label ID");
});
it("uses shared trimmed credentials and completes an empty mailbox poll", async () => {
  const fetch = setup()
    .mockResolvedValueOnce(Response.json({ access_token: "private" }))
    .mockResolvedValueOnce(Response.json({ messages: [] }));
  await expect(pollGmail()).resolves.toBe(0);
  expect(fetch.mock.calls[1][0]).toContain("labelIds=Label_123");
});
it("reports invalid refresh credentials before listing mail", async () => {
  const fetch = setup().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));
  await expect(pollGmail()).rejects.toThrow("invalid_grant");
  expect(fetch).toHaveBeenCalledTimes(1);
});
