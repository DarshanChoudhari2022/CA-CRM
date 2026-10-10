# PSB Workspace

A modular internal portal for P S B & Associates LLP. Release 1 implements employee attendance and leave management; future CA practice modules remain separately scoped.

## Implemented

- Next.js 16 App Router, React 19, TypeScript and Tailwind CSS 4.
- Supabase Auth and Postgres with row-level permissions.
- Employee, manager, administrator and partner roles.
- Server-authoritative check-in/check-out with duplicate protection.
- Attendance history and correction approvals.
- Leave types, balances, date validation and approval workflow.
- Employee directory with branch, manager and policy assignment.
- Versioned attendance policy setup.
- Manager approval queue.
- Monthly summary, CSV export and month close/reopen database operations.
- Audit records for consequential actions.
- Responsive PSB-branded portal.
- Admin-generated employee logins, first-login password change and private credential handoff.
- Daily work plans, progress updates and work history.
- Six applied Supabase migrations, daily reconciliation and immutable month snapshots.

The CRM suite now includes clients, leads, documents, compliance tasks, invoices/manual payments, tasks, support, reports and automation operations. Optional Groq/Gmail/WhatsApp integrations require configuration. Inbound sync, delivery receipts, bank reconciliation, payroll, biometrics and GPS/geofencing remain outside the implemented baseline. See [current scope and activation](docs/crm-suite-delivery.md).

## Technology

The portal is a modular monolith: Next.js supplies the web and server layer; Supabase Auth identifies users; Postgres owns business transitions and permissions. Attendance and leave each expose a small interface while their calculations, idempotency, balance updates and audits remain inside transactional database functions. Future client, document, compliance, lead, invoice and automation modules can join the same identity and organization model without writing attendance tables directly.

## Run locally

1. Copy .env.example to .env.local and configure the browser-safe Supabase values plus the database URL.
2. Run npm install.
3. Run npm run dev and open http://localhost:3000.
4. Apply migrations with npx supabase db push --db-url <connection-url>.
5. Configure SUPABASE_SERVICE_ROLE_KEY locally, then run npm run bootstrap:admin to create office@psbassociates.in as the main admin.

The supplied project has six attendance migrations plus five suite migrations applied. For an existing attendance installation, apply missing suite versions with `node --env-file=.env.local scripts/apply-suite-migrations.mjs`. Administrator activation requires the server-side service-role key. See [employee workspace](docs/employee-workspace.md) for account creation and employee capabilities. Use `/admin/login` or `/employee/login`, then open modules from `/modules`.

## Quality checks

Run npm run typecheck, npm run lint, npm test and npm run build. See [setup and operations](docs/setup.md) for onboarding and production requirements.
Run `node --env-file=.env.local scripts/test-crm-db.mjs` and `node --env-file=.env.local scripts/test-workspace-db.mjs` for rollback-only database permission/transition tests. Provider unit tests are mocked and do not send messages.

## Product documents

- [Attendance and leave PRD](docs/attendance-prd.md)
- [Design document](docs/design.md)
- [Implementation plan](docs/implementation-plan.md)
- [Future suite and pitch](docs/future-suite.md)
- [CRM implementation, integration variables and remaining phases](docs/crm-suite-delivery.md)

Brand assets under public/brand were copied from the existing PSB website. Secrets, .env files and employee exports are excluded from Git.

