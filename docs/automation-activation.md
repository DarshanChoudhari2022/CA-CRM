# CA CRM automation — implementation and activation

14 October 2026. The supplied 152-node n8n JSON is the behavior reference. This implementation runs natively in the existing Next.js/Supabase application; it does not activate the original Google Sheets workflow. Attendance remains separate.

## Nine workflow branches

| Branch | Implementation |
| --- | --- |
| WhatsApp incoming | Verified GET challenge; POST HMAC signature; configured phone-number filter; all batched messages persisted; duplicate IDs ignored; client/lead routing; bounded conversation history; STOP opt-out. Delivery callbacks are retained, including callbacks arriving before send acknowledgement. |
| Website enquiry | Signed server-to-server intake with name, email and/or international phone, enquiry and unique event ID. Creates a lead; Groq prepares an opening reply and qualification. Email and WhatsApp replies are queued when the corresponding contact is available. The website backend must submit the signed event; secrets never go in browser JavaScript. |
| Gmail incoming | Dedicated label intake, one message per worker invocation, durable Gmail-ID deduplication, nested plain-text extraction, automated-mail/self-send loop guards. Removes the intake label only after processing; needs Gmail modify scope. |
| Document requests | Signed bulk request creates 1–30 checklist records. Private one-use, seven-day upload links can be generated in the dashboard and are added to document reminders. Private retained versions accept up to 10 MB. Staff explicitly match WhatsApp media to a document belonging to that client; authenticated media download/checksum and storage precede receipt. Verification remains a staff decision. Gmail binary attachment import is not implemented: use the private upload link. |
| Payment confirmation | Signed trusted integration event; unique event identity; duplicate payload check; issued-invoice lock, amount validation, partial payment ledger and overpayment rejection. Receipt messages queued; paid invoice reminders cancelled before dispatch. This is an integration bridge, not a ready-made Razorpay/PayU adapter: the payment backend must verify its gateway signature/status/currency and map the CRM invoice before forwarding. |
| Compliance schedule | Workspace-local 09:00 window; 7/3/1/0-day and daily overdue reminders. Firm-entered dates are authoritative; no invented statutory dates. Date changes and filed records invalidate old pending sends. |
| Document follow-up | Workspace-local 09:30 window; requested/rejected documents, three-day follow-up interval, partner alert after three sent cycles. Receipt stops further document reminders. |
| Lead follow-up | Workspace-local 10:00 window; three-day interval, maximum four accepted follow-up cycles. New/contacted leads close after four cycles without a later inbound response; qualified leads are not automatically lost. |
| Invoice follow-up | Workspace-local 10:30 window; three days before, due date and daily overdue. Partner escalation after fifteen days overdue. Balances come from the payment ledger. |

Partner alerts use Telegram when configured. AI output is schema validated; it cannot record payments, verify documents or file returns. General knowledge replies can be explicitly enabled for automatic sending. Personalized advice, unknown facts, attachments and urgent enquiries go to staff review. Reminder bodies are deterministic factual messages rather than model-generated demands. These are deliberate safety differences from the sample workflow.

## What is NOT yet live

Verified locally: production build, lint, 93 unit tests, rollback database checks for scheduling/idempotency/permissions/payments/leases/document receipt/opt-out, and generated-account HTTP checks of the automation dashboard, real private Storage upload, one-use upload link and unauthorized endpoint rejection. Temporary test files and accounts were removed. Migration `20261013150000_automation_engine` is applied to the configured Supabase project; no production sends were enabled.

External provider credentials have not been supplied locally. No provider connection, real send, actual WhatsApp media download or payment-gateway integration has been live-verified. No real client messages were sent during development. Database and provider-mocked tests do not certify live delivery. The application starts paused, with automatic sends and automatic AI replies disabled.

This is not a public website chat widget, Gmail attachment importer, OCR authenticity verifier, GST/ITR filing engine or payment processor. Website enquiries are answered through the configured contact channels, as in the supplied workflow. The original Google Sheets and n8n deployment are not required for the native implementation.

## Configuration

Keep secrets in ignored `.env.local` and Vercel server environment variables. Never prefix these with `NEXT_PUBLIC_`.

