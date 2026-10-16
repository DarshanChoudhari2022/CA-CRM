# Attendance, access and invoice release

## What changed

- Check-in and check-out request fresh browser location. A denied permission, timeout, or invalid coordinates stops the punch with a retry message. Each event records latitude, longitude, accuracy in metres, and device capture time. Retrying the same request preserves the original saved location. Employees see map links in attendance history; administrators see them in Team attendance. Old events display “Not recorded”; corrections do not invent a location.
- Employees and Administrators are the only assignable account roles. Employees → Manage access lets an administrator change role or active status. People & calendar uses the same controls. The last administrator cannot be removed, and administrators cannot remove their own access. Changes are audited. Existing manager accounts become Employees; existing partner accounts become Administrators. Historical enum labels remain only for compatibility with older database function definitions.
- CRM → Clients → Add/Edit record → Assigned employee controls client access. An employee sees only their assigned clients. Documents, compliance, support, leads and tasks linked to a client follow that client's assignment. Reassignment moves these linked records immediately; an independent assignment field cannot bypass client access. Records without a client retain their explicit employee assignment.
- Invoice pages, exports, payments, totals and PDF downloads require an administrator. The same restrictions apply to database reads. Retained AI workpapers containing invoice source snapshots are hidden from employees. CRM → Invoices → Add record creates an invoice. The subsequent template update adds the supplied classic and green PDF designs, itemized services, quantities, rates, discounts, billing details, amount in words and bank/UPI artwork. See `invoice-templates.md`. Draft and void documents are visibly marked. Automatic GST tax calculation and gateway reconciliation are not included.
- Sessions expire at the next occurrence of **03:00 Asia/Kolkata** after their original sign-in. A login at 10:00 expires the following morning; a login at 02:00 expires at 03:00 that morning. Token refresh does not extend this deadline. Database permissions reject expired sessions, and open tabs sign out at the deadline or when a suspended tab resumes. Logout does not create a check-out or alter attendance punches.
- Attendance history and monthly calculations start at the employee's joining date. Joining-date restrictions also protect direct attendance/work/photo/leave table reads. Work history and leave/attendance date inputs respect the employment start date. CRM client history is governed by client assignment, rather than hiding older client records needed for assigned work.
- New leave applications create a durable office-email notification. Browser submission uses the same Web3Forms approach as the PSB website. Saving leave succeeds independently of email. Approvals → Office leave emails shows notification history and administrator resend controls. A provider acceptance is not proof of inbox delivery. Ambiguous deliveries require checking the mailbox before resending.

## Release order

The database and application changes must be released together. An old application calls the location-free punch function, which this release revokes; a new application requires the new session-context function. Use a coordinated release window rather than leaving either version live by itself.

1. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
2. Preview the new database behavior without persisting changes: `node --env-file=.env.local scripts/test-access-location-db.mjs`. This applies pending migrations inside a transaction and rolls everything back. It does not send email.
3. Deploy the new application and apply the pending migrations in the same release window. With the existing server-only database URL in `.env.local`, the repository migration runner is `node --env-file=.env.local scripts/apply-suite-migrations.mjs`. It records versions and skips migrations already installed. New migration files are `20261016100000_access_location_sessions.sql`, `20261016103000_leave_email_notifications.sql` and `20261016120000_invoice_templates.sql`.
4. Sign in again after release. Older sessions may already be past their first 03:00 cutoff.
5. On HTTPS, test a check-in and check-out with location permission granted. Check both map links in the administrator register. Check the denied-permission message too.
6. Assign a dummy client to one employee, sign in as that employee, then as a different employee. Verify only the assigned employee sees that client and its linked work. Reassign it and repeat. Employees must not see or download invoices, including a manually entered PDF URL.
7. From an administrator login, create a draft invoice for the dummy client and download the PDF. Verify totals and draft marking before issuing a real invoice.

## Office leave email configuration

The PSB website uses `WEB3FORMS_ACCESS_KEY`; Web3Forms delivers to the mailbox associated with that key. A recipient cannot be selected by merely changing a Gmail address in the CRM. No Gmail password or Gmail OAuth credential is needed for this contact-form-style notification.

1. Confirm the receiving mailbox with the office. For a personal demo, create a key associated with `choudharidarshan5453@gmail.com`; for office delivery, use a key verified for the intended office mailbox.
2. In Vercel → project → Settings → Environment Variables, add `LEAVE_WEB3FORMS_ACCESS_KEY` with that Web3Forms key, then redeploy. Keep it separately configured so a demo does not silently start emailing the official mailbox. The key is included in the authenticated browser's form submission, as intended by Web3Forms; never use a Supabase service-role key here.
3. Apply for one test leave using the employee account. Confirm the office mailbox receives the employee name, leave type, dates, working-day count, reason and approval instructions. Check the Approvals log.
4. If email fails, the request remains in Approvals. Correct configuration and use Office leave emails → Send office email. An unconfirmed attempt may be retried after two minutes; first check whether the original arrived.
5. Default browser sending requires no scheduler. It requires the user to keep the page open until submission finishes.

Optional unattended server sending requires a Web3Forms plan supporting server submissions and IP allowlisting. Only then set `LEAVE_WEB3FORMS_SERVER_ENABLED=true`, set `LEAVE_NOTIFICATION_ORGANIZATION_ID` to the existing organization UUID, and schedule `GET /api/cron/leave-notifications` with `Authorization: Bearer <CRON_SECRET>`. This worker processes one queued notice per invocation, independently of CRM outbound reminders. Do not enable this option on an unsupported plan.

Provider references: [Web3Forms API](https://docs.web3forms.com/getting-started/api-reference), [current official source including server-side requirements](https://github.com/surjithctly/web3forms-docs/blob/main/getting-started/api-reference.md).

## Verification

Application tests cover location range/freshness, location-aware checkout, session deadline rejection, administrator-only invoice navigation, PDF generation/pagination and email acceptance/ambiguous failures. Database regression tests exercise actual RLS, role/status changes, cross-tenant isolation, client reassignment, linked-record ownership, invoice/payment privacy, location-free punch denial, immutable location retries, joining-date reads, notification leases and expired-session denial.

For rollback-only previews of the existing database suites against pending migrations, set `TEST_ACCESS_PREVIEW=1` before running a suite. Do not use the concurrency suite against a shared production database: it commits temporary fixtures and belongs in the isolated CI database. CI replays all migrations before running these suites.
