# Setup and Operations

## Current project state

The web application and six database migrations are implemented and applied to Supabase project ostvciecjwbzyzzyksnf. Activate the main administrator before testing protected routes.

## First administrator

1. Add SUPABASE_SERVICE_ROLE_KEY to the ignored .env.local file. Do not put it in a NEXT_PUBLIC variable.
2. Run npm run bootstrap:admin. Defaults are office@psbassociates.in and PSB Administrator. Optional BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME override these.
3. The script creates the Supabase Auth account if absent, then creates an admin profile, employee PSB-001 and annual leave balances. Its generated temporary password is displayed once.
4. Sign in at /login and set a private password on the first-login screen.

The bootstrap script is idempotent for the selected Auth user and preserves an existing password. It refuses to create another initial administrator when an active admin/partner exists. Failed linking after Auth creation requires account recovery through Supabase before retrying.

## Employee onboarding

An admin adds an employee in Employees, then selects Create login. Copy the temporary password shown once and share it privately with that employee. The employee signs in and must choose a new password. No automatic email is sent. See [employee workspace](employee-workspace.md).

## Commands

- npm run dev: local server.
- npm run typecheck: strict TypeScript.
- npm run lint: code standards.
- npm test: attendance and leave interface tests.
- npm run build: production compilation.
- node --env-file=.env.local scripts/check-setup.mjs: counts Auth users, linked profiles and attendance migrations without printing user details.
- npm run bootstrap:admin: one-time first administrator link.
- npx supabase db push --db-url <connection-url>: apply pending migrations.

## Release checklist

- Confirm workdays, shift, grace, full/half-day thresholds, leave allocations and correction window with PSB.
- Configure production redirect/recovery URLs and mail delivery.
- Add the second approver and test manager assignment.
- Test employee A versus employee B and manager cross-team denial.
- Test simultaneous punches, stale corrections, overlapping leave and insufficient balances.
- Reconcile a synthetic prior month, export CSV, close it and verify writes fail.
- Confirm backup retention and perform a restore rehearsal.
- Configure error monitoring with employee reasons and credentials redacted.
- Pilot with a small group while retaining an auditable manual fallback.

## Known operational limits

The current leave engine allocates fixed yearly balances and excludes weekly offs and configured holidays from a request. Carry-forward, monthly accrual, encashment, negative balances, compensatory leave, attachments and payroll calculations are intentionally outside Release 1.

Daily reconciliation materializes missing working days at 12:15 AM Asia/Kolkata. Month closure runs catch-up reconciliation, checks blockers, locks attendance operations and stores an immutable summary/detail snapshot with a version number.

The app currently uses in-app approval visibility. Email, WhatsApp and n8n notifications are future integrations.
