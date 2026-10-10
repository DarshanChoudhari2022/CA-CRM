# Setup and Operations

## Current project state

The web application and five database migrations are implemented. All five migrations are applied to Supabase project ostvciecjwbzyzzyksnf. The database currently reports zero Auth users and zero portal profiles. Create the first administrator before testing protected routes.

## First administrator

1. In the Supabase dashboard for the project, open Authentication → Users and create the partner/admin user with a real work email and temporary password.
2. Add BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME to the local .env.local. Do not commit this file.
3. Run npm run bootstrap:admin. The script finds that exact Auth identity and transactionally creates the partner profile, employee PSB-001 and annual leave balances.
4. Sign in at /login and change the temporary password through the approved recovery flow.
5. Create a second admin/partner before enabling self-service corrections, so administrators never approve their own requests.

The bootstrap script is idempotent for the selected Auth user. It refuses to create an Auth account and does not print credentials.

## Employee onboarding

An admin creates an employee record in Employees. Account invitation still needs the server-side Supabase service-role key, which has not been provided. Until the invitation route is configured, create the Auth user through the Supabase dashboard and link it using a reviewed administrative operation. Do not put a service-role key in NEXT_PUBLIC variables.

Before production, implement/test the invitation route with SUPABASE_SERVICE_ROLE_KEY held by the deployment platform, verify the calling user through a normal user-scoped client, then use the admin client only for invitation and identity linking.

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
