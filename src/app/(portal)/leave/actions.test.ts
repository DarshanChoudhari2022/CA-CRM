import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/modules/identity/session", () => ({
  requireIdentity: async () => ({ organizationId: "firm", role: "employee" }),
}));
vi.mock("@/modules/leave/notifications", () => ({ prepareLeaveNotification: mocks.prepare }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { submitLeave } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: "request", error: null });
  mocks.prepare.mockResolvedValue({ id: "notice", lease: "lease", payload: { access_key: "test-key" } });
});
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    leaveTypeId: "11111111-1111-4111-8111-111111111111",
    startDate: "2026-10-19",
    endDate: "2026-10-20",
    portion: "full_day",
    reason: "Personal appointment",
  }))
    data.set(key, value);
  return data;
}
it("prepares office email only after the leave request is saved", async () => {
  const result = await submitLeave({}, form());
  expect(result.success).toBeTruthy();
  expect(result.notification?.id).toBe("notice");
  expect(mocks.prepare).toHaveBeenCalledWith("firm", "request");
  expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepare.mock.invocationCallOrder[0]);
});
it("never emails a rejected leave application", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "Overlapping leave" } });
  expect((await submitLeave({}, form())).error).toBe("Overlapping leave");
  expect(mocks.prepare).not.toHaveBeenCalled();
});
it("keeps leave saved when the email queue is unavailable", async () => {
  mocks.prepare.mockRejectedValue(new Error("Queue unavailable"));
  const result = await submitLeave({}, form());
  expect(result.success).toBeTruthy();
  expect(result.notification).toBeUndefined();
});
