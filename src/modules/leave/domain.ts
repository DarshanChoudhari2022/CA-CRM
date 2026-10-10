import { z } from "zod";

export const leaveRequestSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    portion: z.enum(["full_day", "first_half", "second_half"]),
    reason: z.string().trim().min(10).max(500),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  })
  .refine((value) => value.portion === "full_day" || value.startDate === value.endDate, {
    message: "Half-day leave can cover one date only.",
    path: ["portion"],
  });

export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

export function requestedDays(input: Pick<LeaveRequestInput, "startDate" | "endDate" | "portion">): number {
  if (input.portion !== "full_day") return 0.5;
  const start = Date.parse(`${input.startDate}T00:00:00Z`);
  const end = Date.parse(`${input.endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}
