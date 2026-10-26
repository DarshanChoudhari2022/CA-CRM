# CA CRM demo verification — 26 October 2026

## Verified live

The deployed worker accepted and sent three explicitly authorized Gmail tests to the owner's demo inbox. The owner confirmed receipt of all three: **CA CRM DEMO — Document request**, **CA CRM DEMO — Compliance reminder**, and **CA CRM DEMO — Invoice follow-up**. Dispatch history uses occurrence `DEMO-VERIFICATION-20261026`; no customer recipients were used.

The test invoice was voided, the fictional compliance item closed, and the demo client deactivated after acceptance to avoid further follow-ups. Dispatch history is retained. The private document link remains usable for its original lifetime.

Existing Gmail enquiry intake → Groq draft → manual approval → worker → received reply was confirmed by the owner earlier in this session. The deployed upload previously completed successfully: collection link has `completed_at`, document status is `received`.

The recurring worker was completing scheduled runs with `mailError: false` and zero failures. Automatic AI replies and automatic factual reminders remain off; reviewed sends use the active worker.

## Fixes and repeatable verification

- Collection reserve/finish now serialize against staff changes, reject discarded or already reviewed uploads, and preserve completed-request idempotency. Discarding a pending version releases its link reference and revokes the unfinished link.
- Cancelled internal reminders revive when eligible work is reopened or a due date is reverted. Acknowledged history stays acknowledged. An automatically invalidated compliance email returns for fresh review; explicit administrator cancellations remain cancelled.
- Manual payments reject fractional paise at both the action and PostgreSQL RPC boundaries.
- Modern invoice payment QRs appear only on issued invoices with a positive balance. Drafts, voids, and quotations have no payment QR.
- The messaging channel selector is controlled so its displayed channel matches its template fields.
- Added HTTP tests for signed website events, invalid signatures/expired timestamps, payment event forwarding, and multipart collection upload; worker tests cover private links, bounded sends and uncertain delivery handling.
- CI includes the collection/reminder regressions and the opt-in payment database test.

Checks run against this change:

| Check | Result |
| --- | --- |
| Application suite | 210 passed; one opt-in database test skipped in the default run |
| Opt-in payment test suite | 17 passed, including the separately executed PostgreSQL test |
| Collection database regression | 12 checks passed |
| Reminder database regression | 35 checks passed |
| CRM and automation database suites | Passed; fixture transactions rolled back |
| Lint, TypeScript, production build | Passed |
| Production dependency audit | Zero reported vulnerabilities |

The new PostgreSQL migrations were applied transactionally after their rollback-only regression tests passed. No real invoice payments or customer emails were used for verification.

## What remains externally blocked

### Website form connection

The CRM's signed `/api/integrations/crm` endpoint and website-lead ingestion/qualification/conversion database path pass automated tests. **The actual PSB website form is not connected to it.** The inspected website still posts directly to Web3Forms, and `CRM_WEBHOOK_SECRET` is absent from the Vercel Production variable list.

To complete this integration, the website needs a server-side adapter which signs `${timestamp}.${rawBody}` using the shared `CRM_WEBHOOK_SECRET`, adds `x-crm-timestamp` and `x-crm-signature: sha256=<HMAC-SHA256>`, and POSTs a website event to the CRM. Never put that secret in browser JavaScript. Configure the same secret on the website server and CA CRM, then submit one real demo form and verify lead creation, classification and a reviewed reply. Existing Web3Forms contact/career delivery must be preserved. Do not claim this website connection is live based on backend tests alone.

### WhatsApp via Authkey

Authkey previously returned **insufficient balance** and the account showed **−385.91**. Delivery cannot be certified until funded. The current approved template is a three-variable **leave update**, not a general client-support, document, compliance or invoice template.

The current Authkey adapter supports reviewed outbound leave updates only. General reminder dispatch deliberately excludes this adapter. Complete WhatsApp coverage needs approved templates for the relevant client workflows, provider-specific mappings, inbound webhook authentication/event samples, delivery receipt integration and a funded end-to-end test. Reusing the leave template for client reminders would be incorrect.

## Demo claim

Safe to demonstrate: email enquiry assistance, private document upload, deadlines, lead management, invoice generation/payments and reviewed email reminders. Distinguish live evidence from automated checks. Do not describe website capture or the complete WhatsApp agent as deployed and verified until the integrations above are finished.
