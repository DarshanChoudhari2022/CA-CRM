import { describe, expect, it } from "vitest";
import { locationIsFresh, punchLocationSchema } from "./location";

const location = { latitude: 19.88, longitude: 75.34, accuracy: 20, capturedAt: "2026-10-16T06:00:00.000Z" };
describe("attendance location validation", () => {
  it("accepts real coordinates and rejects malformed or out-of-range data", () => {
    expect(punchLocationSchema.safeParse(location).success).toBe(true);
    for (const invalid of [
      { ...location, latitude: 91 },
      { ...location, longitude: -181 },
      { ...location, accuracy: -1 },
      { ...location, latitude: Number.NaN },
      null,
    ])
      expect(punchLocationSchema.safeParse(invalid).success).toBe(false);
  });
  it("rejects stale or future timestamps", () => {
    const now = Date.parse(location.capturedAt);
    expect(locationIsFresh(location, now + 119_000)).toBe(true);
    expect(locationIsFresh(location, now + 121_000)).toBe(false);
    expect(locationIsFresh(location, now - 31_000)).toBe(false);
  });
});
