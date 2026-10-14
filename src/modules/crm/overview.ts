import type { SupabaseClient } from "@supabase/supabase-js";

export const overviewMetrics = [
  { key: "clients", label: "Active clients", statuses: ["active"], hint: "Relationships in progress" },
  {
    key: "documents",
    label: "Documents needed",
    statuses: ["requested", "rejected"],
    hint: "Awaiting client submission",
  },
  {
    key: "compliance",
    label: "Open compliance",
    statuses: ["pending", "in_progress", "blocked"],
    hint: "Not yet filed",
  },
  { key: "tasks", label: "Open tasks", statuses: ["todo", "in_progress", "blocked"], hint: "Work still to complete" },
] as const;
export type OverviewMetric = (typeof overviewMetrics)[number] & { count: number | null };
export type OverviewDeadline = { id: string; title: string; due_date: string; status: string };
export type CrmOverview = { metrics: OverviewMetric[]; deadlines: OverviewDeadline[] | null };

// Use the caller's authenticated client (RLS), never a service-role client.
// Count-only responses and six rows keep dashboard memory independent of record volume.
export async function loadCrmOverview(client: SupabaseClient, organizationId: string): Promise<CrmOverview> {
  const [metrics, deadlines] = await Promise.all([
    Promise.all(
      overviewMetrics.map(async (metric) => {
        const { count, error } = await client
          .from(`crm_${metric.key}`)
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .in("status", [...metric.statuses]);
        return { ...metric, count: error ? null : count };
      }),
    ),
    client
      .from("crm_compliance")
      .select("id,title,due_date,status")
      .eq("organization_id", organizationId)
      .neq("status", "filed")
      .not("due_date", "is", null)
      .order("due_date")
      .order("id")
      .limit(6),
  ]);
  return { metrics, deadlines: deadlines.error ? null : (deadlines.data as OverviewDeadline[]) };
}
