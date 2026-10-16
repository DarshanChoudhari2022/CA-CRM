# Employee role and reporting manager controls

Administrators can change another linked account between Employee and Administrator
using the always-visible Role dropdown and Save access in Employees. Status is a
separate Active / Inactive dropdown. Existing database protections still prevent
self-demotion and removal of the last active administrator.

The Manager column now has Reporting manager and Save manager. An administrator
may choose any active employee in the same firm, or No manager. This does not
promote the manager, change account permissions or grant access to their reports'
CRM records. Self-reporting and reporting cycles are rejected. Changes are audited
and serialized with the existing organization-level administration lock.

Deploy the matching application and apply
`supabase/migrations/20261016140000_employee_manager_controls.sql` after the existing
access migrations. The normal suite migration runner includes it. This migration
adds the manager-only RPC and manager ID to the existing directory response; it
does not change any existing employee's role or reporting relationship.

Verification: `node --env-file=.env.local scripts/test-access-location-db.mjs`
compiles missing migrations and exercises the new operations in a transaction
that is entirely rolled back. No live role changes or messages are performed.
