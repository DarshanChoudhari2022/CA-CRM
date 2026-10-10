# PSB Associates CRM

Internal management portal for P S B & Associates LLP to manage employees, attendance, leave, approvals, and HR records.

## Product direction

The first release should focus on a dependable employee-management workflow:

1. Secure sign-in with role-based access.
2. Employee directory and employee profiles.
3. Daily attendance with check-in/check-out, regularization, and monthly reports.
4. Leave requests, balances, approval workflow, holidays, and leave reports.
5. Admin dashboard with pending approvals and attendance/leave summaries.
6. Audit history for sensitive changes.

## Roles

- **Admin/Partner**: manage users, employees, policies, holidays, reports, and all approvals.
- **HR/Manager**: manage assigned employees, attendance corrections, and leave approvals.
- **Employee**: view profile, mark attendance, request leave, and view personal history.

## Suggested stack

- React + TypeScript + Vite for the portal UI.
- Supabase Auth for sign-in and session management.
- Supabase Postgres with Row Level Security for application data.
- Supabase Storage for optional employee documents.
- A small, versioned SQL migration set for schema and RLS policies.

## Initial data model

- `profiles`: one row per authenticated user, role, employee link, and active status.
- `employees`: personal, employment, department, manager, and joining information.
- `attendance_records`: one record per employee per work date, status, times, and regularization state.
- `leave_types`: annual/sick/casual/custom policies and accrual rules.
- `leave_balances`: employee balances by leave type and period.
- `leave_requests`: requested dates, reason, approval status, and approver history.
- `holidays`: office/location-specific holiday calendar.
- `audit_logs`: actor, action, entity, before/after values, and timestamp.

Important database rules:

- Enforce one attendance record per employee per date with a unique constraint.
- Keep leave approval transitions server-validated and auditable.
- Use RLS policies so employees can only read/write their own permitted data.
- Keep service-role credentials server-side only.

## Delivery phases

### Phase 1 — Foundation

Set up the app shell, branding, Supabase client, authentication, profiles, navigation, and protected routes.

### Phase 2 — Employee directory

Add employee CRUD, departments, reporting managers, status, onboarding fields, and search/filtering.

### Phase 3 — Attendance

Add daily marking, monthly calendar/table views, regularization requests, manager approval, and exports.

### Phase 4 — Leave

Add leave policies, balances, requests, approval queues, holiday calendar, and reports.

### Phase 5 — Hardening

Add audit logs, validation, permission tests, backups, error monitoring, and deployment configuration.

## Local setup

1. Copy `.env.example` to `.env` and fill in local values.
2. Install dependencies after the frontend scaffold is added.
3. Link the local Supabase CLI project with project ref `ostvciecjwbzyzzyksnf`.
4. Apply reviewed migrations before connecting production data.

Do not commit `.env`, database passwords, service-role keys, or exported employee data.

