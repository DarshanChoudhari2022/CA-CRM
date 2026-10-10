# Attendance and Leave Management — Product Requirements

Version 0.1 · 10 October 2026 · Draft for product review

## 1. Objective and scope decision

Build the first module of the PSB Associates Firm Management Portal: dependable employee attendance and leave management with corrections, approvals, balances and monthly reconciliation. It must work independently of future client, invoice, document, AI and n8n modules.

Confirmed: attendance first, future modular expansion, PSB header branding, Supabase and the supplied GitHub destination. Proposed decisions below make the build estimable; they are not confirmed PSB HR policy. This scope supersedes the initial README that included full leave management.

Sources: the user request, the existing PSB header, the supplied workflow and the Notion reference assessed in [future-suite.md](future-suite.md).

## 2. Release scope

| Included in Release 1 | Deferred |
| --- | --- |
| Invite-only login and role permissions | Public registration, client login, multi-firm SaaS billing |
| Minimal employee directory and manager assignment | Full HR records, employee documents, recruitment, appraisals |
| One daily check-in/check-out | Multiple sessions, break punches, overnight shifts, offline punches |
| Personal history, team register and dashboard | GPS, geofencing, selfies, biometrics, device enforcement |
| Correction request and single human approval | Multi-level approvals and disciplinary decisions |
| Weekly schedules, branch holidays, versioned policies | Advanced accrual, carry-forward, encashment and payroll |
| CSV reports, month close/reopen and audit | PDF/XLSX reporting, external attendance messaging |
| In-app pending queue and decision feedback | Clients, documents, compliance, leads, invoices, AI and n8n |

Admin may annotate a day as **Excused absence** with a reason. This records attendance context only; it does not determine paid leave. A later leave module may supply approved absences through the attendance interface.

## 3. Roles and authorization

| Action | Employee | Manager | Admin/Partner |
| --- | --- | --- | --- |
| Punch/view own attendance | Yes | If linked to employee | If linked to employee |
| Request own correction | Yes | Yes | Yes |
| View employee details | Own limited profile | Team work details | All employees |
| View register/export | Own | Current direct reports | Firm |
| Approve correction | No | Direct reports, never self | Anyone except self |
| Manage roles, employees, schedules | No | No | Yes |
| Annotate excused absence | No | No | Yes, never self |
| Close/reopen month | No | No | Yes |
| Audit access | Own correction trail | Team correction trail | Attendance and configuration audit |

Manager reassignment immediately changes access to the employee's attendance history; previous managers lose access. This is a proposed access policy to validate before pilot. All reads and writes enforce membership and scope in the database, including exports and direct requests.

Admin self-corrections require another admin. Plan for two approvers at setup. No self-promotion or self-approval. Deactivated memberships lose access even if an authentication session still exists.

## 4. Exact feature requirements

| ID | Feature | Acceptance criteria |
| --- | --- | --- |
| AT-01 | Invite-only login, logout, password recovery and invite retry | Uninvited users cannot access the portal; inactive membership denies reads/writes; expired invitation can be reissued |
| AT-02 | Employee setup: code, name, work email, branch, department label, manager, joining/last-working dates, active status and schedule | Unique code per firm; dates valid; manager cycles rejected; archive preserves history; invite retry does not duplicate employee |
| AT-03 | Today page with schedule, saved punch state, date/timezone and elapsed duration | Server time is authoritative; refresh restores record; action succeeds only after server confirmation |
| AT-04 | One daily check-in and check-out | Concurrent tabs cannot duplicate punches; check-out before check-in fails; completed day cannot be reopened by employee |
| AT-05 | Personal monthly history: date, classification, in/out, duration, flags and correction status | Future dates never absent; holidays/weekly offs labeled; calculations match reports |
| AT-06 | Correction for missing or wrong punches | Date, proposed times and reason of 10–500 characters required; one pending request per day; original record unchanged until approval |
| AT-07 | Approval queue with before/after comparison | Approve/reject is atomic; rejection requires reason; self-review, stale revisions and conflicting repeat decisions fail |
| AT-08 | Daily team/firm register | Filter by date, branch, department, employee and classification; server enforces scope; open and incomplete states clearly separated |
| AT-09 | Schedule, calendar and policy configuration | Effective dates preserve history; future policy changes do not silently alter past reports; overlapping assignments rejected |
| AT-10 | Excused absence annotation | Non-self admin with reason; cannot coexist with punches or pending correction; removal also requires reason and audit |
| AT-11 | Monthly detail/summary CSV | Filtered scope enforced server-side; detail and totals agree; export contains timezone, generation time and report version; untrusted cells cannot execute formulas |
| AT-12 | Month close/reopen | Only completed months close; pending corrections/incomplete records block closure; locked months reject edits; reopen needs reason and preserves prior snapshot |
| AT-13 | Audit and in-app feedback | Punches, corrections, decisions, annotations, configuration, roles and closures traceable; employee sees decision state and unread indicator |
| AT-14 | Responsive PSB portal | Header branding reused; keyboard navigation, visible focus, text status labels, accessible errors and loading/empty/offline/session-expired states |
| AT-15 | Leave types and annual balances | Admin creates types and default allocation; each employee has a year-specific allocated/used/available balance |
| AT-16 | Employee leave request | Full or half-day request validates working days, overlap, balance, employment and reason before becoming pending |
| AT-17 | Leave approval | Current manager/admin can approve or reject; no self-approval; approval locks and deducts balance in one transaction |
| AT-18 | Leave/attendance integration | Approved leave appears in dashboard/reporting and cannot be double-booked; advanced payroll treatment remains deferred |

## 5. Proposed defaults

