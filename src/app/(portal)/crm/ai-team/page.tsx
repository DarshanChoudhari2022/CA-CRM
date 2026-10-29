import Link from "next/link";
import { z } from "zod";
import { PageHead } from "@/components/page-head";
import { createClient } from "@/lib/supabase/server";
import { type AgentJob, agentKinds } from "@/modules/ai/domain";
import { integrationStatus } from "@/modules/crm/providers";
import { requireCrmIdentity as requireIdentity } from "@/modules/identity/crm";
import { BriefForm, PrepareForm, ReferenceForm, ReferenceReview, ReviewForm } from "./forms";

export default async function AiTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ workpaper?: string; page?: string }>;
}) {
  const filters = await searchParams;
  const selectedId = z.uuid().safeParse(filters.workpaper);
  const page = Math.max(1, Math.min(10000, Number.parseInt(filters.page ?? "1", 10) || 1));
  const identity = await requireIdentity();
  const client = await createClient();
  const admin = ["admin", "partner"].includes(identity.role);
  const [jobs, clients, knowledge, selected] = await Promise.all([
    client
      .from("ca_agent_jobs")
      .select(
        "id,kind,title,jurisdiction,period,client_id,state,model,error_message,review_note,created_at,updated_at,attempts",
      )
      .eq("organization_id", identity.organizationId)
      .order("created_at", { ascending: false })
      .range((page - 1) * 50, page * 50 - 1),
    client
      .from("crm_clients")
      .select("id,title")
      .eq("organization_id", identity.organizationId)
      .eq("status", "active")
      .order("title")
      .limit(200),
    client
      .from("ca_knowledge")
      .select("id,title,content,source_url,jurisdiction,valid_until,state")
      .eq("organization_id", identity.organizationId)
      .order("created_at", { ascending: false })
      .limit(10),
    selectedId.success
      ? client
          .from("ca_agent_jobs")
          .select("*")
          .eq("organization_id", identity.organizationId)
          .eq("id", selectedId.data)
          .maybeSingle()
      : null,
  ]);
  if (jobs.error || clients.error || knowledge.error) throw new Error("CA workpapers unavailable. Please try again.");
  const ready = integrationStatus().Groq;
  const selectedJob = selected?.data;
  const workpapers = (jobs.data ?? []).map((job) =>
    selectedJob && selectedJob.id === job.id ? selectedJob : { ...job, brief: "", output: null, sources: [] },
  ) as AgentJob[];
  if (selected?.data && !workpapers.some((job) => job.id === selected.data.id))
    workpapers.unshift(selected.data as AgentJob);
  return (
    <>
      <PageHead eyebrow="CA CRM" title="CA AI team" description="Prepare, review and track your firm's workpapers." />
      <section className="grid grid-3">
        {Object.entries(agentKinds).map(([kind, agent]) => (
          <article className="card ai-specialist" key={kind}>
            <h2>{agent.title}</h2>
            <p>{agent.purpose}</p>
          </article>
        ))}
      </section>
      <section className="card section">
        <h2>New workpaper</h2>
        <p>Save the requirements, prepare a draft, then review it before use.</p>
        {!ready && (
          <p className="ai-notice">
            AI generation is awaiting Groq configuration. You can save workpapers and review reference material now.
          </p>
        )}
        <BriefForm clients={clients.data ?? []} />
      </section>
      <section className="section">
        <h2>Recent workpapers</h2>
        <p className="stat-note">
          Page {page}. Open a workpaper to view its draft and evidence. Approval records a human review; it does not
          file returns, send messages or update financial records.
        </p>
        <div className="ai-job-list">
          {workpapers.map((job) => (
            <article className="card" key={job.id}>
              <div className="ai-job-heading">
                <div>
                  <span className="eyebrow">{agentKinds[job.kind].title}</span>
                  <h2>{job.title}</h2>
                </div>
                <span className={`status ${job.state === "approved" ? "status-green" : "status-blue"}`}>
                  {job.state.replaceAll("_", " ")}
                </span>
              </div>
              <p className="stat-note">
                {job.jurisdiction} · {job.period} ·{" "}
                {new Date(job.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
              </p>
              {selected?.data?.id !== job.id && (
                <Link className="button button-secondary" href={`/crm/ai-team?workpaper=${job.id}&page=${page}`}>
                  Open workpaper
                </Link>
              )}
              {job.brief && (
                <details>
                  <summary>View brief</summary>
                  <p className="ai-text">{job.brief}</p>
                </details>
              )}
              <a className="button button-secondary" href={`/crm/ai-team/export?id=${job.id}`}>
                Download workpaper
              </a>
              {job.error_message && (
                <p role="status" className="form-error">
                  {job.error_message}
                </p>
              )}
              {job.brief &&
                job.created_by === identity.userId &&
                ["draft", "failed", "running"].includes(job.state) && <PrepareForm id={job.id} ready={ready} />}
              {job.state === "running" && (
                <p className="stat-note">Draft in progress. If interrupted, retry after five minutes.</p>
              )}
              {job.output && (
                <div className="section ai-output">
                  <h3>Draft summary</h3>
                  <p className="ai-text">{job.output.summary}</p>
                  <h3>Findings</h3>
                  {Array.from(new Map(job.output.findings.map((finding) => [finding.text, finding])).values()).map(
                    (finding) => (
                      <div className="ai-finding" key={finding.text}>
                        <p>{finding.text}</p>
                        <small>
                          {finding.sourceIds
                            .map((id) => job.sources.find((source) => source.id === id)?.title ?? id)
                            .join(" · ") || "Requires supporting evidence"}
                        </small>
                      </div>
                    ),
                  )}
                  <h3>Missing information</h3>
                  <ul>
                    {Array.from(new Set(job.output.missingInformation)).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <h3>Next actions</h3>
                  <ul>
                    {Array.from(new Set(job.output.nextActions)).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <h3>Review notes</h3>
                  <p>{job.output.reviewNotes}</p>
                  <p className="stat-note">
                    Prepared using {job.model}. Review amounts, dates and conclusions against the original evidence.
                  </p>
                  <details>
                    <summary>Evidence snapshot ({job.sources.length} references)</summary>
                    {job.sources.map((source) => (
                      <article className="section" key={source.id}>
                        <strong>{source.title}</strong>
                        <p className="ai-text">{source.content}</p>
                        {source.url?.startsWith("https://") && (
                          <a href={source.url} target="_blank" rel="noopener noreferrer">
                            Open source
                          </a>
                        )}
                      </article>
                    ))}
                  </details>
                </div>
              )}
              {admin && job.output && job.state === "needs_review" && <ReviewForm id={job.id} />}
              {job.review_note && <p className="ai-notice">Review: {job.review_note}</p>}
            </article>
          ))}
          {!workpapers.length && <div className="card empty">Create your first workpaper to get started.</div>}
        </div>
        <div className="ai-actions section">
          {page > 1 && (
            <Link className="button button-secondary" href={`/crm/ai-team?page=${page - 1}`}>
              Previous
            </Link>
          )}
          {jobs.data?.length === 50 && (
            <Link className="button button-secondary" href={`/crm/ai-team?page=${page + 1}`}>
              Next
            </Link>
          )}
        </div>
      </section>
      <section className="card section">
        <h2>Reference library</h2>
        <p>
          AI drafts use approved, current references matching the workpaper jurisdiction. Review the source and extract
          before approving.
        </p>
        <p className="stat-note">
          Latest 10 accessible references. Draft generation can use up to 20 current approved references.
        </p>
        {admin && (
          <details>
            <summary>Add reference</summary>
            <ReferenceForm />
          </details>
        )}
        {(knowledge.data ?? []).map((reference) => (
          <article className="section" key={reference.id}>
            <h3>{reference.title}</h3>
            <p className="stat-note">
              {reference.jurisdiction} · {reference.state} · Review by {reference.valid_until}
            </p>
            <details>
              <summary>Read extract</summary>
              <p className="ai-text">{reference.content}</p>
              <a href={reference.source_url} rel="noopener noreferrer" target="_blank">
                Open source
              </a>
            </details>
            {admin && reference.state !== "retired" && (
              <ReferenceReview id={reference.id} approved={reference.state === "approved"} />
            )}
          </article>
        ))}
        {!knowledge.data?.length && <p className="stat-note">No reference material has been added yet.</p>}
      </section>
    </>
  );
}
