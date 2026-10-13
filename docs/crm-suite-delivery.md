# PSB Workspace — CRM implementation and activation

Update, 14 October 2026: the inbound/outbound automation phase below is superseded by [Automation implementation and activation](automation-activation.md). The native durable inbox, dispatch worker, signed webhooks, client collection links and automation control centre are implemented. Live provider activation remains separate.

10 October 2026. This supersedes the attendance-only scope in the original planning package following the user's explicit request to include the future suite. It is a working CRM foundation, not certification of every advanced automation in the supplied n8n template.

## Implemented workflows

| Module | Current behavior |
| --- | --- |
| Access | Separate `/admin/login` and `/employee/login`, admin role gate, module launcher, active-profile checks, temporary-password onboarding, recovery request/callback, admin-created logins and credential sharing |
| People | Directory, account creation/reset, department/manager/role/status/last-working-date updates, manager-cycle and last-admin guards |
| Attendance and leave | Existing punches, corrections/approvals, monthly histories, leave balances/requests/decisions, pending-request cancellation, daily work, branch holiday creation, excused absence annotations, monthly reports/export and close/reopen snapshots |
| Clients | Contact details, notes, owner assignment, active/inactive lifecycle, search/status filters |
| Leads | Contact details, pipeline stages, owner/follow-up date, conversion to client with duplicate conversion protection |
| Documents | Checklist states, private retained versions (10 per document, 10 MB each), interrupted-upload finish/discard recovery and short-lived version download URLs. Receipt is not correctness verification |
| Compliance | Maintained per-client tasks, due dates, owner, pending/in-progress/blocked/filed states. Dates must be entered and verified by the firm; no statutory-date inference or filing |
| Invoices | Invoice register, issued amount/client immutability, partial payment ledger, outstanding balances, unique references and overpayment protection. Not a GST invoice generator or bank reconciliation |
| Tasks | Assigned work with due dates, notes and todo/in-progress/blocked/done lifecycle |
| Support | Assigned ticket inbox, notes/statuses, optional Groq draft returned for human review, manual administrator sends through Gmail/WhatsApp |
| CA AI team | Five specialist workpaper modes, reviewed reference library, scoped evidence snapshots, validated drafts, creator-only generation, administrator review, retry state and text exports. See [current system verdict](system-verdict.md) |
| Reports | Exact role-scoped module counts, database-aggregated collections, overdue compliance listing, paginated record lists, filtered CSV export capped at 10,000 records with formula escaping |
| Automation operations | Dated in-app compliance 7/3/1/0-day and daily overdue reminders, task day-before/overdue notices, immediate refresh on source changes, acknowledgement, provider indicators and outbound status log |

Authenticated database users have read policies but no direct CRM table write privileges. Mutations use allowlisted security-definer functions which derive organization and actor from the session. Employees can edit assigned operational records; only administrators/partners create/assign records and manage financial data. Managers see their direct reports' assignments. Private uploaded files are isolated through document ownership policies.

## Selected architecture

Retain Next.js App Router + TypeScript + React + Supabase PostgreSQL/Auth/Storage, deployed on Vercel. Separate typed domain tables with a shared presentation layer and validated mutation interface. No new independent authentication database or microservices. Future high-volume channel processing should use durable intake/outbox workers; it must not depend on a browser or a long-running Vercel request.

Five additive migrations extend the existing attendance schema: CRM records, people/calendar operations, integrations, reporting, and durable excused annotations. `scripts/apply-suite-migrations.mjs` applies only missing versions transactionally without resetting existing data. The hosted project has received these migrations. New cron jobs only queue in-app reminders; they do not contact clients.

## Provider activation

Add actual values to ignored `.env.local` for local use and server environment variables in Vercel. `.env.example` lists names, never real secrets. Redeploy after updating Vercel variables. Never give provider secrets a `NEXT_PUBLIC_` prefix.

