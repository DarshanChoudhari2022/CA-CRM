# PSB Associates — Firm Management Portal

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
- Four applied Supabase migrations and domain tests.

External CA automation, payroll, biometrics, GPS/geofencing and full HR records are outside this release.

## Technology

The portal is a modular monolith: Next.js supplies the web and server layer; Supabase Auth identifies users; Postgres owns business transitions and permissions. Attendance and leave each expose a small interface while their calculations, idempotency, balance updates and audits remain inside transactional database functions. Future client, document, compliance, lead, invoice and automation modules can join the same identity and organization model without writing attendance tables directly.

## Run locally

1. Copy .env.example to .env.local and configure the browser-safe Supabase values plus the database URL.
2. Run npm install.
3. Run npm run dev and open http://localhost:3000.
4. Apply migrations with npx supabase db push --db-url <connection-url>.
5. Create the first user in Supabase Authentication, set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME locally, then run npm run bootstrap:admin.

The supplied project already has the four attendance/leave migrations applied. It currently has no Auth users, so the controlled administrator bootstrap is still required.

## Quality checks

Run npm run typecheck, npm run lint, npm test and npm run build. See [setup and operations](docs/setup.md) for onboarding and production requirements.

## Product documents

- [Attendance and leave PRD](docs/attendance-prd.md)
- [Design document](docs/design.md)
- [Implementation plan](docs/implementation-plan.md)
- [Future suite and pitch](docs/future-suite.md)

Brand assets under public/brand were copied from the existing PSB website. Secrets, .env files and employee exports are excluded from Git.

