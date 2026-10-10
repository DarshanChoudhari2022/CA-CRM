import { describe, expect, it } from "vitest";
import { evaluateAttendance } from "./domain";

const policy = {
  shiftStartMinutes: 630,
  shiftEndMinutes: 1170,
  graceMinutes: 15,
  fullDayMinutes: 480,
  halfDayMinutes: 240,
};

describe("attendance module interface", () => {
  it.each([
    [630, 1110, "full_day"],
    [630, 870, "half_day"],
    [630, 869, "short_day"],
  ] as const)("classifies %s to %s as %s", (checkInMinutes, checkOutMinutes, result) => {
    expect(evaluateAttendance({ context: "working_day", checkInMinutes, checkOutMinutes, policy }).result).toBe(result);
  });

  it("treats exactly the grace boundary as on time", () => {
    expect(
      evaluateAttendance({ context: "working_day", checkInMinutes: 645, checkOutMinutes: 1140, policy }).isLate,
    ).toBe(false);
    expect(
      evaluateAttendance({ context: "working_day", checkInMinutes: 646, checkOutMinutes: 1140, policy }).isLate,
    ).toBe(true);
  });

  it("does not infer absence on a weekly off", () => {
    expect(evaluateAttendance({ context: "weekly_off", policy }).result).toBe("not_applicable");
  });

  it("marks a missing checkout as incomplete", () => {
    expect(evaluateAttendance({ context: "working_day", checkInMinutes: 630, policy }).isIncomplete).toBe(true);
  });
});
