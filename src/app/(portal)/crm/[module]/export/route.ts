import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crmModules, isCrmModule } from "@/modules/crm/config";
import { canUseCrmModule } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";

export async function GET(request: Request, { params }: { params: Promise<{ module: string }> }) {
  const identity = await requireIdentity();
  const { module } = await params;
  if (!isCrmModule(module)) return new NextResponse("Unknown module", { status: 404 });
  if (!canUseCrmModule(identity.role, module))
    return new NextResponse("Administrator access required", { status: 403 });
  const filters = new URL(request.url).searchParams;
  const client = await createClient();
  const data: Array<{ title: string; status: string; created_at: string }> = [];
  for (let offset = 0; offset <= 10000; offset += 1000) {
    let query = client
      .from(`crm_${module}`)
      .select("title,status,created_at")
      .order("created_at")
      .order("id")
      .range(offset, offset + 999);
    const status = filters.get("status");
    if (status && crmModules[module].statuses.some((s) => s === status)) query = query.eq("status", status);
    const search = filters.get("q");
    if (search) query = query.ilike("title", `%${search.replace(/[%_]/g, "").slice(0, 100)}%`);
    const result = await query;
    if (result.error) return new NextResponse("Export unavailable", { status: 500 });
    data.push(...(result.data ?? []));
    if (data.length > 10000)
      return new NextResponse("Export limit is 10,000 records. Narrow your search.", { status: 413 });
    if ((result.data?.length ?? 0) < 1000) break;
  }
  const cell = (value: unknown) =>
    `"${String(value ?? "")
      .replace(/^\s*[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const csv = [
    "Name,Status,Created",
    ...(data ?? []).map((r) => [r.title, r.status, r.created_at].map(cell).join(",")),
  ].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${module}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
