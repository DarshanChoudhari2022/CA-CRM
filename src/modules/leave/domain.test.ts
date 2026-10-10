import { describe, expect, it } from "vitest";
import { leaveRequestSchema, requestedDays } from "./domain";

describe("leave module interface", () => {
  it("counts an inclusive full-day range", () => {
    expect(requestedDays({ startDate: "2026-10-10", endDate: "2026-10-12", portion: "full_day" })).toBe(3);
  });

  it("allows half-day leave for one date", () => {
    expect(requestedDays({ startDate: "2026-10-10", endDate: "2026-10-10", portion: "first_half" })).toBe(0.5);
  });

  it("rejects half-day ranges", () => {
    const parsed = leaveRequestSchema.safeParse({
      leaveTypeId: "11111111-1111-4111-8111-111111111111",
      startDate: "2026-10-10",
      endDate: "2026-10-11",
      portion: "first_half",
      reason: "Personal appointment",
    });
    expect(parsed.success).toBe(false);
  });
});
