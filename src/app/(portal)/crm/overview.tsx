import {
  ArrowDownToLine,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCheck,
  CircleHelp,
  Files,
  ListTodo,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import type { CrmOverview } from "@/modules/crm/overview";

const icons = { clients: Users, documents: Files, compliance: CalendarDays, tasks: ListTodo };
const destinations = [
  { href: "/crm/clients", icon: Users, title: "Clients", note: "Contacts & ownership" },
  { href: "/crm/leads", icon: BriefcaseBusiness, title: "Lead pipeline", note: "Enquiries to engagements" },
  { href: "/crm/documents", icon: Files, title: "Documents", note: "Collect, review & retain" },
  { href: "/crm/compliance", icon: CalendarDays, title: "Compliance", note: "Deadlines & filing status" },
  { href: "/crm/invoices", icon: ArrowDownToLine, title: "Collections", note: "Invoices & recorded payments" },
  { href: "/crm/support", icon: CircleHelp, title: "Client support", note: "Queries & reviewed replies" },
];
const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function CrmOverviewView({ data, admin }: { data: CrmOverview; admin: boolean }) {
  return (
    <div className="crm-overview">
      <section className="crm-metrics" aria-label="Current workload">
        {data.metrics.map(({ key, label, hint, count, statuses }) => {
          const Icon = icons[key];
          const href = `/crm/${key}${statuses.length === 1 ? `?status=${statuses[0]}` : ""}`;
          return (
            <Link href={href} prefetch={false} className={`crm-metric crm-tone-${key}`} key={key}>
              <div className="crm-metric-top">
                <span>{label}</span>
                <span className="crm-icon">
                  <Icon size={19} aria-hidden="true" />
                </span>
              </div>
              <strong>{count === null ? "—" : count.toLocaleString("en-IN")}</strong>
              <span className="crm-muted">{count === null ? "Temporarily unavailable" : hint}</span>
            </Link>
          );
        })}
      </section>
      <div className="crm-overview-columns">
        <section className="crm-panel">
          <div className="crm-panel-heading">
            <div>
              <span className="eyebrow">PRIORITIES</span>
              <h2>Compliance deadlines</h2>
            </div>
            <Link href="/crm/compliance" className="crm-text-link">
              View all <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <p className="crm-panel-caption">Earliest unfiled dates, including overdue work.</p>
          {data.deadlines === null ? (
            <p className="crm-blank" role="status">
              Deadlines are temporarily unavailable. Open Compliance to try again.
            </p>
          ) : !data.deadlines.length ? (
            <div className="crm-blank">
              <CheckCheck size={28} aria-hidden="true" />
              <h3>No open deadlines</h3>
              <p>Scheduled compliance work will appear here.</p>
            </div>
          ) : (
            <ul className="crm-deadlines">
              {data.deadlines.map((item) => (
                <li key={item.id}>
                  <span className="crm-deadline-icon">
                    <CalendarDays size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <Link href={`/crm/compliance?q=${encodeURIComponent(item.title)}`}>{item.title}</Link>
                    <span>
                      Due{" "}
                      <time dateTime={item.due_date}>
                        {dateFormatter.format(new Date(`${item.due_date}T00:00:00Z`))}
                      </time>
                    </span>
                  </div>
                  <StatusPill value={item.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="crm-focus-panel">
          <span className="crm-focus-icon">
            <Sparkles size={24} aria-hidden="true" />
          </span>
          <span className="eyebrow">YOUR NEXT STEP</span>
          <h2>
            Less searching.
            <br />
            More focused work.
          </h2>
          <p>Review your queue, prepare a workpaper or manage client follow-ups.</p>
          <Link href="/crm/tasks" className="button crm-focus-primary">
            Open task queue <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link href="/crm/ai-team" className="crm-focus-link">
            CA AI workbench <ArrowRight size={15} aria-hidden="true" />
          </Link>
          {admin && (
            <Link href="/crm/automation-center" className="crm-focus-link">
              Automation centre <ArrowRight size={15} aria-hidden="true" />
            </Link>
          )}
          <small>AI drafts remain subject to professional review.</small>
        </aside>
      </div>
      <section aria-labelledby="workspace-tools-title">
        <div className="crm-tools-heading">
          <h2 id="workspace-tools-title">Your workspace</h2>
          <span className="crm-muted">Everything in its place</span>
        </div>
        <div className="crm-tools-grid">
          {destinations
            .filter(({ href }) => admin || href !== "/crm/invoices")
            .map(({ href, icon: Icon, title, note }) => (
              <Link href={href} prefetch={false} className="crm-tool" key={href}>
                <span className="crm-tool-icon">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{note}</p>
                </div>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ))}
        </div>
      </section>
      <p className="crm-scope-note">Live records visible to your role · Attendance is managed in its own workspace</p>
    </div>
  );
}
