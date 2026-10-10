export type AttendanceResult = "full_day" | "half_day" | "short_day" | "absent" | "excused" | "not_applicable";

export type DayContext = "working_day" | "holiday" | "weekly_off" | "outside_employment";

export interface AttendancePolicy {
  shiftStartMinutes: number;
  shiftEndMinutes: number;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
}

export interface AttendanceEvaluation {
  result: AttendanceResult;
  durationMinutes: number | null;
  isLate: boolean;
  isEarlyDeparture: boolean;
  isIncomplete: boolean;
}

export function evaluateAttendance(input: {
  context: DayContext;
  checkInMinutes?: number | null;
  checkOutMinutes?: number | null;
  policy: AttendancePolicy;
  excused?: boolean;
}): AttendanceEvaluation {
  const { context, checkInMinutes, checkOutMinutes, policy, excused } = input;

  if (context === "outside_employment") {
    return empty("not_applicable");
  }

  if (excused) return empty("excused");

  if (checkInMinutes == null && checkOutMinutes == null) {
    return empty(context === "working_day" ? "absent" : "not_applicable");
  }

  if (checkInMinutes == null || checkOutMinutes == null) {
    return { ...empty(context === "working_day" ? "absent" : "not_applicable"), isIncomplete: true };
  }

  if (checkOutMinutes <= checkInMinutes) throw new Error("Check-out must be after check-in on the same day.");

  const durationMinutes = checkOutMinutes - checkInMinutes;
  const result =
    context !== "working_day"
      ? "not_applicable"
      : durationMinutes >= policy.fullDayMinutes
        ? "full_day"
        : durationMinutes >= policy.halfDayMinutes
          ? "half_day"
          : "short_day";

  return {
    result,
    durationMinutes,
    isLate: context === "working_day" && checkInMinutes > policy.shiftStartMinutes + policy.graceMinutes,
    isEarlyDeparture: context === "working_day" && checkOutMinutes < policy.shiftEndMinutes,
    isIncomplete: false,
  };
}

function empty(result: AttendanceResult): AttendanceEvaluation {
  return { result, durationMinutes: null, isLate: false, isEarlyDeparture: false, isIncomplete: false };
}
