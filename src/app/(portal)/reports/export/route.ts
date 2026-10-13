import { type NextRequest, NextResponse } from "next/server";
import { requireIdentity } from "@/modules/identity/session";
import { loadReport, reportTimezone } from "../data";
import { attendanceCsv, monthSchema, parseVersion, ReportReadError } from "../report";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity();
  const failure = (error: string, status: number) =>
    NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (!["admin", "partner"].includes(identity.role))
    return failure("Administrator access is required for firm reports.", 403);
  const month = request.nextUrl.searchParams.get("month") ?? "";
  let version: number | null;
  try {
    if (!monthSchema.safeParse(month).success) return failure("Choose a valid month (YYYY-MM).", 400);
    version = parseVersion(request.nextUrl.searchParams.get("version"));
  } catch {
    return failure("Choose a valid report version.", 400);
  }
  try {
    const [report, timezone] = await Promise.all([
      loadReport(identity, month, version, true),
      reportTimezone(identity),
    ]);
    const csv = attendanceCsv(report.rows, {
      month,
      timezone,
      generatedAt: report.generatedAt,
      version: report.version,
    });
    const label = report.version == null ? "live" : `v${report.version}`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="psb-attendance-${month}-${label}.csv"`,
        "Cache-Control": "no-store",
        "X-Report-Version": String(report.version ?? "live"),
        "X-Report-Generated-At": report.generatedAt,
        "X-Report-Timezone": timezone,
      },
    });
  } catch (error) {
    if (error instanceof ReportReadError) return failure(error.message, error.status);
    return failure(
      "Report export unavailable. Refresh the report page and select an available version. Contact your administrator if a closed snapshot is missing.",
      503,
    );
  }
}
