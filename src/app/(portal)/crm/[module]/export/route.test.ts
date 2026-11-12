import { beforeEach, expect, it, vi } from "vitest";
import { crmModules } from "@/modules/crm/config";

const mocks = vi.hoisted(() => ({ role: "employee", client: vi.fn() }));
vi.mock("@/modules/identity/session", () => ({ requireIdentity: async () => ({ role: mocks.role }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));

import { GET } from "./route";

beforeEach(() => {
  mocks.client.mockReset();
});

it.each(["employee", "manager"])("blocks %s exports for every CRM module before querying data", async (role) => {
  mocks.role = role;
  for (const module of Object.keys(crmModules)) {
    const response = await GET(new Request(`https://example.invalid/crm/${module}/export`), {
      params: Promise.resolve({ module }),
    });
    expect(response.status).toBe(403);
  }
  expect(mocks.client).not.toHaveBeenCalled();
});
