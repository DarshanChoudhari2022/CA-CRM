"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { recordBulkAttendance } from "../actions";
import styles from "./calendar.module.css";

export type CalendarDay = { date: string; label: string; tone: "present" | "absent" | "neutral"; editable: boolean };

export function AttendanceCalendar({
  days,
  offset,
  month,
  employee,
  employeeCode,
  selected,
}: {
  days: CalendarDay[];
  offset: number;
  month: string;
  employee: string;
  employeeCode: string;
  selected?: string;
}) {
  const [state, action, pending] = useActionState(recordBulkAttendance, {});
  const [checked, setChecked] = useState<string[]>([]);
  const eligibleDates = days.filter((day) => day.editable).map((day) => day.date);
  const selectedDates = eligibleDates.filter((date) => checked.includes(date));
  return (
    <form action={action} id="bulk-attendance">
      <input type="hidden" name="employee" value={employee} />
      {eligibleDates.length > 0 && (
        <div className="filters section-title">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending || selectedDates.length === eligibleDates.length}
            onClick={() => setChecked(eligibleDates)}
          >
            Select all missed dates ({eligibleDates.length})
          </button>
          {selectedDates.length > 0 && (
            <button type="button" className="button button-secondary" disabled={pending} onClick={() => setChecked([])}>
              Clear selection
            </button>
          )}
        </div>
      )}
      <div className={styles.calendar}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((weekday) => (
          <span className={styles.weekday} key={weekday}>
            {weekday}
          </span>
        ))}
        {days.map((day, index) => (
          <div
            className={`${styles.day} ${styles[day.tone]}`}
            key={day.date}
            style={index === 0 ? { gridColumnStart: offset + 1 } : undefined}
          >
            <Link
              href={`?${new URLSearchParams({ month, employee: employeeCode, date: day.date })}#day-detail`}
              aria-current={selected === day.date ? "date" : undefined}
            >
              <strong>{Number(day.date.slice(-2))}</strong>
              <span>{day.label}</span>
            </Link>
            {day.editable && (
              <input
                type="checkbox"
                name="dates"
                value={day.date}
                aria-label={`Select ${day.date} for bulk attendance`}
                checked={selectedDates.includes(day.date)}
                disabled={pending}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked;
                  setChecked((current) =>
                    enabled ? [...current, day.date] : current.filter((date) => date !== day.date),
                  );
                }}
              />
            )}
          </div>
        ))}
      </div>
      {selectedDates.length > 0 && (
        <div className="section">
          <h3>Mark {selectedDates.length} selected dates</h3>
          <p>Enter actual times shared by all selected dates. Open a date to enter different times.</p>
          <div className="grid grid-2">
            <label className="field">
              Actual check-in
              <input type="time" name="checkIn" required />
            </label>
            <label className="field">
              Actual check-out
              <input type="time" name="checkOut" required />
            </label>
          </div>
          <label className="field">
            Reason
            <textarea name="reason" minLength={10} maxLength={500} required />
          </label>
          <button className="button button-primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save selected dates"}
          </button>
        </div>
      )}
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
    </form>
  );
}
