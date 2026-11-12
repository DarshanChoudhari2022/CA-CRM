import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock("@/modules/identity/session", () => ({ requireIdentity: mocks.identity }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

import ModulesPage from "./page";

afterEach(() => vi.resetAllMocks());
it.each(["employee", "manager"])("sends %s directly to Attendance without rendering a CRM card", async (role) => {
  mocks.identity.mockResolvedValue({ role });
  await expect(Promise.resolve().then(() => ModulesPage())).rejects.toThrow("redirect:/dashboard");
});
it.each(["admin", "partner"])("keeps both workspaces available to %s", async (role) => {
  mocks.identity.mockResolvedValue({ role });
  const html = renderToStaticMarkup(await ModulesPage());
  expect(html).toContain('href="/crm"');
  expect(html).toContain('href="/dashboard"');
});
