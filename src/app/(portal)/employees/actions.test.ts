import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "admin", rpc: vi.fn() }));
vi.mock("@/modules/identity/session", () => ({ requireIdentity: async () => ({ role: state.role }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateEmployeeAccess, updateEmployeeManager } from "./actions";

const employee = "11111111-1111-4111-8111-111111111111";
const manager = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  state.role = "admin";
  state.rpc.mockReset().mockResolvedValue({ error: null });
});
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
it("prevents employees calling either administration action directly", async () => {
  state.role = "employee";
  expect((await updateEmployeeAccess({}, form({ employee, role: "admin", status: "active" }))).error).toBeTruthy();
  expect((await updateEmployeeManager({}, form({ employee, manager }))).error).toBeTruthy();
  expect(state.rpc).not.toHaveBeenCalled();
});
it("saves reporting manager independently of role and status", async () => {
  expect((await updateEmployeeManager({}, form({ employee, manager }))).success).toBeTruthy();
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("admin_employee_manager", {
    p_employee: employee,
    p_manager: manager,
  });
});
it("clears reporting manager without accepting arbitrary identifiers", async () => {
  expect((await updateEmployeeManager({}, form({ employee, manager: "" }))).success).toBeTruthy();
  expect(state.rpc).toHaveBeenCalledWith("admin_employee_manager", { p_employee: employee, p_manager: null });
  state.rpc.mockClear();
  expect((await updateEmployeeManager({}, form({ employee, manager: "invalid" }))).error).toBeTruthy();
  expect(state.rpc).not.toHaveBeenCalled();
});
it("allows an administrator to select Employee for another account", async () => {
  expect((await updateEmployeeAccess({}, form({ employee, role: "employee", status: "active" }))).success).toBeTruthy();
  expect(state.rpc).toHaveBeenCalledWith("admin_employee_access", {
    p_employee: employee,
    p_role: "employee",
    p_active: true,
  });
});
