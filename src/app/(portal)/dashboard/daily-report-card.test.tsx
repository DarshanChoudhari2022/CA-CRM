// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ punch: vi.fn(), refresh: vi.fn(), location: vi.fn() }));
vi.mock("@/modules/attendance/location", () => ({ capturePunchLocation: mocks.location }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("./report-actions", () => ({ saveDailyReport: vi.fn() }));
vi.mock("../attendance/actions", () => ({ punch: mocks.punch }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { PunchButton } from "../attendance/punch-button";
import { ShiftDuration } from "../attendance/shift-duration";
import { DailyReportCard } from "./daily-report-card";

it("keeps tasks/photos optional and checkout independent; displays checkout time", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mocks.punch.mockResolvedValue({ success: "Check-out saved. Time worked today: 7h 30m." });
  mocks.location.mockResolvedValue({
    latitude: 19.88,
    longitude: 75.34,
    accuracy: 20,
    capturedAt: new Date().toISOString(),
  });
  try {
    await act(async () =>
      root.render(
        <>
          <PunchButton canCheckIn={false} canCheckOut />
          <DailyReportCard report={{ workDate: "2026-10-12", canEdit: true, summary: "", photos: [] }} />
        </>,
      ),
    );
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="summary"]')?.required).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[name="photo"]')?.required).toBe(false);
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Check out now"),
    );
    expect(button?.disabled).toBe(false);
    expect(button?.closest("form")).toBeNull();
    await act(async () => button?.click());
    expect(mocks.punch).toHaveBeenCalledWith(
      "check_out",
      expect.any(String),
      expect.objectContaining({ latitude: 19.88, longitude: 75.34 }),
    );
    expect(container.textContent).toContain("Time worked today: 7h 30m");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
it("shows the saved duration after a shift ends without running a client clock", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ShiftDuration
          checkIn="2026-10-12T04:30:00Z"
          checkOut="2026-10-12T12:00:00Z"
          serverNow="2026-10-12T16:00:00Z"
          durationMinutes={450}
        />,
      ),
    );
    expect(container.textContent).toContain("Time worked today");
    expect(container.textContent).toContain("7h 30m");
  } finally {
    await act(async () => root.unmount());
  }
});

it("does not save a punch when location permission fails and lets the employee retry", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  mocks.punch.mockClear();
  mocks.location.mockRejectedValue(new Error("Allow location access in your browser settings, then try again."));
  try {
    await act(async () => root.render(<PunchButton canCheckIn canCheckOut={false} />));
    await act(async () => container.querySelector("button")?.click());
    expect(mocks.punch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Allow location access");
    expect(container.querySelector("button")?.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
