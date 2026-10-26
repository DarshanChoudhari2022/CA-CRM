# CA CRM - remaining setup, step by step

Prepared 25 October 2026. Demo Gmail: **choudharidarshan5453@gmail.com**.
Application: https://ca-crm-theta.vercel.app

## Read this first

Keep all three Automation Centre checkboxes OFF until the controlled tests below.
Do not connect real client recipients, migrate the office WhatsApp number, or run
the old full n8n automation workflow alongside this application's worker.

Never paste passwords, access tokens, refresh tokens, Client Secrets, App Secrets
or Authorization headers into chat or screenshots. Replace previously exposed
credentials. Save secrets in Vercel or a password manager, not GitHub.

This guide does not activate services. Provider setup, approval and live delivery
are separate checks; seeing "Credentials present" does not prove a working connection.

## 1. Where we are now

| Item | Evidence so far | Still required |
| --- | --- | --- |
| Groq | CRM detected credentials | Generate a successful draft from the deployed CRM |
| Gmail | Playground returned labels, a labelled message and the expected profile | Verify the deployed refresh token through CRM intake and a controlled send |
| Gmail label | CA-CRM-Demo; ID `Label_8914613925540105993` | Test an incoming enquiry from another account |
| WhatsApp | Developer-account setup started | App, test sender, recipient, credentials, webhook, approved template and receipt test |
| Worker | Screenshot reported configuration required | Organization ID, secret and an authenticated schedule |

Important correction: the self-sent Gmail test does not prove CRM intake. The code
ignores messages whose sender equals GMAIL_SENDER, to prevent reply loops. It can
remove the intake label from such a message without importing it. Use another
mailbox you control or a consenting tester for the actual intake test.

## 2. Meta login and developer registration

1. Open https://developers.facebook.com/apps/ directly, not the website search page.
2. Click Login if prompted. Sign in with your own Facebook account.
3. Complete developer registration if requested. Enter verification codes yourself.
4. Read any terms before deciding whether to accept them.
5. Stop once you can see My Apps and Create App.

Expected: you are on an application dashboard, not search results for "apps".

## 3. Create the WhatsApp application

Meta labels and available onboarding paths vary by account. Do not select an
unrelated advertising or Facebook-login use case merely to continue.

1. Click Create App.
2. Name it **CA CRM Demo** and use a monitored contact email.
3. Select the WhatsApp / connecting with customers through WhatsApp use case if offered.
4. If the UI instead offers app types, use the business-compatible path that exposes
   WhatsApp, then add the WhatsApp product.
5. Select a business portfolio you are authorized to use if Meta requires one.
   If none is available, complete the required portfolio setup or stop and review
   the prompt; do not attach an unrelated organization.
6. Create the app and open WhatsApp API Setup / Getting Started.

Expected: WhatsApp API setup with a test sender or instructions to provision one.
If your screen differs, capture only the use-case choices, never secret values.

## 4. Set up a test sender and one recipient

1. Use Meta's supplied test WhatsApp sender if available.
2. Under the recipient / To selector, add your own WhatsApp number in international format.
3. Complete the verification code on your device privately.
4. Confirm that the verified recipient is selected.
5. If Meta offers a built-in test-message action, you may send that demo message
   to your own verified number and confirm receipt.

Do not register, disconnect or migrate the firm's existing WhatsApp number for this demo.
Meta's built-in test send proves the Meta path only, not CRM sending.

## 5. Gather WhatsApp settings privately

Open Vercel -> ca-crm -> Settings -> Environment Variables. Configure Production
only when intentionally enabling the live deployment; use main Preview only for
trusted demo testing, preferably with isolated demo data. Never give sending
credentials to untrusted preview branches.

| Key | Where the value comes from | Type |
| --- | --- | --- |
| WHATSAPP_ACCESS_TOKEN | WhatsApp API Setup test token; note its displayed expiry | Secret |
| WHATSAPP_PHONE_NUMBER_ID | Phone Number ID beside the selected API sender, not its visible telephone number or Business Account ID | Config |
| WHATSAPP_GRAPH_VERSION | Supported Graph version in Meta's generated API example, including the leading `v` | Config |
| WHATSAPP_APP_SECRET | App Settings -> Basic -> App Secret; reveal privately | Secret |
| WHATSAPP_WEBHOOK_VERIFY_TOKEN | A new random secret you generate and save in a password manager | Secret |
| WHATSAPP_TEMPLATE_NAME | Exact name of your approved, compatible message template | Config |
| WHATSAPP_TEMPLATE_LANGUAGE | Exact approved template language code, not an assumed `en` | Config |