| Setting | Proposed value | Meaning |
| --- | --- | --- |
| Timezone | Asia/Kolkata | UTC instants, branch-local work dates |
| Working days | Monday–Saturday | Sunday weekly off; confirm with HR |
| Shift | 10:30–19:30 | Suggested from website office hours; not verified employee policy |
| Grace | 15 minutes | Exactly 10:45:00 is on time; later is Late |
| Full day | At least 480 elapsed minutes | Attendance classification, not payroll |
| Half day | At least 240 and below 480 minutes | Below 240 with valid punches is Short day |
| Break deduction | None | Hours mean elapsed attendance, not billable/productive time |
| Employee correction window | Today and previous 7 calendar dates | Within employment, not future, unlocked month |
| Older correction | Admin submits request, another eligible reviewer decides | Same no-self-approval and audit rules |
| Work mode | Office / Client visit / Remote | Optional self-declared label, not location or approval proof |
| Rounding | None for classification | Display hours/minutes without rounding thresholds |

Validate 0 < half-day threshold <= full-day threshold <= shift length; start < end; grace nonnegative and less than shift duration. Overnight schedules are rejected. Policy and calendar changes normally start on a future local date. Amendments to historical calendar records require an explicit admin recalculation, reason and an unlocked month.

## 6. State and calculation rules

Calendar context, punch state and result are separate. Context: Working day, Holiday, Weekly off, Outside employment. Punch state: Not started, Open, Complete, Incomplete. Result: Full day, Half day, Short day, Absent, Excused absence, Not applicable. Late/Early departure are independent flags.

1. Today without punches is Not started; after shift end it is No check-in yet. Absent is final only after the local date closes.
2. Open session shows In progress until shift end, then Missing check-out. After midnight it is Incomplete, with no completed result/duration. Never fabricate a check-out.
3. Midnight reconciliation materializes missing/unfinished working-day records. Reads derive the same state if the job is delayed; catch-up is idempotent.
4. Today's check-in is allowed even if yesterday is incomplete. Normal punches apply only to today's local date; yesterday needs correction. No overnight sessions.
5. Complete working day: duration >=480 minutes = Full day; >=240 and <480 = Half day; >0 and <240 = Short day, using that day's frozen policy. Check-out must be later and within the same local date.
6. Check-in after grace is Late; check-out before shift end is Early departure. Flags do not alter duration classification or deduct pay.
7. Holiday/weekly off with no punches is Not applicable. Punching prompts confirmation and records Worked on non-working day with duration. No overtime, compensatory leave or late/early flags are inferred.
8. Outside employment dates, no attendance expectation or correction. Deactivation denies current access but preserves history within employment dates.
9. Corrections create/replace a same-day punch pair. Times cannot be future relative to server time. Pending requests can be cancelled; approval rechecks permission, month lock, employment and record revision.
10. Approval changes effective times but preserves original punch events. Rejection/cancellation leaves attendance unchanged. Identical retry returns original outcome; conflicting repeat decision fails.
11. Closed months reject attendance edits, annotations, new correction requests and calendar recalculation. Admin reopens with reason, resolves issues and closes a new immutable report version.
12. No salary, deduction, overtime entitlement, paid-day count or statutory leave entitlement is calculated.

| Example using defaults | Expected result |
| --- | --- |
| 10:30–19:30 working day | Full day, 9h elapsed, on time |
| 10:46–19:30 | Full day, Late |
| 10:30–15:00 | Half day, Early departure |
| 10:30–13:00 | Short day, Early departure |
| Yesterday check-in without check-out | Incomplete, correction needed |
| Yesterday working day without punches | Absent unless excused |
| Sunday without punches | Weekly off, Not applicable |
| Two tabs check in simultaneously | Exactly one accepted check-in |

## 7. Reporting definitions

Daily cards: expected employees; checked in (Open + Complete on working days); not checked in; incomplete; pending corrections. Late is an overlapping flag. Non-working-day activity is separate. Do not imply all cards sum to headcount.

Monthly summary per employee: expected working days within employment dates; counts of Full/Half/Short/Absent/Excused/Incomplete; completed elapsed hours; Late/Early counts; non-working days worked; unresolved requests. For historical dates, mutually exclusive working-day classifications sum to expected days. Current-month unelapsed dates are excluded; today's provisional states are shown separately. No attendance percentage in v1 because half-day weighting is unagreed.

CSV detail: employee code/name, branch, department, work date, calendar context, punch state, result, in/out in local time, elapsed minutes, late/early flags, work mode, correction state, policy version. Summary contains the counts above. Exclude personal correction reasons from standard exports.

## 8. Quality, success and launch

Planning envelope: 200 employees, 3 branches, 25 simultaneous punches. Validate rather than assume capacity. Staging targets: p95 punch <2 seconds, 200-employee monthly report <5 seconds. Target WCAG 2.2 AA behavior with keyboard and screen-reader checks; no certification claim.

Pilot targets: >=95% of eligible days resolved before month close; >=90% of corrections decided within two working days; monthly report preparation under ten minutes; zero unauthorized cross-team access in the test matrix. Record baseline manual effort; these are proposed targets, not measured benefits.

Launch gates: AT-01–AT-18 pass; concurrent writes and access controls verified; reports reconciled; recovery email tested; backup restore rehearsed; two approvers trained; HR has reviewed policy. Proposed backup objective: daily backup, restore within one working day, subject to actual hosting capability and restore measurement. HR must set retention before real employee data is collected.

## 9. Decisions before pilot

HR/Partner: actual employees/branches, work hours, holidays, grace/thresholds, correction window, manager-history visibility, second approver and retention. Product owner: whether location/device verification is essential (scope change). Technical owner: hosting, email sender, backups and target environment.

These decisions do not block drafting or building configurable modules. They block activation of unconfirmed policies for a live pilot.
