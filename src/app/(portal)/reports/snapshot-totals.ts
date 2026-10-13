import { z } from "zod";
import type { EmployeeTotal } from "./employee-totals";

const savedRow = z.object({
  employeeCode: z.string(),
  employeeName: z.string(),
  department: z.string(),
  context: z.string(),
  checkIn: z.string().nullable(),
  checkOut: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  result: z.string().nullable(),
  leaveDays: z.number().optional(),
});
export function snapshotEmployeeTotals(detail: unknown): EmployeeTotal[] {
  const groups = new Map<string, EmployeeTotal>();
  for (const row of z.array(savedRow).parse(detail)) {
    const total = groups.get(row.employeeCode) ?? {
      employee_code: row.employeeCode,
      employee_name: row.employeeName,
      department: row.department,
      expectedDays: 0,
      presentDays: 0,
      leaveDays: 0,
      absentDays: 0,
      incompleteDays: 0,
      durationMinutes: 0,
    };
    if (row.context === "working_day") total.expectedDays++;
    if (row.checkIn) total.presentDays++;
    if (row.checkIn && !row.checkOut) total.incompleteDays++;
    if (row.result === "absent") total.absentDays++;
    if (row.result === "half_day_leave_approved" && !row.checkIn) total.absentDays += 0.5;
    total.durationMinutes += row.durationMinutes ?? 0;
    total.leaveDays = row.leaveDays === undefined || total.leaveDays === null ? null : total.leaveDays + row.leaveDays;
    groups.set(row.employeeCode, total);
  }
  return [...groups.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}
