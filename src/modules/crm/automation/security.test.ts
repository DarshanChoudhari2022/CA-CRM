import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { emailText } from "./gmail";
import { boundedBody, secretMatches, verifySignature } from "./security";

describe("automation adapters", () => {
  it("fails closed without configured secrets", () => {
    expect(secretMatches("anything", undefined)).toBe(false);
    expect(verifySignature("{}", null, undefined)).toBe(false);
  });
  it("checks exact raw webhook bytes", () => {
    const signature = `sha256=${createHmac("sha256", "fixture").update('{"x":1}').digest("hex")}`;
    expect(verifySignature('{"x":1}', signature, "fixture")).toBe(true);
    expect(verifySignature('{"x":2}', signature, "fixture")).toBe(false);
  });
  it("bounds bodies independently of content-length", async () => {
    await expect(
      boundedBody(new Request("https://example.invalid", { method: "POST", body: "123456" }), 5),
    ).rejects.toThrow("Payload too large");
  });
  it("extracts nested plain text without interpreting attachment bytes", () => {
    expect(
      emailText({
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("Hello").toString("base64url") } },
          {
            filename: "secrets.txt",
            mimeType: "text/plain",
            body: { data: Buffer.from("secret").toString("base64url") },
          },
        ],
      }),
    ).toBe("Hello\n");
  });
});
