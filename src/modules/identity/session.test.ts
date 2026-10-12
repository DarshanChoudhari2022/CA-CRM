import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  single: vi.fn(),
  claims: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  rpc: vi.fn(),
  render: new Map(),
}));
// Model React's per-render cache lifecycle; reset between renders, not between callers.
vi.mock("react", () => ({
  cache: (loader: () => unknown) => () => {
    if (!mocks.render.has(loader)) mocks.render.set(loader, loader());
    return mocks.render.get(loader);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: mocks.claims }, from: mocks.from, rpc: mocks.rpc }),
}));

import { requireIdentity } from "./session";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.render.clear();
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "user-a" } } });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ eq: mocks.eq, single: mocks.single });
  mocks.single.mockResolvedValue({
    data: {
      user_id: "user-a",
      full_name: "A",
      role: "employee",
      organization_id: "org-a",
      employee_id: "employee-a",
      password_change_required: false,
    },
    error: null,
  });
});
describe("identity request cost and access", () => {
  it("shares one profile read between the layout and page in a render", async () => {
    const [layout, page] = await Promise.all([requireIdentity(), requireIdentity()]);
    expect(layout).toEqual(page);
    expect(mocks.single).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("active", true);
  });
  it("loads identity again for the next render rather than sharing across users", async () => {
    await requireIdentity();
    mocks.render.clear();
    await requireIdentity();
    expect(mocks.single).toHaveBeenCalledTimes(2);
  });
  it("rejects missing/inactive profiles", async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    await expect(requireIdentity()).rejects.toThrow("inactive");
  });
  it("enforces temporary password change", async () => {
    mocks.single.mockResolvedValue({ data: { password_change_required: true }, error: null });
    await expect(requireIdentity()).rejects.toThrow("/change-password");
  });
});
