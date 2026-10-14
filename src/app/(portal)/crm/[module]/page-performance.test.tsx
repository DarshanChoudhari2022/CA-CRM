import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/identity/session", () => ({
  requireIdentity: async () => ({ role: "admin", userId: "user", organizationId: "org" }),
}));
vi.mock("./actions", () => ({ saveRecord: vi.fn(), convertLead: vi.fn(), recordPayment: vi.fn() }));
vi.mock("../support-tools", () => ({ SupportTools: () => null }));
vi.mock("./document-upload", () => ({ DocumentUpload: () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const data =
        table === "crm_tasks"
          ? Array.from({ length: 50 }, (_, i) => ({
              id: `task-${i}`,
              title: `Task ${i}`,
              status: "todo",
              notes: "",
              owner_id: "person-0",
              client_id: "client-0",
            }))
          : table === "crm_clients"
            ? Array.from({ length: 1000 }, (_, i) => ({ id: `client-${i}`, title: `Client ${i}` }))
            : Array.from({ length: 100 }, (_, i) => ({ id: `person-${i}`, full_name: `Person ${i}` }));
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: () => query,
        // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are intentionally thenable.
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data, count: data.length, error: null }).then(resolve),
      };
      return query;
    },
  }),
}));

import CrmPage from "./page";

describe("CRM list initial render budget", () => {
  it("does not render thousands of select options inside closed record editors", async () => {
    const html = renderToStaticMarkup(
      await CrmPage({ params: Promise.resolve({ module: "tasks" }), searchParams: Promise.resolve({}) }),
    );
    const options = (html.match(/<option/g) ?? []).length;
    console.info(
      `CRM fixture: 50 records, 1,000 clients, 100 employees; HTML ${Buffer.byteLength(html)} bytes; ${options} options`,
    );
    expect(options).toBeLessThanOrEqual(5);
    expect(Buffer.byteLength(html)).toBeLessThan(100_000);
    expect(html).toContain("Task 49");
    expect(html).toContain("Client 0");
  });
});
