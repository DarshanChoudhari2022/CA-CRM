import { z } from "zod";
import type { PunchLocation } from "./location";
export const registerResults = [
  "not_started",
  "open",
  "incomplete",
  "full_day",
  "half_day",
  "short_day",
  "absent",
  "excused",
  "leave_approved",
  "half_day_leave_approved",
  "not_applicable",
] as const;
export const registerFilters = z.object({
  date: z.iso.date(),
  branch: z.union([z.uuid(), z.literal("")]).default(""),
  department: z.string().max(100).default(""),
  q: z.string().trim().max(100).default(""),
  result: z.union([z.enum(registerResults), z.literal("")]).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export type RegisterFilters = z.infer<typeof registerFilters>;
export type RegisterRow = {
  employee_id: string;
  employee_code: string;
  full_name: string;
  department: string;
  branch: string;
  context: string;
  check_in_at: string | null;
  check_out_at: string | null;
  duration_minutes: number | null;
  is_late: boolean;
  result: string;
  checkInLocation?: PunchLocation;
  checkOutLocation?: PunchLocation;
};
export type AttendanceRegister = { date: string; page: number; total: number; items: RegisterRow[] };
export function registerArgs(filters: RegisterFilters) {
  return {
    p_date: filters.date,
    p_branch: filters.branch || null,
    p_department: filters.department,
    p_search: filters.q,
    p_result: filters.result,
    p_page: filters.page,
  };
}
