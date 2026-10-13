import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  identity: {
    userId: "actor",
    organizationId: "organization-a",
    employeeId: "employee-a",
    fullName: "Reviewer",
    role: "admin",
  },
  closed: true,
  missing: false,
  rpcError: null as { message: string } | null,
  queries: [] as Array<{ table: string; columns: string; filters: Record<string, unknown> }>,
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
const summary = (closed: boolean) => ({
  expectedDays: 25,
  fullDays: 20,
  halfDays: 1,
  shortDays: 2,
  absentDays: 1,
  leaveDays: 1,
  incompleteDays: 0,
  totalHours: "180h",
  isClosed: closed,
  blockers: 0,
});
const savedRow = {
  employeeCode: "SAVED",
  employeeName: "Saved employee",
  department: "Audit",
  workDate: "2026-09-01",
  context: "working_day",
  checkIn: null,
  checkOut: null,
  durationMinutes: null,
  result: "absent",
  late: false,
  earlyDeparture: false,
};

vi.mock("@/modules/identity/session", () => ({ requireIdentity: async () => fixture.identity }));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("./month-actions", () => ({
  MonthActions: ({ month, closed }: { month: string; closed: boolean }) => (
    <div data-month={month}>{closed ? "Reopen month" : "Close month"}</div>
  ),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: fixture.rpc,
    from: (table: string) => {
      const query = { table, columns: "", filters: {} as Record<string, unknown> };
      fixture.queries.push(query);
      const builder = {
        select: (columns: string) => {
          query.columns = columns;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          query.filters[column] = value;
          return builder;
        },
        order: async () => ({
          data: fixture.missing
            ? []
            : [
                { version: 3, generated_at: "2026-10-01T00:00:00Z" },
                { version: 1, generated_at: "2026-09-30T00:00:00Z" },
              ],
          error: null,
        }),
        single: async () =>
          table === "organizations"
            ? { data: { timezone: "Asia/Kolkata" }, error: null }
            : fixture.missing
              ? { data: null, error: { message: "private database details" } }
              : {
                  data: {
                    version: query.filters.version,
                    generated_at: "2026-10-01T00:00:00Z",
                    summary: { ...summary(true), fullDays: 17 },
                    detail: [savedRow],
                  },
                  error: null,
                },
      };
      return builder;
    },
  }),
}));

import type { PortalIdentity } from "@/modules/identity/session";
import { closeMonth, reopenMonth } from "./actions";
import { loadReport } from "./data";
import { GET } from "./export/route";
import ReportsPage from "./page";

