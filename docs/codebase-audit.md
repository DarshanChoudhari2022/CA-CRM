# PSB Workspace codebase audit

The Next.js App Router serves a responsive web portal for employees and administrators. TypeScript and React provide the UI, server components read request-scoped data, and server actions or route handlers validate writes. Supabase Auth supplies sessions. PostgreSQL policies and RPCs enforce tenant and role boundaries. Supabase Storage holds private files. Vercel hosts the app, and n8n can schedule the CRM worker.

## Feature and data flow

| Feature | Entry point | Write and read paths |
| --- | --- | --- |
| Employee, admin and CRM sign-in, recovery, password changes, sign-out and expiry | Login variants, recovery and account settings | Auth route handlers and callback use Supabase Auth. Portal layouts check active profiles, roles and session context. |
| Employee accounts, reporting managers, roles, departments, branches and holidays | Employees, Operations and Settings | Admin account handlers provision Auth users. Server actions call organization-scoped employee, calendar and policy RPCs. |
| Check-in, check-out, location, shift duration and attendance history | Dashboard and My attendance | Attendance actions call the punch RPC and read the employee dashboard or attendance snapshot. |
| Missed punches, corrections, manual attendance and bulk marking | My attendance, Team attendance and Approvals | Employee requests and admin decisions write via attendance RPCs. Team pages use date, role and organization filters. |
| Daily work, planned tasks and photos | Dashboard and Daily work | Daily-report actions write to PostgreSQL. Photo uploads use private Storage and are finalized against report metadata. |
| Leave balances, leave requests, cancellations, approvals and office notifications | Leave, Approvals and Operations | Leave RPCs enforce eligibility and update requests and balances. A notification record tracks Web3Forms delivery. |
| Attendance reports, monthly closure, reopen and CSV | Attendance reports and Team attendance | Reporting RPCs supply live summaries or saved snapshots. Export routes apply authorization and serialize results. |
| Clients, assignments, leads, documents, compliance, tasks and support | CA CRM record routes | CRM server actions and RPCs write scoped records. Documents use private Storage with version metadata. |
| Private client collection | One-use upload link and collection form | Server validates the file, reserves the link, uploads to private Storage and finalizes the document version. |
| Gmail and WhatsApp intake, website enquiries, AI drafts, reminders and message history | Automation Centre, Support, Leads and Reminder history | Provider routes and the authenticated worker write intake and queue records. Groq generates drafts. Gmail and the configured WhatsApp provider handle dispatch. |
| CA AI workpapers and review | CA AI team | Server actions reserve an AI job, load scoped sources, save generated drafts and record staff review. |
| Invoice dashboard, ledger, billing, PDFs, receipts, advances and adjustments | Invoice workspace and CRM invoice PDF | Billing RPCs calculate and save financial records. Server PDF routes render saved templates. CSV routes export authorized ledger records. |
| Quotations, proformas, recurring invoices, filing drafts, client ledger, catalog and practice settings | Invoice workspace navigation | Server actions and billing RPCs handle drafts, conversions, recurrence, payments, catalog and defaults. |

## Prioritized baseline findings

| Category | Severity | Finding |
| --- | --- | --- |
| Broken | High | The private collection form offered 10 MB uploads through a Vercel Function with a 4.5 MB request limit. |
| Security | Medium | Operations, leave notification retry and AI reservation exposed raw database errors. |
| Security | Medium | Login and recovery had different origin handling behind forwarded hosts. |
| Performance | Medium | The session proxy ran on public upload and cron endpoints and on locally hosted fonts. Private collection accepted oversized or unrelated request bodies into its buffering path. |
| Responsiveness | Medium | Shared mobile styles forced every table cell onto one line, making routine lists harder to use at narrow widths. |
| Code quality | Low | Untracked browser fixtures and generated output were included in repository-wide lint. |

## Verification scope

### Follow-up findings

| Category | Severity | Change |
| --- | --- | --- |
| Broken | Medium | CRM and WhatsApp webhook handlers classify malformed input as 400 and oversized bodies as 413. Processing failures retain 503. |
| Security | Medium | Invoice cancellation and advance payment forms show known business messages and generic fallbacks for unexpected database errors. |
| Performance | Medium | Invoice draft client and service queries run concurrently. Large catalogs still need searchable, paginated selectors. |
| Responsiveness | Medium | Billing buttons, navigation and form controls use 44 px minimum heights on phones, tablets and coarse-pointer devices. |
| Code quality | Low | Route tests cover malformed and oversized webhook requests and a transient CRM intake failure. |

The local checks cover application compilation, types, lint, dependency advisories and the test suite. Authenticated production flows, real delivery providers, database migration replay and Lighthouse results require separate acceptance checks with the target environment. Use synthetic records for write and delivery checks. Provider readiness, permission, billing and scheduler settings can affect delivery even when application tests pass.
