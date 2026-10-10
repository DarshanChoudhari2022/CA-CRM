# PSB Portal — Design Document

Version 0.2 · 10 October 2026 · Implemented foundation

## 1. Design direction

Use one modular application and one Supabase database initially. Shared identity, employee references, navigation and audit support attendance and leave; each later business module owns its data and rules. Do not create microservices, a plugin marketplace or unrelated future-module tables in Release 1.

The codebase-design approach places authorization, dates, classification, revisions and audit behavior behind the attendance module's small interface. UI callers request an action and receive an authoritative result; they do not separately update time, status and audit rows.

## 2. Brand and experience

The existing PSB website header in ../psbassociates/website/build.mjs combines ca-india-logo.png with the text “PSB & Associates LLP” and “Chartered Accountants”. Reuse this lockup and existing proportions, not the example Notion firm's name or avatar. Use public/brand/brand-icon.png as the favicon.

Proposed portal palette: navy #10273B for structure; white #FFFFFF surfaces; slate #475569 text; pale #F4F7FA background; blue #2563EB actions; green/amber/red for success/warning/error. Verify contrast for actual combinations. Use DM Sans or a system sans for interface text; the brand may retain its website typography. Numeric times use tabular figures. Base text 16px, spacing scale 4/8/12/16/24/32px, minimum 44px primary touch targets.

Desktop: compact branded header, 240px sidebar, page title/actions, content. Mobile: brand header, drawer navigation, stacked cards, sticky punch action when appropriate. Tables become cards for employee history; manager registers may scroll horizontally within a labeled region. At 360px the page itself must not overflow.

Release navigation: Overview, My attendance, Team attendance (manager/admin), Corrections, Employees (admin), Reports, Settings (admin). Future modules are absent from operational navigation. A separately labeled roadmap document supports the sales discussion.

## 3. Screen specification

| Screen / route | Content and primary action | Essential states |
| --- | --- | --- |
| /login and /recover | PSB lockup, work email/password, recovery | Invalid credentials, recovery sent, expired invite/session |
| /overview | Role-scoped attendance cards, unresolved items, today panel | No employee link, empty team, loading, permission loss |
| /attendance/me | Today card, schedule/timezone, in/out, elapsed timer, month history; Check in/out | Not started, saving, confirmed, open, incomplete, complete, non-working-day confirmation |
| /attendance/team | Date and scope filters, paginated register; open detail | Empty result, unauthorized employee, stale refresh |
| /attendance/corrections | Own requests or approval queue; request/decide | Pending, approved, rejected, cancelled, conflict, locked month |
| /employees | Directory and add/edit drawer | Duplicate code/email, invite failed, archived, missing schedule |
| /reports/attendance | Month selector, detail/summary, export, close/reopen | Provisional, blockers listed, closed version, reopened |
| /settings/attendance | Branch, weekly schedule, policy versions, holidays | Invalid thresholds, conflicting dates, historical amendment preview |
| /settings/access | Membership roles and reporting assignments | Last-admin protection, self-escalation denied |

Employee today flow: open portal → fetch authoritative day → submit punch with request ID → show server-confirmed time → refresh history. While saving, disable repeat input. On timeout, read saved state and retry the same request ID; never mark success optimistically.

Correction flow: select date → show original times → enter proposed pair/reason → submit → pending → reviewer compares before/after → approve or reject → employee sees result. A 409-style conflict asks the reviewer to reload; it must not overwrite newer attendance.

Month flow: select completed month → see counts and blockers → reconcile → close snapshot → export version. Reopen requires explanation and a warning that later exports will carry a new version. Previously exported files remain valid historical snapshots.

All forms have labels and inline errors linked to fields. Color is supplemented by text/icons. Focus moves into opened dialogs and returns on close. Loading states must not flash false zeros. Offline mode explains that punches are not saved and supports recovery without local backdating.

## 4. Application structure and dependencies

Proposed source layout:

- src/app: routes, navigation, providers, brand shell.
- src/modules/identity: session and membership.
- src/modules/people: minimal employees and reporting assignment.
- src/modules/attendance: screens, query calls and attendance interface.
- src/shared/ui: reusable controls with no attendance rules.
- supabase/migrations: schema, permissions and transactional functions.
- supabase/functions: admin invitation and authenticated exports as needed.
- tests: interface, database authorization/concurrency and browser journeys.

React + TypeScript + Vite is the proposed frontend. Supabase Auth handles identity; Postgres is authoritative for attendance. Browser reads permitted views and calls transactional database functions. Admin invitation uses a server function with a privileged credential, after checking the invoking user's current membership. Never allow browser signup metadata to assign roles.

Attendance classification is authoritative in database functions/views used by transactions and reports. UI displays returned values; it must not reimplement threshold rules. A dependency on n8n or an LLM is unnecessary for attendance.

## 5. Schema contract

All business rows carry firm_id. Start with one PSB firm; retain the field for scoping, not a claim of completed multi-tenant SaaS. Composite foreign keys include firm_id to prevent cross-firm references. UUID primary keys, timestamptz instants, local date work_date, integer duration seconds and constrained enums are preferred.

