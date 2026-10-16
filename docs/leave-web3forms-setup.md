# Leave applications to the PSB website mailbox

Leave submissions use the same Web3Forms endpoint and browser transport as the PSB
website Contact and Careers forms. The receiving mailbox is selected by the
Web3Forms key, not the employee email or a Gmail password.

1. Use the value of `WEB3FORMS_ACCESS_KEY` from the PSB website environment.
2. In CRM configure `LEAVE_WEB3FORMS_ACCESS_KEY` with the same value. Alternatively,
   set `WEB3FORMS_ACCESS_KEY`; the dedicated leave setting takes precedence.
3. Restart local Next.js after editing `.env.local`. For Vercel, configure the
   intended Production / Preview environments and redeploy for changes to apply.
4. If the key has domain restrictions, permit the deployed CRM origin in the
   Web3Forms dashboard as well as the existing website origin.
5. An employee opens Attendance → Leave, fills the request and selects Send for
   approval. Only a successfully saved request prepares an email; an invalid or
   rejected request never sends one.
6. The email includes employee name and reply-to address, leave type, dates,
   working days, reason and request reference. It goes to the mailbox verified for
   the same website key. It does not approve the leave automatically.
7. Administrator → Attendance → Approvals → Office leave emails shows provider
   acceptance and retry controls. Provider acceptance is not proof of inbox receipt;
   check inbox/spam before retrying an uncertain delivery.

No Gmail OAuth, SMTP password or new notification database migration is needed
when the existing `20261016103000_leave_email_notifications` migration is installed.
Keep `LEAVE_WEB3FORMS_SERVER_ENABLED=false` for the browser-based/free-plan flow.
Unattended server sending requires a suitable paid Web3Forms plan and IP allowlisting.
Keys stay in ignored local files or Vercel environment configuration, not Git.

Official provider reference: https://docs.web3forms.com/getting-started/api-reference
