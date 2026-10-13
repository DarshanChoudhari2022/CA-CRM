import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentJob, AgentSource } from "./domain";

export async function loadAgentSources(
  client: SupabaseClient,
  organizationId: string,
  job: AgentJob,
): Promise<AgentSource[]> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const knowledge = await client
    .from("ca_knowledge")
    .select("id,title,content,source_url,valid_until")
    .eq("organization_id", organizationId)
    .eq("state", "approved")
    .eq("jurisdiction", job.jurisdiction)
    .gte("valid_until", today)
    .order("reviewed_at", { ascending: false })
    .limit(20);
  if (knowledge.error) throw new Error("Approved references unavailable.");
  const sources: AgentSource[] = (knowledge.data ?? []).map((item) => ({
    id: `reference:${item.id}`,
    title: item.title,
    content: item.content.slice(0, 2500),
    url: item.source_url,
  }));
  if (!job.client_id) return fitContext(sources);
  const customer = await client
    .from("crm_clients")
    .select("id,title,status,notes")
    .eq("organization_id", organizationId)
    .eq("id", job.client_id)
    .single();
  if (customer.error || !customer.data) throw new Error("Client is no longer accessible.");
  sources.push({
    id: `client:${customer.data.id}`,
    title: customer.data.title,
    content: JSON.stringify({ ...customer.data, notes: customer.data.notes.slice(0, 2000) }),
  });
  const modules = ["compliance", "documents", "tasks", ...(job.kind === "finance" ? ["invoices"] : [])];
  const reads = await Promise.all(
    modules.map(async (module) => {
      const result = await client
        .from(`crm_${module}`)
        .select(module === "invoices" ? "id,title,status,notes,due_date,amount" : "id,title,status,notes,due_date")
        .eq("organization_id", organizationId)
        .eq("client_id", job.client_id)
        .order("created_at", { ascending: false })
        .limit(15)
        .returns<
          Array<{ id: string; title: string; status: string; notes: string; due_date: string | null; amount?: number }>
        >();
      if (result.error) throw new Error("Client context unavailable.");
      return { module, rows: result.data ?? [] };
    }),
  );
  for (const { module, rows } of reads) {
    for (const row of rows) {
      sources.push({
        id: `${module}:${row.id}`,
        title: row.title,
        content: JSON.stringify({ ...row, notes: row.notes?.slice(0, 400) }),
      });
    }
    if (module === "invoices" && rows.length) {
      const receipts = await client.rpc("crm_invoice_receipts", { p_ids: rows.map((row) => row.id) });
      if (receipts.error) throw new Error("Invoice receipts unavailable.");
      for (const receipt of receipts.data ?? []) {
        const invoice = sources.find((source) => source.id === `invoices:${receipt.invoice_id}`);
        if (invoice) invoice.content += ` Recorded receipts: ${receipt.received} INR.`;
      }
    }
  }
  // Tell the model exactly what the bounded snapshot includes; it is not the entire client history.
  sources.push({
    id: "snapshot-scope",
    title: "Context scope",
    content:
      "Latest 15 accessible records per selected module; up to 20 approved references for this exact jurisdiction. Document metadata only; uploaded files have not been read. Recorded due dates are maintained firm data, not independently verified statutory dates.",
  });
  return fitContext(sources);
}

function fitContext(sources: AgentSource[]): AgentSource[] {
  // Drop whole records instead of cutting a JSON fact (such as an invoice amount) in half.
  while (Buffer.byteLength(JSON.stringify(sources), "utf8") > 60_000 && sources.length > 1) sources.splice(0, 1);
  return sources;
}
