# PSB Associates — Firm Management Portal

A modular portal for P S B & Associates LLP. **Release 1 is Attendance Management only.** The wider CA automation suite will be pitched after the attendance pilot.

## Planning documents

| Document | Contents |
| --- | --- |
| [Attendance PRD](docs/attendance-prd.md) | Exact features, roles, rules, acceptance criteria and proposed defaults |
| [Design document](docs/design.md) | Screens, PSB branding, architecture, schema and transaction contracts |
| [Implementation plan](docs/implementation-plan.md) | Work packages, dependencies, test coverage and release gates |
| [Future suite](docs/future-suite.md) | Reference assessment, deferred modules and follow-on pitch |

Status: draft specification, 10 October 2026. This repository contains documentation and branding assets; no working application, migrations or live automation has been implemented.

Release 1 includes sign-in, minimal employee setup, daily punches, history, corrections with approval, calendars, reporting and month locking. Full leave management, payroll, biometrics, geofencing and client automation are deferred. This scope supersedes the original foundation README.

Proposed stack: React + TypeScript + Vite with Supabase Auth and Postgres. Shared identity and branding support later modules; attendance owns its rules.

Brand assets in public/brand/ were copied from the existing PSB website. Reproduce its CA India mark and “PSB & Associates LLP / Chartered Accountants” header treatment.

## Configuration

.env.example documents placeholders; runnable setup instructions will follow the application scaffold. Keep database passwords, administrative keys, employee exports and .env files out of Git. The browser uses the publishable key with database permissions; administrative credentials stay server-side.

