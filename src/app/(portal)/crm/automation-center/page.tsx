import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { createClient } from "@/lib/supabase/server";
import { integrationStatus } from "@/modules/crm/providers";
import { requireIdentity } from "@/modules/identity/session";
import { configure } from "./actions";
import { CollectionForm } from "./collection-form";

export default async function AutomationCenter({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; page?: string; status?: string }>;
}) {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) redirect("/crm");
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const status = ["review", "queued", "uncertain", "accepted", "delivered", "read", "cancelled", "failed"].includes(
    params.status ?? "",
  )
    ? (params.status ?? "review")
    : "review";
  const db = await createClient();
  const [settings, inbox, dispatch, permissions, documents, runs] = await Promise.all([
    db
      .from("crm_automation_settings")
      .select("enabled,automatic_sends,automatic_ai,knowledge")
      .eq("organization_id", identity.organizationId)
      .maybeSingle(),
    db
      .from("crm_inbound")
      .select("id,channel,name,sender,body,status,classification,reply,created_at")
      .eq("organization_id", identity.organizationId)
      .order("created_at", { ascending: false })
      .limit(25),
    db
      .from("crm_dispatch")
      .select("id,channel,recipient,subject,body,status,source_module,error", { count: "exact" })
      .eq("organization_id", identity.organizationId)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .range((page - 1) * 25, page * 25 - 1),
    db
      .from("crm_channel_permissions")
      .select("channel,recipient,allowed")
      .eq("organization_id", identity.organizationId)
      .order("updated_at", { ascending: false })
      .limit(25),
    db
      .from("crm_documents")
      .select("id,title")
      .eq("organization_id", identity.organizationId)
      .in("status", ["requested", "rejected"])
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("crm_automation_runs")
      .select("id,started_at,status,summary")
      .eq("organization_id", identity.organizationId)
      .order("started_at", { ascending: false })
      .limit(10),
  ]);
  if ([settings, inbox, dispatch, permissions, documents, runs].some((r) => r.error))
    return (
      <>
        <PageHead
          eyebrow="CRM"
          title="Automation setup required"
          description="Apply the automation database migration before using this screen."
        />
        <Link href="/crm">Back to CRM</Link>
      </>
    );
  const providers = integrationStatus();
  return (
    <>
      <PageHead
        eyebrow="CA CRM"
        title="Automation control centre"
        description="Enquiries, document collection, compliance, leads and collections."
      />
      {params.message && <p role="status">{params.message.slice(0, 200)}</p>}
      <section className="card section">
        <h2>Worker health</h2>
        <p>
          Reminder windows: compliance 09:00, documents 09:30, leads 10:00, invoices 10:30 — workspace timezone. A
          recurring scheduler must call the secured worker to process the queue.
        </p>
        {runs.data?.map((r) => (
          <p key={r.id}>
            {new Date(r.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {r.status}
          </p>
        ))}
        {!runs.data?.length && (
          <p>No worker runs recorded. Configure the scheduler before expecting automatic sends.</p>
        )}
      </section>
      <section className="grid grid-3 workspace-cards">
        {[
          ["Client support", "support", "WhatsApp and email enquiries → AI drafts → reviewed replies"],
          ["Document collection", "documents", "Requested → received → reviewed / rejected"],
          ["Compliance", "compliance", "7 / 3 / 1 days, due date and overdue reminders"],
          ["Lead qualification", "leads", "Website, WhatsApp and email → qualification → follow-up"],
          ["Collections", "invoices", "Upcoming and overdue reminders; partial-payment tracking"],
        ].map(([title, path, description]) => (
          <Link className="card workspace-card" href={`/crm/${path}`} key={path}>
            <h2>{title}</h2>
            <p>{description}</p>
            <span>Manage →</span>
          </Link>
        ))}
      </section>
      <section className="card section">
        <h2>Collect client documents</h2>
        <p>Issue a private one-use upload link. Uploads appear in Documents for staff verification.</p>
        <CollectionForm documents={documents.data ?? []} />
      </section>
      <section className="card section">
        <h2>Activation & controls</h2>
        <p>
          {settings.data?.enabled ? "Enabled" : "Paused"} ·{" "}
          {settings.data?.automatic_sends ? "Automatic reminder sends" : "Review before sending"}
        </p>
        {Object.entries(providers).map(([name, ready]) => (
          <p key={name}>
            {name}: {ready ? "Credentials present; live connection not verified" : "Credentials required"}
          </p>
        ))}
        <p className="stat-note">
          Worker configuration:{" "}
          {process.env.CRON_SECRET && process.env.CRM_AUTOMATION_ORGANIZATION_ID ? "Present" : "Required"}. Gmail
          intake: {process.env.GMAIL_INTAKE_LABEL_ID ? "Label configured" : "Label required"}. WhatsApp verification:{" "}
          {process.env.WHATSAPP_PROVIDER === "authkey"
            ? "Authkey demo: reviewed outbound leave updates only; inbound and receipts pending"
            : process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
              ? "Configured"
              : "Required"}
          .
        </p>
        <form action={configure} className="section">
          <input type="hidden" name="kind" value="settings" />
          <p>
            <label>
              <input type="checkbox" name="enabled" defaultChecked={settings.data?.enabled} /> Enable intake and worker
            </label>
          </p>
          <p>
            <label>
              <input type="checkbox" name="automatic" defaultChecked={settings.data?.automatic_sends} /> Automatically
              send factual reminders to permitted recipients
            </label>
          </p>
          <label htmlFor="knowledge">Firm-approved support knowledge</label>
          <p>
            <label>
              <input type="checkbox" name="automatic_ai" defaultChecked={settings.data?.automatic_ai} /> Allow automatic
              general AI replies using approved knowledge
            </label>
          </p>
          <textarea
            id="knowledge"
            name="knowledge"
            rows={5}
            maxLength={12000}
            defaultValue={settings.data?.knowledge ?? ""}
            placeholder="Approved services, document requirements, contact details and FAQs. Do not paste credentials."
          />
          <p className="stat-note">
            Personalized advice and escalations require staff review. Enabling automation does not configure a scheduler
            or grant recipient permission.
          </p>
          <button type="submit" className="button">
            Save controls
          </button>
        </form>
        <form action={configure} className="section">
          <input type="hidden" name="kind" value="schedule" />
          <button type="submit" className="button button-secondary">
            Prepare due reminders
          </button>
          <p className="stat-note">Queues messages only; sending is performed by the secured worker.</p>
        </form>
      </section>
      <section className="card section">
        <h2>Recipient permissions</h2>
        <p className="stat-note">
          No reminders or replies are dispatched without recorded permission. Use international phone format, e.g. +91
          followed by the number.
        </p>
        <form action={configure} className="form-grid section">
          <input type="hidden" name="kind" value="permission" />
          <label>
            Channel
            <select name="channel">
              <option value="gmail">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
          <label>
            Recipient
            <input name="recipient" required maxLength={320} />
          </label>
          <label>
            Permission evidence
            <input
              name="evidence"
              required
              minLength={3}
              maxLength={500}
              placeholder="When and how permission was received"
            />
          </label>
          <label>
            <input type="checkbox" name="allowed" /> Allow messages (uncheck to revoke)
          </label>
          <button type="submit" className="button">
            Save permission
          </button>
        </form>
        {permissions.data?.map((p) => (
          <p key={`${p.channel}:${p.recipient}`}>
            {p.channel} · {p.recipient} · {p.allowed ? "Allowed" : "Blocked"}
          </p>
        ))}
        <p className="stat-note">
          Latest 25 permission changes shown. Enter an existing recipient above to update or revoke.
        </p>
      </section>
      <section className="card section">
        <h2>Message queue · {dispatch.count ?? 0}</h2>
        <form className="report-toolbar" method="get">
          <label>
            Status
            <select name="status" defaultValue={status}>
              {["review", "queued", "uncertain", "accepted", "delivered", "read", "cancelled", "failed"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button className="button button-secondary" type="submit">
            Filter
          </button>
        </form>
        <p className="stat-note">
          Queued messages wait for credentials, recipient permission and the next worker run. Accepted is not proof of
          delivery. Uncertain sends require provider reconciliation; they are never automatically retried.
        </p>
        {dispatch.data?.map((m) => (
          <article className="section" key={m.id}>
            <h3>{m.subject}</h3>
            <p>
              {m.source_module} · {m.channel} · {m.recipient} · {m.status}
            </p>
            {m.status === "review" ? (
              <form action={configure}>
                <input type="hidden" name="kind" value="review" />
                <input type="hidden" name="id" value={m.id} />
                <label htmlFor={`body-${m.id}`}>Review message</label>
                <textarea id={`body-${m.id}`} name="body" rows={4} maxLength={4000} defaultValue={m.body} />
                <button className="button" name="decision" value="send" type="submit">
                  Approve for sending
                </button>{" "}
                <button className="button button-secondary" name="decision" value="cancel" type="submit">
                  Cancel
                </button>
              </form>
            ) : (
              <p style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>
            )}
            {m.error && <p role="status">{m.error}</p>}
          </article>
        ))}
        {!dispatch.data?.length && <p>No messages in this state.</p>}
        <nav aria-label="Message queue pages">
          {page > 1 && <Link href={`?status=${status}&page=${page - 1}`}>← Previous </Link>}
          {page * 25 < (dispatch.count ?? 0) && <Link href={`?status=${status}&page=${page + 1}`}>Next →</Link>}
        </nav>
      </section>
      <section className="card section">
        <h2>Latest enquiries</h2>
        <p className="stat-note">
          Latest 25 enquiries. Attachments are not automatically marked verified or assigned to an arbitrary document.
        </p>
        {inbox.data?.map((m) => (
          <details key={m.id} className="section">
            <summary>
              {m.name || m.sender} · {m.channel} · {m.status} {m.classification && `· ${m.classification}`}
            </summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>
            {m.channel === "whatsapp" &&
              m.body.startsWith("Attachment requires staff matching") &&
              m.status !== "complete" && (
                <form action={configure}>
                  <input type="hidden" name="kind" value="attachment" />
                  <input type="hidden" name="inbound" value={m.id} />
                  <label>
                    Match to requested document
                    <select name="document" required>
                      <option value="">Choose document for this client</option>
                      {documents.data?.map((d) => (
                        <option value={d.id} key={d.id}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button button-secondary" type="submit">
                    Receive attachment for review
                  </button>
                </form>
              )}
            {m.reply && (
              <>
                <h3>AI draft</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>{m.reply}</p>
              </>
            )}
          </details>
        ))}
        {!inbox.data?.length && <p>No enquiries received yet.</p>}
      </section>
    </>
  );
}
