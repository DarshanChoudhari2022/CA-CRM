import { describe, expect, it } from "vitest";
import { attendanceCsv, localMonth, monthSchema, parseVersion, previousMonth, reportError } from "./report";

describe("report month boundaries", () => {
  it.each([
    ["2026-03-31T12:00:00Z", "2026-02"],
    ["2026-05-31T12:00:00Z", "2026-04"],
    ["2024-03-31T12:00:00Z", "2024-02"],
    ["2026-12-31T20:00:00Z", "2026-12"],
  ])("uses the previous local calendar month for %s", (now, expected) => {
    expect(previousMonth(new Date(now), "Asia/Kolkata")).toBe(expected);
  });
  it("uses organization timezone rather than server UTC", () => {
    expect(localMonth(new Date("2026-09-30T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10");
  });
  it.each(["2026-00", "2026-13", "0000-01", "2026-1", "bad"])("rejects invalid month %s", (value) => {
    expect(monthSchema.safeParse(value).success).toBe(false);
  });
  it("validates historical versions without silently choosing live data", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("3")).toBe(3);
    for (const value of ["0", "-1", "1.5", "2x", ["2"], "9007199254740992"])
      expect(() => parseVersion(value)).toThrow();
  });
});
describe("CSV evidence and safe errors", () => {
  it("preserves saved values, escapes quotes/formulas and includes snapshot metadata", () => {
    const csv = attendanceCsv(
      [
        {
          employeeCode: " =SUM(1,2)",
          employeeName: 'A "B"',
          department: "Audit",
          workDate: "2026-09-01",
          context: "working_day",
          checkIn: null,
          checkOut: null,
          durationMinutes: null,
          result: "absent",
          late: false,
          earlyDeparture: false,
        },
      ],
      { month: "2026-09", timezone: "Asia/Kolkata", generatedAt: "2026-10-01T00:00:00Z", version: 2 },
    );
    expect(csv).toContain('"\' =SUM(1,2)"');
    expect(csv).toContain('"A ""B"""');
    expect(csv).toContain('"Asia/Kolkata","2026-10-01T00:00:00Z","2"');
  });
  it("retains headers for an empty month and rejects malformed snapshot detail", () => {
    const metadata = { month: "2026-09", timezone: "Asia/Kolkata", generatedAt: "2026-10-01T00:00:00Z", version: null };
    expect(attendanceCsv([], metadata)).toContain('"Report version"');
    expect(() => attendanceCsv(null, metadata)).toThrow();
  });
  it("returns actionable blocker feedback without disclosing unknown database errors", () => {
    expect(reportError("INVALID_INPUT: Resolve 3 blocking records first.")).toContain("Approvals");
    expect(reportError("sensitive connection detail")).not.toContain("sensitive");
  });
});