| Purpose | Variables |
| --- | --- |
| Runtime database | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Public upload-link origin | `NEXT_PUBLIC_APP_URL`, e.g. `https://ca-crm-theta.vercel.app` — no `/login` |
| Tenant routing | `CRM_AUTOMATION_ORGANIZATION_ID` — the intended organization's UUID, never a client-provided tenant |
| Worker authorization | `CRON_SECRET` — independently generated random secret |
| Signed website/document/payment bridge | `CRM_WEBHOOK_SECRET` — separate random secret, known only to trusted backend integrations |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` |
| Gmail | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`, `GMAIL_INTAKE_LABEL_ID` |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| Optional partner alerts | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_PARTNER_CHAT_ID` |

`SUPABASE_DB_URL` is for migration/test scripts; it is not required by the deployed request handlers.

1. Apply `node --env-file=.env.local scripts/apply-suite-migrations.mjs`. Do not reset the database.
2. Configure the variables above and redeploy. Use a supported Groq model. WhatsApp outbound uses the approved template with exactly one body text parameter; obtain the appropriate utility template approval and recipient permission.
3. Register `https://YOUR-DOMAIN/api/integrations/whatsapp` in Meta, using the configured verification token and subscribing to message events. The app secret verifies delivered POST payloads.
4. Authorize the Gmail mailbox with `gmail.send` and `gmail.modify`. Create a dedicated intake label and a filter that applies it only to enquiries. Enter its internal label ID, not its display name. Avoid internal mail and mailing lists.
5. Schedule authenticated GET requests to `/api/cron/crm` every minute with `Authorization: Bearer YOUR_CRON_SECRET`. Use n8n, a suitable scheduler or an eligible Vercel Cron plan. The repo deliberately does not install a high-frequency Vercel schedule that may exceed the hosting plan. Each call processes up to one incoming email, one AI draft and two outbound messages; parallel invocations claim different jobs. Default outbound cap is 20 per organization/hour. This is a conservative pilot limit, not an MNC throughput guarantee.
6. In **CRM → Automation centre**, enter approved support knowledge, record recipient permissions and enable intake. First use review mode with a consenting test recipient. General AI auto-replies and factual reminder auto-sends have separate toggles.
7. Verify actual provider receipt and delivery, a document upload/review, a duplicate webhook, a partial payment and final payment before enabling automatic sending for real clients. Use your gateway sandbox, not genuine financial events.

## Signed integration contract

POST JSON to `/api/integrations/crm`. Set `x-crm-timestamp` to Unix seconds and `x-crm-signature` to `sha256=` plus the hexadecimal HMAC-SHA256 of `timestamp + '.' + rawBody`, keyed by `CRM_WEBHOOK_SECRET`. Requests outside a five-minute clock window are rejected. Each event requires a stable unique ID; retry the same ID and payload after transient failure.

```json
{"id":"website-form-unique-id","kind":"website","data":{"name":"Example client","email":"client@example.com","phone":"+919999999999","message":"I need bookkeeping support."}}
```

```json
{"id":"document-request-unique-id","kind":"documents","data":{"client_id":"CLIENT_UUID","documents":[{"title":"Bank statement","due_date":"2026-10-20"}]}}
```

```json
{"id":"verified-payment-unique-id","kind":"payment","data":{"invoice_id":"CRM_INVOICE_UUID","amount":5000}}
```

Amounts are INR ledger amounts, not paise. Never forward an unverified browser claim of payment. Use the provider's authoritative successful payment event. A positive HTTP reply means recorded/queued, not delivered. Website intake does not automatically grant marketing/follow-up permission: record evidence in the dashboard.

## Operations and failure handling

- Durable claims and unique occurrences prevent duplicate scheduling and concurrent claims. Provider timeouts become `uncertain`, never automatic resend. Inspect the provider before deciding how to reconcile.
- AI processing retries up to three times and then remains `failed` for investigation. Failed AI work is visible in the inbox; operators currently recover it through an authorized database operation after resolving the cause.
- Revoking recipient permission blocks queued sends. Pausing disables intake and future worker claims; a provider request already in flight cannot be recalled.
- File receipt means stored, not authentic or professionally verified. Files stay private; staff review the correct client's document rather than marking the first outstanding item received.
- Run history distinguishes no scheduler runs, failures and completed runs. Inspect Vercel runtime logs for unexpected infrastructure errors; do not log message bodies or credentials.
- Automated financial updates accept only the signed backend bridge, not anonymous callbacks. Review gateway reconciliation and invoice references before connecting a payment processor.

Provider references: [Gmail message listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [Meta media retrieval](https://www.postman.com/meta/whatsapp-business-platform/request/fpj02x0/retrieve-media-url), [Meta webhook verification](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/), [Vercel secured cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Telegram Bot API](https://core.telegram.org/bots/api).
