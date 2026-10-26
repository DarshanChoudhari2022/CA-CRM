# Authkey WhatsApp demo

The approved leave template `ca_crm_leave_update` (WID `52797`) is supported for reviewed outbound messages. The Meta provider remains the default. Authkey does not yet handle general CRM messages, inbound enquiries, or delivery callbacks.

## Configure Vercel

Set these variables for Production, then redeploy the updated code:

| Key | Value | Type |
| --- | --- | --- |
| WHATSAPP_PROVIDER | authkey | Config |
| AUTHKEY_API_KEY | Copy privately from Authkey My Account / Profile | Secret |
| AUTHKEY_TEMPLATE_ID | 52797 | Config |
| AUTHKEY_COUNTRY_CODE | 91 | Config |

The API selects the sender and language through the WID. No sender-number, language, or webhook-secret environment variable is needed for this outbound demo. Never put Authkey credentials in NEXT_PUBLIC variables.

## Send one demo message

1. Resolve the negative wallet balance shown in Authkey with their support/recharge controls before testing; approval alone does not confirm funds or delivery.
2. In Automation Centre, save WhatsApp permission for your consenting test recipient using +91 followed by ten digits.
3. Open CA CRM > Support, create a demo support record if necessary, and expand AI draft & messaging on that record.
4. Select WhatsApp approved template. Enter your test recipient, employee name, leave dates, approved/rejected decision, and a subject for the audit record.
5. Review all three values and check the contact-permission confirmation. Click Send reviewed message once.
6. Check the result and Authkey WhatsApp Report, then confirm receipt on the recipient's phone. Acceptance is not a delivery receipt. If uncertain, reconcile with Authkey before trying again.

This manual send uses the existing administrator authorization, workspace permission lookup, outbound reservation, duplicate-request protection, audit record, and hourly limit. It works while the scheduler is paused. Existing leave approvals do not automatically trigger WhatsApp; this is an explicit demo send.

## Provider contract and limitations

POST https://console.authkey.io/restapi/requestjson.php using Authorization: Basic followed by the raw key, JSON country_code/mobile/wid/type/bodyValues. Values 1, 2, 3 are employee name, leave dates, decision. Redirects and malformed recipients are rejected. The adapter recognizes LogID plus Message=Submitted Successfully as acknowledgment; unexpected responses are uncertain and must be checked with Authkey. The supplied PDF does not specify response schemas, so the first live response must be verified before broader rollout.

The scheduler deliberately excludes Authkey from general WhatsApp dispatch: this approved leave template cannot carry an invoice, compliance reminder or AI reply. Gmail automation continues independently. Leave settings paused for this demo. Do not point Authkey callbacks at the Meta webhook; a separate authenticated callback contract is required.

Source: the supplied Auth Key Api Document.pdf and https://authkey.io/whatsapp-api-docs.
