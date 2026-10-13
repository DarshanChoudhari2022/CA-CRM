# Leave approval and monthly reporting

13 October 2026. Approved leave was shown as generic `excused`; the monthly page defaulted to a previous closed month and live expected-day totals counted only stored attendance rows. A rollback regression reproduced 1 expected day instead of 13.

## Current behaviour

- Approved leave displays **Leave approved** in personal history, team attendance and recent attendance. Other excused annotations remain distinct. Full-day approved leave shows that status on the employee dashboard instead of a check-in button.
- Admin/partner navigation and dashboard are team-management only. Personal attendance, leave application/balances and daily-work panels are removed for these roles; direct visits redirect to the relevant team page. Employee/manager self-service remains available.
- Approvals keeps its pending queue and adds paginated approved/rejected leave history by leave month, including request dates/days, reviewer, timestamp and decision note.
- Reports defaults to the organization's current month. Working calendar dates are derived through today, within employment and branch/policy calendars, without requiring scheduled reconciliation. Admin/partner identities are excluded from live employee totals.
- The employee table shows working days, days attended, leave taken, total approved leave including future dates, absent days, incomplete shifts and hours. Half-day leave counts as 0.5; its unworked past-day remainder is 0.5 absence. Today's unstarted remainder is not prematurely called absent. Attendance and leave can overlap on half-days; these columns are not additive payroll units.
- Detailed live CSV uses the same calendar source. New closed snapshots retain explicit per-day leave fractions. Existing closed snapshots are never overwritten; old snapshots without leave evidence show a dash rather than guessing that every excused day was leave. Reopen and close again through the existing audited workflow if a revised historical snapshot is needed.

## Verification

`node --env-file=.env.local scripts/test-leave-reporting-db.mjs` tests the actual stored-excused case, missing daily rows, admin exclusion, full/half-day leave calculation, today’s admin count, export evidence and history access. Fixtures roll back. Application tests cover role menus, mobile navigation, status colours and immutable snapshot aggregation. Generated-account HTTP acceptance verifies the admin dashboard, history and current-month report.

The real admin's read-only check on 13 October showed one employee expected, one on approved leave, one day taken and two days approved including the future date. No employee requests, balances or saved snapshots were changed to achieve this result.
