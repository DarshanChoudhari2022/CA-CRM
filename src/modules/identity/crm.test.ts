import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock("./session", () => ({ requireIdentity: mocks.identity }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

import { requireCrmIdentity } from "./crm";

afterEach(() => vi.resetAllMocks());
it.each(["employee", "manager"])("blocks %s at the CRM server boundary", async (role) => {
  mocks.identity.mockResolvedValue({ role });
  await expect(requireCrmIdentity()).rejects.toThrow("redirect:/dashboard");
});
it.each(["admin", "partner"])("permits the Administrator role %s", async (role) => {
  const identity = { role, userId: "admin-fixture" };
  mocks.identity.mockResolvedValue(identity);
  expect(await requireCrmIdentity()).toBe(identity);
});
it("immediately blocks a previously permitted account after its role changes", async () => {
  mocks.identity.mockResolvedValueOnce({ role: "admin" }).mockResolvedValueOnce({ role: "employee" });
  expect((await requireCrmIdentity()).role).toBe("admin");
  await expect(requireCrmIdentity()).rejects.toThrow("redirect:/dashboard");
});
