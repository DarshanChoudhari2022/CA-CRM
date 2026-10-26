# Authkey WhatsApp Provider Design

## Intent

Connect the approved Authkey WhatsApp template `ca_crm_leave_update` (WID `52797`) to CA CRM for a controlled demo, while preserving the existing Meta Graph provider for future use.

## Goals

- Select Authkey or Meta through server-side environment configuration.
- Send approved Authkey template messages using the Authkey JSON API.
- Preserve the existing CRM dispatch lifecycle: queued, accepted, uncertain, failed, and receipt tracking.
- Keep credentials server-only and never expose them to browser code or logs.
- Keep WhatsApp in review/manual mode until the first test succeeds.
- Add tests and deployment documentation for the Authkey configuration.

## Non-goals

- Replacing Meta support.
- Automatically enabling WhatsApp automation.
- Implementing a new WhatsApp conversation webhook before Authkey webhook details are configured.
- Treating an Authkey acceptance response as proof of delivery.

## Safety constraints

- Authkey credentials are Vercel secrets only; no secret is committed.
- Recipient numbers are normalized to Indian country code `91` only when they are valid international/Indian numbers; invalid numbers fail closed.
- The provider sends only approved template WID `52797` with the three positional values expected by the template.
- Existing manual-review and recipient-permission checks remain unchanged.
- Provider errors become `uncertain` in the existing worker flow; the worker must not automatically replay uncertain sends.

## Approaches considered

### A. Add a selectable provider (chosen)

Keep Meta and add Authkey behind `WHATSAPP_PROVIDER=authkey|meta`. This preserves current behavior, supports staged rollout, and avoids a future migration if Meta is needed later.

### B. Replace Meta with Authkey

Smaller initial configuration but removes the current Meta path and makes provider rollback harder. Rejected because the CRM already contains a Meta webhook and provider implementation.

## Proposed implementation

1. Extend provider configuration to recognize Authkey credentials and report its readiness.
2. Add an Authkey request function using `https://api.authkey.io/restapi/requestjson.php`:
   - `Authorization: Basic <AUTHKEY_API_KEY>`
   - `country_code: 91`
   - `mobile`: recipient without the country-code prefix
   - `wid`: `AUTHKEY_TEMPLATE_ID` (demo default `52797`)
   - `type: text`
   - `bodyValues`: `{ "1": name, "2": dates, "3": status }`
3. Route `sendWhatsApp` to Authkey when `WHATSAPP_PROVIDER=authkey`; keep the existing Meta request for `meta`.
4. Preserve the dispatch provider ID returned by Authkey for operational tracing. Delivery receipts remain unavailable until an Authkey webhook is configured, so the UI will continue to distinguish acceptance from delivery.
5. Add unit tests for readiness, payload shape, number validation, provider selection, and failure handling.
6. Update `.env.example` and the setup guide with exact Vercel keys, without values.

## Configuration

```env
WHATSAPP_PROVIDER=authkey
AUTHKEY_API_KEY=<Vercel Secret>
AUTHKEY_TEMPLATE_ID=52797
AUTHKEY_TEMPLATE_LANGUAGE=en
AUTHKEY_COUNTRY_CODE=91
```

The existing Meta variables remain available when `WHATSAPP_PROVIDER=meta`.

## Rollout and verification

1. Deploy with WhatsApp automation disabled.
2. Confirm Automation Centre reports Authkey credentials present.
3. Add one consenting test recipient permission.
4. Queue one reviewed leave-approved message.
5. Run the worker once and verify Authkey acceptance in the queue/history.
6. Confirm the recipient receives the message manually.
7. Keep automatic reminders disabled until the result is confirmed.

## Open provider limitation

The supplied Authkey document describes outbound API calls but does not define an inbound event/receipt webhook. This design therefore supports outbound acceptance first. Authkey delivery receipts and inbound WhatsApp enquiries require a later webhook contract from Authkey.
