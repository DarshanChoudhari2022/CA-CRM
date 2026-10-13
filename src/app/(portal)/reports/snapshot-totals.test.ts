import { expect, it } from "vitest";
import { snapshotEmployeeTotals } from "./snapshot-totals";

const row = {
  employeeCode: "E1",
  employeeName: "Employee",
  department: "Audit",
  context: "working_day",
  checkIn: null,
  checkOut: null,
  durationMinutes: null,
  result: "leave_approved",
};
it("retains explicit leave fractions from saved evidence", () => {
  const [total] = snapshotEmployeeTotals([
    { ...row, leaveDays: 1 },
    { ...row, result: "half_day_leave_approved", leaveDays: 0.5 },
  ]);
  expect(total.leaveDays).toBe(1.5);
  expect(total.absentDays).toBe(0.5);
  expect(total.expectedDays).toBe(2);
});
it("does not invent a leave breakdown for older excused snapshots", () => {
  expect(snapshotEmployeeTotals([{ ...row, result: "excused" }])[0].leaveDays).toBeNull();
});