Use different random secrets for WHATSAPP_WEBHOOK_VERIFY_TOKEN, CRON_SECRET and
CRM_WEBHOOK_SECRET. Do not use your account password or Supabase keys for them.
Save the variables, then redeploy the intended deployment.

Temporary test tokens are not production credentials. For production, follow Meta's
system-user/token, asset assignment, business, billing and permission requirements.
Check the actual expiry shown by Meta; do not assume a token is permanent.

## 6. Obtain a template compatible with this CRM

1. Open WhatsApp Manager for the intended WhatsApp Business Account.
2. Open message templates and create a suitable transactional/service template.
3. Use **exactly one positional body parameter**, `{{1}}`, and avoid adding header,
   button or other parameters that the current send adapter does not supply.
4. Provide realistic sample content and choose the language you will actually use.
5. Submit for review and wait for approval. Meta determines category and acceptance.
6. Copy the approved name and language into the two template variables above.
7. Redeploy after changes.

Do not assume a generic template consisting only of a variable will be approved.
Use clear fixed context and realistic examples. If Meta's test account cannot
create/approve the required template, outbound CRM testing is blocked until a
compatible approved template/account is available; Gmail-only testing can continue.

The built-in zero-variable **hello_world** test template does not match this CRM's
one-body-parameter adapter. Do not mark CRM sending verified just because Meta's
hello_world test worked. A template name is not an API token.

## 7. Configure WhatsApp webhook verification

1. Confirm the WhatsApp variables and CRM_AUTOMATION_ORGANIZATION_ID are configured
   for the correct deployment and the latest deployment is Ready.
2. In Meta's WhatsApp Configuration / Webhooks area, edit the callback settings.
3. Enter this callback URL exactly:

   `https://ca-crm-theta.vercel.app/api/integrations/whatsapp`

4. For Verify token, enter exactly the private WHATSAPP_WEBHOOK_VERIFY_TOKEN value.
5. Click Verify and Save.
6. Subscribe to **messages** events and ensure the app is subscribed to the intended
   WhatsApp Business Account. Verification alone is not an event subscription.
7. Keep CRM intake disabled for now. Perform the real inbound test only in section 11.

The verify token handles Meta's initial challenge. WHATSAPP_APP_SECRET validates
incoming POST signatures. These are different values with different purposes.

If verification fails: check the deployment URL, matching verify token, current
redeployment and whether a protection/login page blocks Meta. Do not remove CRM
authentication or bypass signature checking to make a webhook work.

## 8. Configure the worker's Vercel settings

1. Open Vercel -> ca-crm -> Settings -> Environment Variables.
2. Add CRON_SECRET as a Secret: independently generated random value, such as a
   password-manager-generated 64-character hexadecimal string.
3. Add CRM_AUTOMATION_ORGANIZATION_ID as Config: the UUID of the intended workspace
   from the administrator's Supabase profile membership. Do not invent it, use the
   Supabase project reference, or copy an ID from another environment.
4. Confirm NEXT_PUBLIC_APP_URL is `https://ca-crm-theta.vercel.app`, without `/login`.
5. Check the Gmail variables and the exact label ID below.
6. Save and redeploy. Do not rerun admin bootstrap or reset the database.

| Gmail key | Expected value/source |
| --- | --- |
| GMAIL_CLIENT_ID | Your created OAuth Web application Client ID |
| GMAIL_CLIENT_SECRET | Current, unexposed Client Secret |
| GMAIL_REFRESH_TOKEN | Current token for the same OAuth client and demo mailbox |
| GMAIL_SENDER | choudharidarshan5453@gmail.com |
| GMAIL_INTAKE_LABEL_ID | Label_8914613925540105993 |

Gmail secrets remain server-only; do not add NEXT_PUBLIC_ prefixes. The intake label
limits this application's polling, but gmail.modify itself is a broader mailbox
permission. It is not a Google-enforced label-only permission boundary.

Google External apps in Testing normally receive seven-day refresh tokens for
these Gmail scopes. If expired or revoked, repeat consent and update the token.
Publishing/verification is a separate production-readiness decision, not a workaround
to click through without reviewing Google's requirements.

## 9. Schedule the worker with n8n

Use your existing n8n instance or a suitable scheduler with private header storage.
Do not activate the original full automation workflow as well as this native CRM.

1. Create a workflow named **CA CRM worker**.
2. Add **Schedule Trigger**.
3. Choose Minutes; set the interval to **1 minute**.
4. Set the workflow timezone to **Asia/Kolkata**.
5. Add and connect an **HTTP Request** node.
6. Set Method to GET and URL to:

   `https://ca-crm-theta.vercel.app/api/cron/crm`

