# Attendance — Implementation Plan

Version 0.1 · 10 October 2026 · Planning only

## 1. Delivery contract

Implement [PRD](attendance-prd.md) AT-01–AT-14 using [design.md](design.md). No future automation, full leave engine, payroll, GPS or biometric integration is included. Current repository is documentation and assets only. No completed implementation is implied by this plan.

Use vertical slices: schema and permissions, then a working user journey with relevant tests. Keep attendance calculations in one authoritative implementation. Publish working code to the supplied repository under the user's existing instruction; keep credentials and employee data excluded.

## 2. Ordered work packages

| Package | Deliverable | Dependencies | Exit evidence | Effort estimate |
| --- | --- | --- | --- | --- |
| P0 Policy and environment | Confirm defaults/branches, second approver, email/hosting, retention; synthetic fixtures | None | Decision register and staging configuration | 1–2 days |
| P1 Portal foundation | React/TS/Vite shell, PSB header, routes, session UX, basic checks | P0 environment | Responsive login/empty shell, build/typecheck | 1–2 days |
| P2 Identity and people | Migrations, firm/membership/employee scope, invitations, directory, manager assignment | P1 | AT-01/02 and direct-request access tests | 2–3 days |
| P3 Policy and calendar | Versioned policies, effective schedules, branch holidays, employment context | P2 | AT-09; historical dates reproducible | 1–2 days |
| P4 Punch and history | Atomic punches, idempotency, day classification, Today/history/register, reconciliation | P3 | AT-03/04/05/08, concurrent and midnight tests | 3–4 days |
| P5 Corrections and audit | Request/cancel/decide, non-self approval, excused annotations, decision feedback | P4 | AT-06/07/10/13, stale and lock tests | 2–3 days |
| P6 Reporting and closure | Shared summaries, secure CSV, snapshot versioning, close/reopen | P5 | AT-11/12, counts reconcile and locks hold | 2–3 days |
| P7 Release hardening | Accessibility, mobile, performance, restore rehearsal, training and staged rollout | P1–P6 | AT-14 and release checklist | 2–3 days |

Total planning estimate: 14–22 engineering days for one experienced full-stack developer, assuming timely policy/environment decisions, followed by 5–10 working days of pilot observation. This is a rough effort range, not a delivery promise. External email/domain provisioning and changed attendance requirements may extend elapsed time.

P1 styling and P0 policy collection can overlap. Critical dependency chain: identity → schedule → punch → correction → report closure. Avoid estimating future modules inside this attendance budget.

## 3. Concrete engineering tasks

### P0–P2

- Record open assumptions from the PRD; preserve proposed values until confirmed.
- Establish staging and production separation and verify actual Supabase state before migrations.
- Scaffold application and commands for dev/build/typecheck/tests; add environment validation without logging secrets.
- Implement membership and employee migrations with scoped constraints, RLS and indexes.
- Seed synthetic branches/users in staging only; bootstrap admin through a controlled deployment step.
- Implement invitation/recovery, employee binding, deactivation and last-admin protection.
- Build PSB shell, login, directory and error/empty states.

### P3–P4

- Build policy validation and effective schedule/calendar assignment.
- Add day/event/idempotency tables and transaction functions with consistent lock ordering.
- Implement one calculation path and exact work-date mapping.
- Build Today, personal history and scoped team register.
- Add reconciliation and catch-up; verify identical read results during job delay.
- Handle network timeouts by re-reading saved state and retrying the same request key.
- Add date/employee indexes and measure the agreed load envelope.

### P5–P6

- Add correction state machine, revisions and before/after snapshots.
- Implement no-self-approval and manager reassignment checks at decision time.
- Implement excused annotation conflict rules and audit.
- Add in-app decision indicators.
- Implement month materialization, blocker queries, locking and immutable report snapshots.
- Build filtered exports with formula-safe cells and authorization.
- Implement explicit historical calendar/employment amendment preview and recalculation for unlocked months.
- Ensure reopen/reclose creates a new report version without replacing historical exports.

### P7

- Run staging journeys across employee, manager and two admins.
- Verify mobile layouts at 360px, tablet and desktop; check keyboard/focus/error announcements.
- Configure monitored reconciliation and redacted error logging.
- Test recovery email and actual backup/restore capability.
- Prepare short employee and administrator guides, release notes and support ownership.
- Pilot with a small representative group before firm-wide rollout.

## 4. Verification matrix

| Test group | Cases | Requirements |
| --- | --- | --- |
| Identity/scope | Anonymous, uninvited, inactive, employee A vs B, manager other team, cross-firm IDs, self-promotion, export scope | AT-01/02/08/11 |
| Policy/calculation | Exact grace boundary; 239m59s/240m/479m59s/480m; holiday; weekly off; joining/leaving; future date; policy change | AT-03/05/09 |
| Punch | Double click, two tabs, identical retry, changed payload/key, checkout first, new day after incomplete day, server vs client clock | AT-03/04 |
| Corrections | Missing pair, wrong pair, future timestamp, 7-day boundary, second pending request, cancellation, approval/rejection, stale revision | AT-06/07 |
| Authorization changes | Deactivate before decision, reassign manager, self-review, sole-admin self-request | AT-01/07 |
| Month concurrency | Close racing with punch/correction/annotation, pending/incomplete blockers, reopen reason, reclose new version | AT-10/12 |
| Reports | Synthetic hand-calculated month, short/half/full counts, holidays, excused days, incomplete duration exclusion, escaped CSV cells | AT-05/11/12 |
| Audit | Every critical action traceable; forbidden audit writes; no secrets/reasons in ordinary logs/export | AT-13 |
| UX/failure | Timeout after committed punch, offline, expired session, no schedule, loading/empty data, keyboard/mobile | AT-03/14 |

Use database-backed integration tests for RLS, constraints, transaction rollback and concurrency. Test classification through the authoritative interface with fixed server-clock fixtures. Use a small browser suite for the complete employee/manager/admin journeys. Avoid mock-only tests that cannot exercise database permissions.

A documentation-only draft needs link/consistency review, not app test execution. At implementation time, tests must verify behavior, not merely mirror table or UI definitions.

## 5. Release gates and pilot

Gate A: P0 defaults reviewed, schema and access tests pass in staging.
Gate B: one employee can punch and recover from a timeout; one manager can decide a correction; another employee cannot read the record.
Gate C: synthetic monthly totals reconcile, closure races are safe and old snapshots survive reopen/reclose.
Gate D: accessibility/load targets measured, restoration rehearsed, policies configured, two approvers trained and recovery email verified.

Pilot sequence: configure approved schedules and actual holidays → onboard small group → compare daily with existing attendance process → resolve discrepancies without deleting originals → close a historical synthetic month and then the first completed real month → expand after acceptance.

Proposed pilot metrics come from PRD section 8. Record failures, corrections and admin effort. A short pilot cannot prove real monthly closure until a calendar month has completed; retain that as a later milestone if needed.

## 6. Deployment and recovery

Inspect remote/database state before deployment. Apply reviewed migrations to staging first, verify permissions, then deploy application and migrations in compatible order. Never use a destructive reset on the hosted project.

If application release fails, roll back to the previous compatible build and use an announced manual attendance log while the issue is resolved. Re-enter those records through auditable corrections. Do not discard already committed attendance or restore an old backup over new data without a reconciled recovery plan.

Business policy confirmation is needed before pilot activation, not before building this proposed design. The next implementation milestone is P0–P2; this request delivers the specification package only.
