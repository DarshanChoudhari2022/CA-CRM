# CA CRM: demo configuration, step by step

Updated 14 October 2026. Demo mailbox: **choudharidarshan5453@gmail.com**. Do not authorize or change the official office mailbox for this demo.

Application code and the automation database migration are already delivered. External accounts, consent, tokens and scheduler activation still need configuration. Provider-mocked tests are not proof of real email/WhatsApp delivery. The website and payment bridges also need connecting code (section 8).

## 1. Where to enter settings

1. Open [Vercel](https://vercel.com/dashboard), select **ca-crm**, then **Settings → Environment Variables**.
2. Enter each variable below individually. Public `NEXT_PUBLIC_` values are **Config**, not Secret. Tokens/client secrets/refresh tokens/service-role keys are server-only secrets; never add a public prefix.
3. Select **Production** only if deliberately configuring the live deployment. Do not copy live sending credentials into every Preview deployment. A separate demo deployment and Supabase project is preferable for automatic-send testing.
4. Save, then open **Deployments → latest production deployment → Redeploy**. Environment changes do not change an already-built deployment. [Vercel environment documentation](https://vercel.com/docs/environment-variables).
5. Local development uses ignored `.env.local`; Vercel does not read that local file. Never upload it to GitHub or paste secrets into chat.

Existing core values to check, not blindly replace:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://ostvciecjwbzyzzyksnf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<existing project publishable key>
SUPABASE_SERVICE_ROLE_KEY=<existing server-only service-role key>
NEXT_PUBLIC_APP_URL=https://ca-crm-theta.vercel.app
CRM_AUTOMATION_ORGANIZATION_ID=46c6a781-d4fb-464f-aee3-0b7a016470b8
```

The organization ID above was read from the existing office administrator's membership. It is the **existing workspace**, not an isolated demo tenant. Do not use that ID with a different database. The app URL is the origin only: no `/login`.

In [Supabase](https://supabase.com/dashboard/project/ostvciecjwbzyzzyksnf), **Authentication → URL Configuration**, check the production Site URL matches that origin. Do not reset the database or rerun the admin bootstrap; existing accounts must remain intact. `SUPABASE_DB_URL` is only needed locally for migration/test scripts, not deployed request handlers. Rotate previously exposed database/service-role credentials through a coordinated update of their consumers.

## 2. Create three independent random secrets

Use a password manager to generate three different random 64-character hexadecimal strings. Store them in the password manager and Vercel:

| Variable | Also used where? |
| --- | --- |
| `CRON_SECRET` | Scheduler's private Authorization header |
| `CRM_WEBHOOK_SECRET` | Trusted website/payment backend only; can defer until connecting those backends |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta webhook verification form |

Do not use your login password, Supabase key, or the same string for all three. These are values you generate, not keys purchased from another provider.

## 3. Groq: AI drafting

1. Sign in to [Groq API Keys](https://console.groq.com/keys).
2. Create a key for this demo; copy it privately into `GROQ_API_KEY` in Vercel.
3. Set `GROQ_MODEL=openai/gpt-oss-120b`, provided the model is enabled for your account. Check account limits and model permissions in the Groq console.
4. Redeploy after entering all provider settings. First test an AI draft in review mode, not an automatic client reply.

The older `llama-3.3-70b-versatile` was retired for free/developer tiers; do not copy old tutorials using it. The replacement still requires a live application test with your key. [Groq deprecations](https://console.groq.com/docs/deprecations).

## 4. Gmail: your personal demo mailbox

### A. Create the Google application

1. Sign into [Google Cloud Console](https://console.cloud.google.com/) using **choudharidarshan5453@gmail.com**.
2. Create a project named `PSB CRM Demo`.
3. Under **APIs & Services → Library**, find **Gmail API** and enable it.
4. Open **Google Auth Platform** (or OAuth consent screen). Fill in the app name and your own support/contact email.
5. Choose **External** audience for this personal Gmail account. While Testing, add **choudharidarshan5453@gmail.com** as a test user.
6. Under **Clients**, create an OAuth client of type **Web application**.
7. Add this exact authorized redirect URI: `https://developers.google.com/oauthplayground`.
8. Save the Client ID and Client Secret privately as `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` in Vercel.

### B. Authorize the mailbox

1. Open [Google OAuth Playground](https://developers.google.com/oauthplayground/).
2. Open its settings gear. Enable **Use your own OAuth credentials**, enter the client ID/secret just created, and use **Offline** access.
3. In Step 1 enter these two scopes, separated by a space:

   ```text
   https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify
   ```

4. Click **Authorize APIs**, choose **choudharidarshan5453@gmail.com**, and consent to your own demo app. Never select the office account.
5. In Step 2 click **Exchange authorization code for tokens**.
6. Copy the **refresh token**, not the access token, into Vercel as `GMAIL_REFRESH_TOKEN`.
7. Set `GMAIL_SENDER=choudharidarshan5453@gmail.com`.

External apps in Testing normally get refresh tokens that expire after **7 days** with these Gmail scopes. That is acceptable for a short demo; repeat authorization if it expires. Production requires appropriate publishing, verification and policy review—not merely a long-lived pasted token. [Google OAuth lifecycle](https://developers.google.com/identity/protocols/oauth2).

### C. Limit which emails the CRM reads

1. In that Gmail account, create a label named **CA-CRM-Demo**.
2. For the first demo, manually apply the label to ONE test enquiry from another mailbox you control or a consenting tester. Do not label your entire inbox. Self-sent messages are intentionally ignored by the loop guard.
3. In OAuth Playground Step 3, make a **GET** request to `https://gmail.googleapis.com/gmail/v1/users/me/labels`.
4. Find `CA-CRM-Demo` in the response and copy its `id`, such as `Label_123456789`.
5. Set `GMAIL_INTAKE_LABEL_ID` to that ID, not the display name. [Gmail label listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/list).
6. Only later add a narrow Gmail filter for agreed demo senders/subjects. Never create an all-mail intake filter.

Expected result after the worker is enabled: the test enquiry appears in the CRM inbox, an AI draft is prepared, and the intake label is removed after processing. Removing the label does not delete the email. Binary Gmail attachment import is not implemented; use document upload links.

## 5. WhatsApp: begin with Meta's test number

1. Open [Meta for Developers](https://developers.facebook.com/apps/). Create/select your business app and add the WhatsApp use case/product.
2. Open WhatsApp API setup. Begin with the provided test sender and add/verify your own recipient number. Do not migrate or disconnect the firm's existing WhatsApp number for a demo.
3. Save the setup values below in Vercel. Temporary test access tokens expire; do not confuse them with a production system-user token.

| Variable | Source/value |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Meta test token initially; later an appropriately permissioned system-user token |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID in API setup, not the phone number itself |
| `WHATSAPP_GRAPH_VERSION` | Supported version shown in Meta's generated API example, including `v` |
| `WHATSAPP_APP_SECRET` | App Settings → Basic → App Secret |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Your separately generated random verification secret |
| `WHATSAPP_TEMPLATE_NAME` | Your approved template with exactly one positional body parameter |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Exact approved language code, e.g. `en` only if approved as English |

4. In WhatsApp Manager, submit an appropriate template containing exactly one body variable `{{1}}`, with realistic sample content. The application fills this variable with the message. Meta decides approval/category; a generic template is not guaranteed approval. The zero-variable `hello_world` template is **not** compatible with this application's one-variable send adapter.
5. Redeploy Vercel before verifying the webhook.
6. In Meta WhatsApp webhook configuration enter:

   ```text
   Callback URL: https://ca-crm-theta.vercel.app/api/integrations/whatsapp
   Verify token: the exact WHATSAPP_WEBHOOK_VERIFY_TOKEN value
   ```

7. Verify/save, then subscribe the app to **messages** events. Check that the intended WhatsApp Business Account is subscribed.
8. Send one test message from the approved recipient. With intake enabled it should appear in the CRM inbox. Enable a test reply only once the template and recipient permission are ready.

Before real use, complete Meta's business/number requirements, billing where required, asset assignment and appropriate messaging permissions. Tokens can expire or be revoked. Never treat API acceptance as proof of delivery: inspect delivery callbacks. [Meta Cloud API reference](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## 6. Scheduler: make the automation run

The application needs a server calling its worker; opening the dashboard does not start a scheduler. Use an existing n8n instance if available. Do not activate the original 152-node Google Sheets workflow alongside this native implementation.

1. Create a small n8n workflow named **CA CRM worker**.
2. Add **Schedule Trigger**: interval **Minutes**, every **1** minute. Set workflow timezone to **Asia/Kolkata**.
3. Connect an **HTTP Request** node: method **GET**; URL `https://ca-crm-theta.vercel.app/api/cron/crm`.
4. Select **Generic Credential Type → Header Auth**. Create a credential with name `Authorization` and value `Bearer YOUR_CRON_SECRET` (replace the placeholder privately; retain the single space after Bearer).
5. Do not put the secret in URL query parameters, workflow notes, or screenshots.
6. Keep the CRM paused and execute a manual test. Expect a successful response indicating paused/skipped work, not 401/500.
7. Save/publish the n8n workflow. Confirm recurring successful executions before unpausing the CRM.

Publishing and workflow timezone matter. [n8n schedule trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/), [Header Auth credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/).

Vercel Hobby cron cannot supply the required every-minute schedule; use a suitable external scheduler or an eligible hosting plan. Check scheduler costs before purchasing. Default worker throughput is a conservative pilot limit: up to one email, one AI task and two outbound messages per call, with 20 outbound messages per organization/hour. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## 7. Optional Telegram partner alerts

1. In Telegram, open the verified **@BotFather** and send `/newbot`.
2. Choose a name/unique bot username. Save the returned token privately as `TELEGRAM_BOT_TOKEN`.
3. Open your new bot and press **Start**, then send a test message.
4. Using a private API client, call `GET https://api.telegram.org/bot<TOKEN>/getUpdates` and copy your message's `chat.id` into `TELEGRAM_PARTNER_CHAT_ID`. Do not share the request URL because it contains the token.
5. Redeploy. Test an alert to your own chat; skip this integration if you do not want Telegram alerts.

[Telegram bot tutorial](https://core.telegram.org/bots/tutorial), [Bot API](https://core.telegram.org/bots/api).

## 8. Website and payment connections: development still required

**Website:** provide the website repository/form location. Its backend must send a signed event to `https://ca-crm-theta.vercel.app/api/integrations/crm`. The bridge is implemented; a browser chat widget or form adapter is not. Never embed `CRM_WEBHOOK_SECRET` in frontend code.

**Payments:** choose your gateway and sandbox account first. A provider-specific backend adapter must validate its signature, successful status and currency, map the CRM invoice, then forward a signed payment event. Do not paste this CRM endpoint directly into an arbitrary gateway's webhook form. No gateway-specific key names are defined until that adapter is implemented. Manual payments remain available.

**Document collection:** no additional AI/OCR key is needed for private upload links. Create a document request and generate its one-use link; the client uploads, then staff verify it. OCR/authenticity checks and automatic statutory filing are not implemented.

Developer payloads and HMAC contract: [automation activation](automation-activation.md#signed-integration-contract).

## 9. Safe demo acceptance checklist

1. Open [Automation Centre](https://ca-crm-theta.vercel.app/crm/automation-center) as an administrator.
2. Keep automatic outbound sends and automatic AI replies **off**. Configure approved knowledge and use only dummy clients/test data.
3. Do not grant blanket recipient permissions. Add permission only for the exact test email/WhatsApp recipient.
4. Enable intake/unpause only when ready. The scheduler can process existing workspace records; for isolated automatic-send tests, use a separate demo deployment/database instead of the firm's live workspace.
5. Label one test Gmail enquiry; confirm intake and a draft. Review before sending any message.
6. Test one consenting WhatsApp recipient. Confirm actual received message and delivery state, not only a queued/accepted result.
7. Upload one dummy document through its private link; verify a second use is rejected. Staff review it.
8. Test a dummy deadline/invoice reminder without contacting real clients. Do not invent actual statutory dates.
9. Payment sandbox testing follows adapter implementation; test partial, final and duplicate events before real payments.
10. Check execution logs and pause when finished. Do not turn everything on just because credentials are saved.

No new OpenAI API key, Google Sheets key, payroll API or GST filing API is required by this implementation. A Groq-hosted model whose name contains `openai/` still uses the **Groq** key.
