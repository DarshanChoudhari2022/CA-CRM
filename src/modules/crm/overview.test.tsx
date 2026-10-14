import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CrmOverviewView } from "@/app/(portal)/crm/overview";
import { loadCrmOverview, overviewMetrics } from "./overview";

function fakeClient(fail: boolean) {
  const queries: Array<{
    table: string;
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
  }> = [];
  const client = {
    from: (table: string) => {
      const query = {
        table,
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        neq: vi.fn(() => query),
        not: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => query),
        // biome-ignore lint/suspicious/noThenProperty: Model the real PostgREST thenable interface.
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], count: 3, error: fail ? { message: "private details" } : null }).then(resolve),
      };
      queries.push(query);
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

describe("CRM overview read model", () => {
  it("scopes every read to the tenant, fetches counts without bodies and limits deadlines", async () => {
    const { client, queries } = fakeClient(false);
    const data = await loadCrmOverview(client, "tenant-a");
    expect(queries).toHaveLength(5);
    for (const query of queries) expect(query.eq).toHaveBeenCalledWith("organization_id", "tenant-a");
    for (const query of queries.slice(0, 4))
      expect(query.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(queries[4].limit).toHaveBeenCalledWith(6);
    expect(queries[1].in).toHaveBeenCalledWith("status", ["requested", "rejected"]);
    expect(data.metrics.map((metric) => metric.count)).toEqual([3, 3, 3, 3]);
  });
  it("does not show a failed query as a healthy zero or leak database errors", async () => {
    const { client } = fakeClient(true);
    const data = await loadCrmOverview(client, "tenant-a");
    expect(data.metrics.every((metric) => metric.count === null)).toBe(true);
    expect(data.deadlines).toBeNull();
    const html = renderToStaticMarkup(<CrmOverviewView data={data} admin={false} />);
    expect(html).toContain("Temporarily unavailable");
    expect(html).not.toContain("No open deadlines");
    expect(html).not.toContain("private details");
  });
  it("shows an honest empty state and hides administrator controls from employee UI", () => {
    const data = { metrics: overviewMetrics.map((metric) => ({ ...metric, count: 0 })), deadlines: [] };
    const employee = renderToStaticMarkup(<CrmOverviewView data={data} admin={false} />);
    const admin = renderToStaticMarkup(<CrmOverviewView data={data} admin />);
    expect(employee).toContain("No open deadlines");
    expect(employee).not.toContain("/crm/automation-center");
    expect(admin).toContain("/crm/automation-center");
    expect(employee).toContain("/crm/ai-team");
  });
});