| Service | Required variables | Provider preparation |
| --- | --- | --- |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` | Select a currently available chat model ID in your Groq account. Only the selected ticket title/notes are sent to Groq after a user requests a draft |
| Gmail | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER` | OAuth authorization for the sending mailbox with `https://www.googleapis.com/auth/gmail.send`; configure Google consent/API access and obtain a refresh token |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` | Register the business number; choose a supported Graph version; approve a template containing exactly one positional body text variable. The message editor supplies that variable. Only contact recipients with appropriate permission |

No provider credentials have been supplied for these three services, so live connections/sends are not verified. A configured indicator means only required environment variables exist. No messages were sent while implementing/testing.

Gmail uses OAuth refresh plus UTF-8 RFC822/base64url send. WhatsApp uses the configured approved template rather than free-text outbound reminders. The server limits outbound requests to 20 per organization/hour, and Groq drafts to 30/hour. Database reservations prevent repeated submission of the same request ID. After a timeout, the result is uncertain; there is deliberately no automatic retry, because the provider may have accepted it. These are per-request guards, not guarantees against a human starting a new duplicate request.

`accepted` is provider acceptance, not delivery. Delivery receipt processing is not yet implemented. Verify uncertain/sending items in the provider console before resending. AI outputs cannot directly change client records, file returns, record payments or send messages.

Provider references: [Groq API](https://console.groq.com/docs/api-reference), [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [Meta template API](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/).

## Password recovery activation

Set `NEXT_PUBLIC_APP_URL` to the origin only, e.g. `https://ca-crm-theta.vercel.app` (no `/login`). In Supabase configure the production Site URL and allow `https://ca-crm-theta.vercel.app/auth/callback`. For local recovery allow `http://localhost:3000/auth/callback`. Default PKCE emails must be opened in the requesting browser. For cross-browser recovery use an email template link to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`. Configure Supabase's SMTP/email delivery separately; Gmail CRM sending is not Supabase Auth email delivery. [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Verification and remaining implementation phases

Automated checks: TypeScript, Biome, 85 Vitest tests across 13 files (providers mocked), production Next build, rollback database tests, actual concurrent transaction checks and generated-account HTTP/Storage acceptance. CRM database tests cover organization isolation, assignment access, inactive users, employee restrictions, conversion idempotency, issued-invoice protection, duplicate/overpayments, duplicate outbound reservations, exact financial aggregates, manager-cycle/self-removal guards, future holiday validation, and excused-annotation persistence through reconciliation. See [quality upgrade](quality-upgrade.md) for document/version/register/reminder acceptance. No genuine client/employee fixture data is retained and no real account password is reset.

The full template's following capabilities remain pending rather than represented as working:

1. Provider activation and supervised mailbox/WhatsApp send testing; SMTP recovery test; authenticated mobile/browser journeys; restore/load/accessibility pilot gates.
2. Authenticated inbound Gmail/WhatsApp webhook ingestion, sender/client identity matching, attachments/quarantine, durable jobs, signatures, delivery callbacks, retries with provider reconciliation, dead-letter/replay/pause controls.
3. Client service engagements, deduplication/import; multi-contact/activity timeline; document templates/professional review evidence; client-facing access. Version retention and interrupted-upload recovery are implemented.
4. Verified statutory deadline catalogue, recurring compliance generation, escalation policies and maintained rule versions/evidence. Dated 7/3/1/0-day and daily overdue reminders are implemented.
5. Invoice line items, tax validation/numbering/PDFs, trusted bank/payment reconciliation, reversals/refunds, accounting exports. Current payments are manual entries, never automated confirmations.
6. CA workpapers now retrieve approved reference extracts and accessible record metadata, validate source references, retain drafts/evidence and record reviewer decisions. Live answer evaluation, file extraction/OCR and escalation rules remain pending; no autonomous legal/tax advice or execution.
7. Advanced HR schedules/assignments, unread decision feedback and accrual/carry-forward/payroll rules. Scoped team register filters and actual concurrent month-close acceptance are implemented; realistic load testing remains required.

Implement each phase behind scoped interfaces and migration/permission tests. This delivery does not import or activate the 152-node n8n workflow, Google Sheets stores, or Telegram. Keep Supabase authoritative and review any future import mappings explicitly.