| Table | Essential fields and invariants |
| --- | --- |
| firms | id, name, timezone; one initial firm |
| memberships | firm_id, user_id (Auth), role, active; unique firm/user |
| branches | firm_id, id, name, timezone |
| employees | id, membership link optional until invite accepted, unique firm/code and work email, name, department, branch, manager, employment dates, active |
| attendance_policies | immutable version, effective date, shift start/end, grace, thresholds, weekly workdays |
| employee_schedule_assignments | employee, policy, branch, effective_from/to; no overlapping date ranges |
| holidays | branch, local date, label; unique branch/date; amendments audited |
| attendance_days | employee, work_date, frozen policy/calendar/branch/department context, effective in/out, source, result, flags, revision; unique firm/employee/date |
| attendance_events | day, event kind, server timestamp, actor, request ID; append-only original punches and correction references |
| attendance_corrections | employee/date, base revision, original snapshot, proposed pair, reason, requester, state, reviewer, decision reason/times; one pending per employee/date |
| attendance_annotations | employee/date, excused reason, actor, active/version; conflicts with punches rejected transactionally |
| attendance_months | firm/month, state, revision, closed/reopened actors/times; unique firm/month |
| attendance_report_snapshots | month/version, immutable detail/summary payload, policy references, generated_by/at |
| leave_types | firm-scoped name/code, default annual allocation and active state |
| leave_balances | employee/type/year allocation and used quantity; approval updates under row lock |
| leave_requests | date range, full/half-day portion, computed working days, reason, state and reviewer trail |
| audit_events | actor, action, entity, request ID, timestamp, minimized before/after values; append-only |
| notification_receipts | membership, correction decision, read_at; no external messaging |
| idempotency_requests | firm, actor, operation, request key, payload hash, committed result; unique scoped key |

Employee employment/schedule/branch changes are effective-dated or audited with preserved day snapshots. Backdated employment changes use an explicit recalculation workflow on unlocked months; closed versions remain immutable. Names may display current values in live reports; closed snapshots preserve names at closure.

Indexes: scoped work date, employee/date, pending review, current manager, month state. Never hard-delete attendance through user-facing actions.

## 6. Attendance interface

Every command authenticates current membership, checks role and scope, validates inputs and month state, and runs changes plus audit in one transaction. Never trust client-supplied actor, firm, role, result or server time.

| Operation | Caller input | Contract |
| --- | --- | --- |
| getDay / listDays | Authorized employee/filter/date | Returns context, state, effective times, result, flags, revision, permitted actions |
| punch | in/out, request ID, optional work mode, non-working-day acknowledgement | Self only; server timestamp; one daily pair; returns saved day |
| requestCorrection | employee/date, expected revision, proposed pair, reason, request ID | Self within window or admin-assisted; no automatic approval |
| cancelCorrection | request ID and correction revision | Requester only while pending |
| decideCorrection | correction ID, expected revision, approve/reject, reason, request ID | Reviewer scope, no self-review; revalidate day and lock; atomic update |
| setExcusedAbsence | employee/date, set/remove, reason, request ID | Non-self admin only; no conflicting session/pending correction |
| generateReport | month and permitted filters | Shared calculations; provisional or closed snapshot, explicit version |
| closeMonth / reopenMonth | month, expected revision, request ID, reopen reason | Admin only; close checks blockers; reopen retains snapshots |
| amendCalendarOrEmployment | entity, effective changes, affected date range, reason, request ID | Admin preview/commit; unlocked history only; audit and deterministic recalculation |

Error codes: UNAUTHENTICATED, FORBIDDEN, INVALID_INPUT, OUTSIDE_EMPLOYMENT, NO_SCHEDULE, ALREADY_PUNCHED, NO_CHECK_IN, MONTH_LOCKED, PENDING_REQUEST_EXISTS, STALE_REVISION, SELF_APPROVAL, IDEMPOTENCY_CONFLICT. Display understandable messages; log only necessary metadata.

Concurrency: every mutation first acquires the firm/month row lock, then employee/day, then correction if needed. Close takes the same month lock before checking blockers and creating snapshot. This prevents a correction committing during closure. Day creation uses a unique constraint plus conflict handling; revision checks prevent lost updates. Creating missing rows and request IDs occurs in the same transaction. Same key/different payload is rejected.

## 7. Database permissions

Default-deny RLS on all business tables. Anonymous users see none. Active employees read own permitted rows; managers read current direct reports; admin reads firm scope. Audit/receipt visibility follows the PRD. Writes to attendance tables are denied to ordinary clients; approved functions perform validated transitions.

Any elevated database function uses explicit permission checks, a fixed safe search path and restricted execute grants. Membership helpers avoid recursive RLS lookups. Privileged server credentials never bypass application authorization merely because they can bypass database policies. Secret values never enter browser bundles or logs.

Protect last active admin from removal. Bootstrap admin with a controlled deployment step, never first-user-wins. Invitation acceptance verifies intended email/identity and binds one employee once.

## 8. Reporting and operations

One calculation path serves Today, history, register and report. Calendar context is frozen per day. Historical missing-day materialization uses effective schedule versions; month close materializes all eligible dates before checking blockers. CSV generation uses server-authorized rows, explicit local timezone and formula-safe string encoding.

Scheduled reconciliation runs by branch-local date, with idempotent catch-up. Open current-day sessions remain provisional. Logs record request IDs/error classes rather than employee reasons or credentials. Monitor failed punches, reconciliation lag and export errors.

Migration strategy: versioned SQL, separate staging, permissions tested before production, additive changes where possible. Backups/retention depend on the chosen deployment configuration and must be verified during release work. This document does not claim a configured backup or production Supabase connection.

## 9. Future integration seam

Reserve stable employee IDs and module-prefixed routes/tables. Later modules may consume attendance summaries or submit approved-absence commands; they do not write attendance tables directly. Add a transactional event outbox and authenticated integrations when the first real consumer exists, not as unused v1 infrastructure.

Future event examples: attendance.correction_decided.v1 and attendance.month_closed.v1. Event ID, firm, entity ID, timestamp and schema version are required; payloads should omit private reasons. Consumers deduplicate by event ID. These event contracts are sketches for later design, not implemented promises.
