import Link from "next/link";
import { PageHead } from "@/components/page-head";
import { createClient } from "@/lib/supabase/server";
import { integrationStatus } from "@/modules/crm/providers";
import { requireIdentity } from "@/modules/identity/session";
import { acknowledge } from "./actions";
export default async function AutomationsPage() {
  const identity = await requireIdentity();
  const client = await createClient();
  const admin = ["admin", "partner"].includes(identity.role);
  const [eventResult, outbox] = await Promise.all([
    client
      .from("crm_automation_events")
      .select("id,title,status,source_module,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      ? client
          .from("crm_outbox")
          .select("id,channel,recipient,status,created_at")
          .order("created_at", { ascending: false })
          .limit(100)
      : null,
  ]);
  if (eventResult.error || outbox?.error) throw new Error("Automation events unavailable.");
  const events = eventResult.data;
  return (
    <>
      <PageHead
        eyebrow="CA CRM"
        title="Automation operations"
        description="Scheduled reminders and reviewed messages."
      />
      {admin && (
        <section className="card">
          <h2>Integrations</h2>
          {Object.entries(integrationStatus()).map(([name, ready]) => (
            <p key={name}>
              {name} · {ready ? "Credentials configured — connection not verified" : "Configuration required"}
            </p>
          ))}
          <p className="stat-note">
            AI drafts and outbound sends are manual. Delivery webhooks and inbound sync are not enabled.
          </p>
        </section>
      )}
      <section className="card section">
        <h2>Reminder queue</h2>
        <p className="stat-note">
          Compliance reminders and overdue tasks are queued daily at 09:00 IST. Acknowledging does not send a message or
          complete the underlying work.
        </p>
        {(events ?? []).map((e) => (
          <article className="section" key={e.id}>
            <Link href={`/crm/${e.source_module}`}>{e.title}</Link>
            <p>
              {e.notes} · {e.status}
            </p>
            {e.status === "queued" && (
              <form action={acknowledge}>
                <input type="hidden" name="id" value={e.id} />
                <button className="button button-secondary" type="submit">
                  Acknowledge
                </button>
              </form>
            )}
          </article>
        ))}
        {!events?.length && <p>No reminders yet.</p>}
      </section>
      {admin && (
        <section className="card section">
          <h2>Outbound message log</h2>
          {(outbox?.data ?? []).map((o) => (
            <p key={o.id}>
              {o.channel} · {o.recipient} · {o.status} ·{" "}
              {new Date(o.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
            </p>
          ))}
          <p className="stat-note">
            Accepted means provider accepted the request, not delivered. Uncertain messages must be checked with the
            provider before resending.
          </p>
        </section>
      )}
    </>
  );
}
