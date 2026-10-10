# Admin and employee workspace

The main administrator uses office@psbassociates.in. Add SUPABASE_SERVICE_ROLE_KEY to the ignored .env.local file, then run `npm run bootstrap:admin`. The script creates an Auth account through Supabase's supported Admin API, links it to an admin profile, and prints its generated temporary password once. Existing Auth users keep their current password. Never commit credentials.

The admin opens Employees, adds the employment record, then selects Create login. The server creates an employee-only login and atomically links its profile and employment record. The temporary password appears once for the admin to share privately. No email or message is automatically sent. Employees must set their own password on first login. A database trigger clears the onboarding flag only when Supabase updates the password hash.

Employees can check in and out, inspect their attendance history, request corrections, apply for leave, inspect leave balances and approval status, and add today's planned work. Work items support Planned, In progress, Completed and Blocked, plus notes and end-of-day updates. Prior work remains available as history; employees can only edit today's own items. Logging out is separate from attendance check-out.

All work records belong to an organization and employee. Row-level security limits reads to the employee, their reporting manager, or the organization's admin. Writes go through a validated database function. Account creation requires an authenticated organization admin and the server-only service key. Account credentials are generated with cryptographic randomness and returned with no-store caching. No self-registration or employee-controlled role selection is provided.

Migration: 20261010160000_employee_workspace.sql. Apply using normal Supabase migrations or `node --env-file=.env.local scripts/apply-workspace-migration.mjs`.

Production activation requires the service-role key and main-admin bootstrap. The generated-password workflow uses private manual delivery; automatic email delivery is a separate configuration task.