const identity = () => ({ ...fixture.identity, role: fixture.identity.role as PortalIdentity["role"] });
beforeEach(() => {
  fixture.identity.role = "admin";
  fixture.closed = true;
  fixture.missing = false;
  fixture.rpcError = null;
  fixture.queries = [];
  fixture.revalidate.mockReset();
  fixture.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "attendance_month_summary") return { data: summary(fixture.closed), error: null };
    if (name === "attendance_export_rows") return { data: [{ ...savedRow, employeeCode: "LIVE" }], error: null };
    return { data: null, error: fixture.rpcError };
  });
});
const form = (month = "2026-09", reason = "Correct missing attendance records") => {
  const data = new FormData();
  data.set("month", month);
  data.set("reason", reason);
  return data;
};
describe("month mutations", () => {
  it("rejects invalid months, future months and unauthorized callers before mutation", async () => {
    expect((await closeMonth({}, form("2026-13"))).error).toContain("valid month");
    expect((await closeMonth({}, form("9999-01"))).error).toContain("completed month");
    fixture.identity.role = "manager";
    expect((await reopenMonth({}, form())).error).toContain("Administrator");
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("requires a substantive reopen reason", async () => {
    expect((await reopenMonth({}, form("2026-09", "short"))).error).toContain("10–500");
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("surfaces blockers and does not report success or revalidate failed mutations", async () => {
    fixture.rpcError = { message: "INVALID_INPUT: Resolve 2 blocking records first." };
    const result = await closeMonth({}, form());
    expect(result.error).toContain("Approvals");
    expect(result.success).toBeUndefined();
    expect(fixture.revalidate).not.toHaveBeenCalled();
  });
  it("passes the trimmed reopen reason and refreshes affected views after confirmation", async () => {
    expect((await reopenMonth({}, form("2026-09", "  Correct missing records  "))).success).toContain("reopened");
    expect(fixture.rpc).toHaveBeenCalledWith(
      "reopen_attendance_month",
      expect.objectContaining({ p_month: "2026-09", p_reason: "Correct missing records" }),
    );
    expect(fixture.revalidate).toHaveBeenCalledWith("/reports");
    expect(fixture.revalidate).toHaveBeenCalledWith("/attendance");
  });
  it("sanitizes unexpected failures and preserves unknown-outcome guidance", async () => {
    fixture.rpc.mockRejectedValue(new Error("secret connection detail"));
    const result = await closeMonth({}, form());
    expect(result.error).toContain("check its status before retrying");
    expect(result.error).not.toContain("secret");
  });
});
describe("snapshot reporting and exports", () => {
  it("uses saved summary/detail for a closed month and scopes queries to the caller's organization", async () => {
    const report = await loadReport(identity(), "2026-09", null, true);
    expect(report.version).toBe(3);
    expect(report.report.fullDays).toBe(17);
    expect(report.rows).toEqual([savedRow]);
    expect(fixture.rpc).not.toHaveBeenCalledWith("attendance_export_rows", expect.anything());
    expect(
      fixture.queries
        .filter((q) => q.table === "attendance_report_snapshots")
        .every((q) => q.filters.organization_id === "organization-a"),
    ).toBe(true);
  });
  it("serves historical snapshots even after reopening and avoids fetching detail for the page", async () => {
    fixture.closed = false;
    const report = await loadReport(identity(), "2026-09", 1);
    expect(report.version).toBe(1);
    expect(report.live.isClosed).toBe(false);
    expect(fixture.queries.at(-1)?.columns).not.toContain("detail");
  });
  it("uses live export only for an open month without an explicit version", async () => {
    fixture.closed = false;
    const response = await GET(new NextRequest("https://example.invalid/reports/export?month=2026-09"));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Report-Version")).toBe("live");
    expect(await response.text()).toContain("LIVE");
  });
  it("pins saved content, timestamp and version in downloads", async () => {
    const response = await GET(new NextRequest("https://example.invalid/reports/export?month=2026-09&version=1"));
    expect(response.headers.get("Content-Disposition")).toContain("2026-09-v1.csv");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Report-Generated-At")).toBe("2026-10-01T00:00:00Z");
    const csv = await response.text();
    expect(csv).toContain("SAVED");
    expect(csv).not.toContain("LIVE");
  });
  it("fails closed when the snapshot is missing instead of returning live rows", async () => {
    fixture.missing = true;
    const response = await GET(new NextRequest("https://example.invalid/reports/export?month=2026-09"));
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("snapshot missing");
    expect(fixture.rpc).not.toHaveBeenCalledWith("attendance_export_rows", expect.anything());
  });
  it("rejects unavailable requested versions rather than falling back", async () => {
    fixture.closed = false;
    fixture.missing = true;
    const response = await GET(new NextRequest("https://example.invalid/reports/export?month=2026-09&version=1"));
    expect(response.status).toBe(404);
  });
  it("rejects unauthorized exports and malformed parameters", async () => {
    for (const query of ["month=2026-00", "month=2026-09&version=1junk"]) {
      expect((await GET(new NextRequest(`https://example.invalid/reports/export?${query}`))).status).toBe(400);
    }
    fixture.identity.role = "manager";
    expect((await GET(new NextRequest("https://example.invalid/reports/export?month=2026-09"))).status).toBe(403);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
describe("report page", () => {
  it("renders selected month, saved version selection and a pinned export link", async () => {
    const html = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ month: "2026-09" }) }));
    expect(html).toContain('type="month"');
    expect(html).toContain('value="2026-09"');
    expect(html).toContain('id="report-version"');
    expect(html).toContain("month=2026-09&amp;version=3");
    expect(html).toContain("Reopen month");
    expect(html).toContain("Short days");
  });
  it("renders invalid input errors without fetching a report", async () => {
    const html = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ month: "2026-13" }) }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Choose a valid month");
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("makes historical views read-only and hides unknown failure details", async () => {
    const html = renderToStaticMarkup(
      await ReportsPage({ searchParams: Promise.resolve({ month: "2026-09", version: "1" }) }),
    );
    expect(html).toContain("Viewing a saved version");
    expect(html).not.toContain("data-month=");
    fixture.rpc.mockRejectedValue(new Error("secret diagnostic"));
    const failed = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ month: "2026-09" }) }));
    expect(failed).toContain("Report data unavailable");
    expect(failed).not.toContain("secret");
  });
});