7. Configure Generic Credential Type -> Header Auth using private credentials:
   - Header name: `Authorization`
   - Header value: `Bearer YOUR_CRON_SECRET`
   Replace the placeholder with your secret. Keep the single space after Bearer.
8. Leave CRM intake OFF. Manually execute the HTTP Request once.
9. Expect HTTP 200 and `{"paused":true}`. This confirms route authorization and
   paused settings access, **not** Gmail/Groq/WhatsApp connectivity.
10. Save and publish/activate the workflow. Check recurring successful executions.

Do not put secrets in the URL, a public workflow export, notes or screenshots.
Vercel Hobby cron runs at most once daily and cannot provide this one-minute
schedule. Check current plan limits before choosing Vercel Cron instead of n8n.

401 means missing/mismatched authorization. 503 means inspect environment, tenant,
database migration and worker logs. Avoid blindly retrying outbound sends when
provider acceptance or delivery is uncertain.

## 10. Prepare a controlled review-only pilot

1. Prefer a separate demo deployment and database. The office workspace may already
   contain real clients and pending work; a test switch is not a sandbox boundary.
2. Open CRM -> Automation centre as Administrator.
3. Inspect pending outbound jobs and records before unpausing. Do not approve old jobs.
4. Add firm-approved support knowledge: services, contact details, required documents
   and FAQs. Do not put credentials, confidential client files or guessed statutory
   deadlines into this text.
5. Keep **Automatically send factual reminders** OFF.
6. Keep **Allow automatic general AI replies** OFF.
7. Record communication permission only for the exact consenting demo recipients.
8. Confirm the worker schedule's paused response before proceeding.

Enabling intake can create real work and drafts. Review-only means automatic sends
are disabled; it does not prevent a staff-approved queued message from being sent.

## 11. Test Gmail intake and Groq from the deployed CRM

1. From a SECOND account you control or a consenting tester, email the demo mailbox.
2. Subject: **CA CRM Demo enquiry**. Body example: **This is a test. What documents
   are needed to discuss bookkeeping services? Please prepare a reply for review.**
3. Manually label only this received enquiry **CA-CRM-Demo**.
4. In Automation Centre, enable **Enable intake and worker** only. Save the controls.
5. Keep both automatic-send checkboxes OFF.
6. Wait for the next worker execution or run the scheduler's authenticated request once.
7. Inspect the execution log for Gmail/AI failures and look for the imported enquiry
   and its reviewed-response queue in Automation Centre / Support.
8. Confirm a draft relates to the exact dummy enquiry and uses approved knowledge.
9. Confirm the Gmail intake label is removed after successful handling; the email
   should remain in Gmail. Reprocessing must not duplicate the CRM enquiry.

Do not use the earlier self-sent email for this test. Self-senders, bulk/list mail
and automated responses are skipped by the loop guard.

If no enquiry appears: check sender address, label ID, enabled/saved setting,
scheduler execution, deployed refresh token and organization routing. A successful
Playground request alone does not verify Vercel's saved OAuth values.

## 12. Test one reviewed outbound email

1. Use only a consenting demo recipient with recorded permission.
2. Review the draft, recipient and wording yourself.
3. Use the application's review/approve/send control for that exact message.
4. Run/wait for the worker and check its outbound log.
5. Verify the recipient actually receives the email, including checking Spam.
6. Confirm only one message arrives. Do not resubmit an uncertain send before checking.

Accepted/queued is not delivered. Do not enable blanket automatic replies after
one credential check. Personalized tax/legal advice must remain professionally reviewed.

## 13. Test WhatsApp intake and reviewed sending

1. Confirm the webhook subscription and compatible approved template are ready.
2. From the verified consenting recipient, send a dummy enquiry to the Meta test sender.
3. With intake enabled and auto-send settings OFF, inspect the CRM inbound item.
4. Review the recipient, consent and proposed response. Approve only that demo message.
5. Let the worker process it.
6. Confirm actual receipt on the phone and delivery/read callbacks in the CRM log.
7. If failed, inspect the provider error, token expiry, number IDs, template/language,
   recipient eligibility and app/account requirements. Do not repeatedly queue duplicates.

Inbound attachment metadata does not prove document collection/verification. Use
the private upload-link workflow for the document test below.

## 14. Test document collection

