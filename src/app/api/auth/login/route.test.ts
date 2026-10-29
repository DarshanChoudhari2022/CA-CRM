import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), signOut: vi.fn(), signIn: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }),
  }),
}));

import { POST } from "./route";

beforeEach(() => {
  mocks.signIn.mockResolvedValue({ data: { user: { id: "fixture" } }, error: null });
});
afterEach(() => vi.resetAllMocks());
function request(audience = "crm") {
  return new NextRequest("https://crm.example.invalid/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@example.invalid", password: "test-fixture-only", audience }),
  });
}
it.each(["employee", "manager"])("refuses %s credentials at the CRM login", async (role) => {
  mocks.profile.mockResolvedValue({ data: { role, active: true } });
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain("administrators only");
  expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith();
});
it.each(["admin", "partner"])("lets %s open the CRM", async (role) => {
  mocks.profile.mockResolvedValue({ data: { role, active: true } });
  expect(await (await POST(request())).json()).toMatchObject({ success: true, redirectTo: "/crm" });
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it("keeps employee Attendance login working", async () => {
  mocks.profile.mockResolvedValue({ data: { role: "employee", active: true } });
  expect(await (await POST(request("employee"))).json()).toMatchObject({ success: true, redirectTo: "/dashboard" });
  expect(mocks.signOut).not.toHaveBeenCalled();
});
