import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type AgentJob, agentKinds } from "@/modules/ai/domain";
import { requireIdentity } from "@/modules/identity/session";

export async function GET(request: NextRequest) {
  const identity = await requireIdentity();
  const id = z.uuid().safeParse(request.nextUrl.searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "Invalid workpaper." }, { status: 400 });
  const client = await createClient();
  const result = await client
    .from("ca_agent_jobs")
    .select("*")
    .eq("id", id.data)
    .eq("organization_id", identity.organizationId)
    .single();
  if (result.error || !result.data) return NextResponse.json({ error: "Workpaper unavailable." }, { status: 404 });
  const job = result.data as AgentJob;
  const lines = [
    "PSB & Associates LLP - CA workpaper",
    job.title,
    `Specialist: ${agentKinds[job.kind].title}`,
    `State: ${job.state}`,
    `Jurisdiction: ${job.jurisdiction}`,
    `Period: ${job.period}`,
    `Prepared with: ${job.model ?? "Not generated"}`,
    "",
    "BRIEF",
    job.brief,
  ];
  if (job.output) {
    lines.push("", "DRAFT SUMMARY", job.output.summary, "", "FINDINGS");
    for (const finding of job.output.findings)
      lines.push(`- ${finding.text}`, `  References: ${finding.sourceIds.join(", ")}`);
    lines.push(
      "",
      "MISSING INFORMATION",
      ...job.output.missingInformation.map((item) => `- ${item}`),
      "",
      "NEXT ACTIONS",
      ...job.output.nextActions.map((item) => `- ${item}`),
      "",
      "REVIEW NOTES",
      job.output.reviewNotes,
    );
  }
  if (job.review_note) lines.push("", "HUMAN REVIEW", job.review_note);
  for (const source of job.sources)
    lines.push("", `SOURCE ${source.id}: ${source.title}`, source.content, source.url ?? "");
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="ca-workpaper-${job.id}.txt"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
