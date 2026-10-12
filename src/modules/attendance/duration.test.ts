import { describe, expect, it } from "vitest";
import { validateWorkPhoto } from "./daily-report";
import { formatWorkedMinutes, runningWorkedMinutes } from "./duration";

describe("shift time and optional photos", () => {
  it.each([
    [0, "0h 0m"],
    [59, "0h 59m"],
    [60, "1h 0m"],
    [450, "7h 30m"],
    [-1, "0h 0m"],
  ])("formats %s minutes", (minutes, label) => expect(formatWorkedMinutes(Number(minutes))).toBe(label));
  it("uses server time and monotonic elapsed time, independent of phone clock", () => {
    expect(runningWorkedMinutes("2026-10-12T04:30:00Z", "2026-10-12T12:00:00Z", 60000)).toBe(451);
    expect(runningWorkedMinutes(null, "2026-10-12T12:00:00Z", 60000)).toBe(0);
    expect(runningWorkedMinutes("invalid", "invalid", 0)).toBe(0);
  });
  it("accepts only supported non-empty photos up to 5 MB", () => {
    expect(validateWorkPhoto({ type: "image/jpeg", size: 100 })).toBeNull();
    expect(validateWorkPhoto({ type: "image/png", size: 5242880 })).toBeNull();
    expect(validateWorkPhoto({ type: "image/png", size: 5242881 })).toContain("5 MB");
    expect(validateWorkPhoto({ type: "image/svg+xml", size: 100 })).toContain("JPEG");
    expect(validateWorkPhoto({ type: "image/png", size: 0 })).toContain("5 MB");
  });
});
