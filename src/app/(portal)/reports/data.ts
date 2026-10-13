import { createClient } from "@/lib/supabase/server";
import type { PortalIdentity } from "@/modules/identity/session";
import type { EmployeeTotal } from "./employee-totals";
import { ReportReadError, summarySchema } from "./report";
import { snapshotEmployeeTotals } from "./snapshot-totals";

export async function reportTimezone(identity: PortalIdentity) {
  const { data, error } = await (await createClient())
    .from("organizations")
    .select("timezone")
    .eq("id", identity.organizationId)
    .single();
  if (error || !data?.timezone)
    throw new ReportReadError("Organization timezone unavailable. Refresh or contact your administrator.");
  return String(data.timezone);
}
export async function loadReport(
  identity: PortalIdentity,
  month: string,
  version: number | null,
  includeDetail = false,
  includeEmployeeTotals = false,
) {
  if (!["admin", "partner"].includes(identity.role))
    throw new ReportReadError("Administrator access is required.", 403);
  const client = await createClient();
  const [current, versions] = await Promise.all([
    client.rpc("attendance_month_summary", { p_month: month }),
    client
      .from("attendance_report_snapshots")
      .select("version,generated_at")
      .eq("organization_id", identity.organizationId)
      .eq("month_start", `${month}-01`)
      .order("version", { ascending: false }),
  ]);
  if (current.error || versions.error)
    throw new ReportReadError("Reports unavailable. Refresh or contact your administrator.");
  const live = summarySchema.parse(current.data);
  const history = (versions.data ?? []) as Array<{ version: number; generated_at: string }>;
  const selected = version ?? (live.isClosed ? history[0]?.version : null);
  if (live.isClosed && selected == null)
    throw new ReportReadError(
      "Closed-month snapshot missing. Contact your administrator; live data cannot replace the saved report.",
      409,
    );
  if (selected != null) {
    const { data, error } = await client
      .from("attendance_report_snapshots")
      .select(
        includeDetail || includeEmployeeTotals ? "version,generated_at,summary,detail" : "version,generated_at,summary",
      )
      .eq("organization_id", identity.organizationId)
      .eq("month_start", `${month}-01`)
      .eq("version", selected)
      .single();
    if (error || !data)
      throw new ReportReadError(
        "Saved report version unavailable. Choose an available version or contact your administrator.",
        404,
      );
    const snapshot = data as unknown as { version: number; generated_at: string; summary: unknown; detail?: unknown };
    return {
      live,
      report: summarySchema.parse(snapshot.summary),
      history,
      version: snapshot.version,
      generatedAt: snapshot.generated_at,
      rows: snapshot.detail,
      employees: includeEmployeeTotals ? snapshotEmployeeTotals(snapshot.detail) : [],
    };
  }
  let rows: unknown;
  if (includeDetail) {
    const result = await client.rpc("attendance_export_rows", { p_month: month });
    if (result.error) throw new ReportReadError("Live export unavailable. Refresh or contact your administrator.");
    rows = result.data;
  }
  let employees: EmployeeTotal[] = [];
  if (includeEmployeeTotals) {
    const totals = await client.rpc("attendance_month_employee_totals", { p_month: month });
    if (totals.error) throw new ReportReadError("Employee monthly totals unavailable. Refresh and retry.");
    employees = totals.data as EmployeeTotal[];
  }
  return {
    live,
    report: live,
    history,
    version: null,
    generatedAt: new Date().toISOString(),
    rows,
    employees,
  };
}
