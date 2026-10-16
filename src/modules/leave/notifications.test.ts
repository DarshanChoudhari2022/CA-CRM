import { afterEach, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/modules/crm/automation/store", () => ({ automationStore: () => queue }));

import { prepareLeaveNotification } from "./notifications";

const notice = {
  id: "notice",
  lease: "lease",
  employee: "Demo Employee",
  email: "employee@example.invalid",
  leaveType: "Casual Leave",
  start: "2026-10-19",
  end: "2026-10-20",
  days: 2,
  reason: "Personal appointment",
  requestId: "request",
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("uses the website key and verified queue details to prepare the office notification", async () => {
  vi.stubEnv("WEB3FORMS_ACCESS_KEY", "website-key");
  vi.stubEnv("LEAVE_WEB3FORMS_ACCESS_KEY", "");
  queue.rpc.mockResolvedValue({ data: notice, error: null });
  const delivery = await prepareLeaveNotification("firm", "request");
  expect(queue.rpc).toHaveBeenCalledWith("claim_leave_email", { p_org: "firm", p_request: "request" });
  expect(delivery?.payload).toMatchObject({
    access_key: "website-key",
    replyto: notice.email,
    leave_type: "Casual Leave",
    start_date: notice.start,
    end_date: notice.end,
    working_days: "2",
    reason: notice.reason,
  });
  expect(delivery?.payload.subject).toBe("PSB leave application: Demo Employee");
});
it("does not duplicate a delivery already claimed by another browser or worker", async () => {
  vi.stubEnv("WEB3FORMS_ACCESS_KEY", "website-key");
  queue.rpc.mockResolvedValue({ data: null, error: null });
  expect(await prepareLeaveNotification("firm", "request")).toBeUndefined();
});
it("does not claim a notification before a key is configured", async () => {
  vi.stubEnv("WEB3FORMS_ACCESS_KEY", "");
  vi.stubEnv("LEAVE_WEB3FORMS_ACCESS_KEY", "");
  expect(await prepareLeaveNotification("firm", "request")).toBeUndefined();
  expect(queue.rpc).not.toHaveBeenCalled();
});
