# Quality upgrade — 13 October 2026

This is an evidence-based improvement, not a 10/10 enterprise certification.

## Delivered

- Document versions: retain up to 10 versions per checklist document, each up to 10 MB. Allowlisted formats, exact private Storage metadata checks, reserved upload paths and short-lived downloads. Older completed versions remain readable; an older upload finishing late cannot replace a newer completed version. Uploads can be resumed or discarded after interruption. Completion means receipt, not professional review. Existing files are not deleted during migration.
- Team attendance: separate attendance workspace, role-scoped date/branch/department/name/status filters, 50-row pages and formula-safe CSV export capped at 10,000 rows. Managers see their own/direct-report records, not the full firm.
- Personal history: derive employment/calendar/leave days even before scheduled reconciliation. Past unfinished shifts show incomplete; future dates are not marked absent.
- Approvals: show original and proposed correction times, reject stale revisions and require a written rejection reason. Pending-count feedback updates after confirmed decisions. Inactive/incomplete statuses no longer appear green.
- Leave: use organization-local business date/year, show default allocations where no annual balance exists and preserve explicit zero allocations. Cross-year requests remain separate.
- Reminders: dated occurrences at compliance 7/3/1/0-day and daily overdue intervals; tasks day-before and overdue. Source changes immediately cancel obsolete pending reminders and update relevant occurrences. Acknowledgement history is retained. These are in-app notices, not automatic Gmail/WhatsApp sends.
- CI: application checks plus an isolated local Supabase fresh-migration replay and database permission, workflow and concurrency checks. No production database reset or hosted credentials are used by CI.

## Acceptance evidence

85 application tests pass; typing, lint and production build pass. Hosted additive migrations and rollback database checks pass. Real simultaneous transactions verify that overlapping leave requests across different leave types cannot both commit and that a correction waiting behind month closure is rejected after closure commits.

Generated-account HTTP acceptance verifies the dashboard, AI brief/export (without a model call), retained document-version UI, filtered team register and CSV. Real private Storage API checks verify version retention, metadata finalization, completed-file deletion denial, unfinished-upload discard, photo upload and secure downloads. Fixture files/accounts are removed; genuine employee records and passwords are not changed.

## Remaining release gates

Configure and evaluate Groq with firm-approved cases; activate and supervise Gmail/WhatsApp/SMTP; test interactive mobile/browser journeys, real-volume p95/p99 load, monitoring/alerts and backup restoration. Add malware scanning/OCR before treating binary documents as model evidence. Government filing, bank reconciliation, recurring statutory catalogues, SSO and advanced payroll are not certified working features.

The current stack remains suitable. Measured operational readiness matters more than changing frameworks or assigning a perfect score.
