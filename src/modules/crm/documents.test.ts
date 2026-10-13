import { describe, expect, it } from "vitest";
import { documentType } from "./documents";

describe("document admission", () => {
  it("accepts supported extensions regardless of extension case", () => {
    expect(documentType("report.PDF", 10485760)).toBe("application/pdf");
    expect(documentType("evidence.docx", 200)).toContain("wordprocessingml");
  });
  it("rejects empty, oversized and unsupported uploads", () => {
    for (const [name, size] of [
      ["empty.pdf", 0],
      ["huge.pdf", 10485761],
      ["script.svg", 100],
      ["program.exe", 1],
    ] as const)
      expect(() => documentType(name, size)).toThrow();
  });
});