1. Create a dummy client and a document request in CRM -> Documents.
2. Generate its private one-use upload link in Automation Centre.
3. Open the link in a private window and upload a harmless dummy document.
4. Confirm it appears against the correct request for staff verification.
5. Review/accept or reject it as staff; upload alone is not authenticity verification.
6. Confirm reusing a completed one-use link is rejected.
7. Verify a received document no longer produces missing-document follow-ups.

No OCR key is needed for this flow. Automated authenticity checks and Gmail binary
attachment import are not implemented by this setup.

## 15. Test compliance and invoice reminders

1. Use dummy records and a consenting test recipient only.
2. Enter deliberately chosen test due dates. Real GST/ITR/ROC dates must be checked by staff.
3. Confirm reminders show the correct client, due date, document state or invoice balance.
4. Keep automatic factual reminders OFF while reviewing the first messages.
5. For an invoice, record a test partial payment using the authorized manual workflow
   and check the remaining balance. Do not enter fake payments on a real invoice.
6. Confirm payment completion/filing/document receipt stops the corresponding reminder.
7. Verify duplicate source events do not generate duplicate payments or sends.

Native reminder windows use the workspace timezone: compliance 09:00, documents
09:30, leads 10:00, invoice follow-ups 10:30. A running scheduler and matching
record eligibility are required; pressing refresh does not trigger those schedules.

## 16. Website enquiries and payment gateways - not just configuration

The signed bridge exists at `/api/integrations/crm`, but provider-specific website
and payment adapters still require implementation and testing.

Website next steps: identify the actual form/backend, configure a separate
CRM_WEBHOOK_SECRET, and implement server-side signed events. Do not expose this
secret in website JavaScript. A public AI chat widget is not created by these settings.

Payment next steps: choose a gateway and sandbox, verify its signatures/status and
currency server-side, map its payment to a CRM invoice, then forward a signed CRM
event. Test partial/final/duplicate events. Do not put the generic CRM endpoint
directly into a gateway dashboard and assume the payloads are compatible.

HMAC payload and event contract: see `docs/automation-activation.md`.
No actual filing with GST/ITR/ROC portals or payment processing is enabled here.

## 17. Optional Telegram escalation

Skip this if partner alerts are not needed for the demo.

1. Open Telegram and find the verified BotFather account.
2. Use `/newbot` and complete its prompts.
3. Save the bot token privately as TELEGRAM_BOT_TOKEN in Vercel.
4. Open your bot and press Start; send a harmless test message.
5. Privately inspect the Bot API getUpdates response and copy the intended chat ID
   into TELEGRAM_PARTNER_CHAT_ID. Never screenshot/share a URL containing a bot token.
6. Redeploy and test one alert to your own chat with deliberate permission.

## 18. Go-live checklist and stop procedure

- [ ] Deployed Gmail intake and reviewed send actually succeeded.
- [ ] Groq generated an appropriate CRM draft; key/model/quota verified.
- [ ] WhatsApp signature verification, real inbound event and received outbound message verified.
- [ ] Approved template and explicit recipient permissions checked.
- [ ] Scheduler execution logs are healthy; failures are monitored.
- [ ] Pending queues reviewed; no accidental real recipients.
- [ ] Document upload, review and one-use protection checked.
- [ ] Reminder cancellation and payment balance behavior tested with dummy records.
- [ ] Exposed credentials replaced; token expiry/renewal ownership assigned.
- [ ] Staff understand AI limitations and review obligations.

Only after deliberate sign-off enable factual auto-reminders, then separately
consider general AI replies grounded in approved knowledge. Keep personalized
advice and escalations under staff review. Check pilot volume before scaling.

To stop: uncheck Enable intake and worker, save, and pause the scheduler. Also turn
off both automatic-send toggles. Inspect already in-flight messages separately:
pausing cannot retract a message already submitted to a provider.

## Reference links

- Meta application dashboard: https://developers.facebook.com/apps/
- Meta Cloud API guide: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
  (the documentation fetch was rate-limited during preparation; confirm changing UI
  labels and account eligibility in your own dashboard).
- Google OAuth token lifecycle: https://developers.google.com/identity/protocols/oauth2/
- n8n Schedule Trigger: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/
- Vercel cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Detailed existing setup guide: `docs/configuration-baby-steps.md`

This document records instructions and observed setup progress, not a certificate
that every external integration or real-client workflow is live and verified.
# Authkey demo update

The approved Authkey leave template is now supported for explicit reviewed sends. Follow [Authkey demo setup](authkey-demo-setup.md) for current variables and testing. The Meta setup above applies only when selecting the Meta provider. Authkey inbound enquiries, general reminders, and delivery callbacks are not configured by adding an API key.
