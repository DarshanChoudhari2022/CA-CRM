import { pollGmail } from "@/modules/crm/automation/gmail";
import { secretMatches } from "@/modules/crm/automation/security";
import { automationOrganization, automationStore } from "@/modules/crm/automation/store";
import { runAutomation } from "@/modules/crm/automation/worker";

export const maxDuration = 300;
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    !secretMatches(request.headers.get("authorization"), `Bearer ${process.env.CRON_SECRET}`)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  let runId: string | undefined;
  try {
    const { data, error } = await automationStore()
      .from("crm_automation_settings")
      .select("enabled")
      .eq("organization_id", automationOrganization())
      .maybeSingle();
    if (error) throw new Error("Settings unavailable");
    if (!data?.enabled) return Response.json({ paused: true });
    const run = await automationStore()
      .from("crm_automation_runs")
      .insert({ organization_id: automationOrganization() })
      .select("id")
      .single();
    if (run.error) throw new Error("Run could not be recorded");
    runId = run.data.id;
    let mailError = false;
    try {
      await pollGmail();
    } catch {
      mailError = true;
    }
    const result = await runAutomation();
    const saved = await automationStore()
      .from("crm_automation_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: mailError || result.failures ? "partial_failure" : "complete",
        summary: { ...result, mailError },
      })
      .eq("id", runId);
    if (saved.error) throw new Error("Run summary not saved");
    return Response.json({ ...result, mailError }, { status: mailError || result.failures ? 503 : 200 });
  } catch {
    if (runId)
      await automationStore()
        .from("crm_automation_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          summary: { error: "Worker failed; check configuration and queued jobs" },
        })
        .eq("id", runId);
    return Response.json({ error: "Automation run failed; inspect configuration and queue" }, { status: 503 });
  }
}
