export class GmailProviderError extends Error {}

const tokenErrors: Record<string, string> = {
  invalid_grant:
    "Google rejected the refresh token (invalid_grant). Generate it using the same OAuth client saved in Vercel, update GMAIL_REFRESH_TOKEN, and redeploy.",
  invalid_client:
    "Google rejected the OAuth client (invalid_client). Check GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET belong to the same Google Cloud client, then redeploy.",
  unauthorized_client:
    "Google has not authorized this OAuth client (unauthorized_client). Check the web application OAuth client and its consent settings.",
  invalid_request:
    "Google rejected the token request (invalid_request). Check the three Gmail OAuth variables are complete and contain only their values.",
};

export async function gmailRequest(
  url: string,
  init: RequestInit,
  stage: "authorization" | "profile" | "send" | "intake",
) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new GmailProviderError(
      stage === "send"
        ? "Gmail send connection timed out or failed. Delivery is uncertain; check Gmail Sent before resending."
        : `Gmail ${stage} connection failed before sending. Check connectivity and try the connection check again.`,
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (stage === "authorization")
      throw new GmailProviderError(
        tokenErrors[typeof result?.error === "string" ? result.error : ""] ||
          `Google authorization failed (HTTP ${response.status}). Check the OAuth configuration.`,
      );
    const reason = result?.error?.errors?.[0]?.reason;
    const status = result?.error?.status;
    if (stage === "intake" && response.status === 400)
      throw new GmailProviderError(
        "Gmail rejected the intake request (HTTP 400). Check GMAIL_INTAKE_LABEL_ID is the internal label ID from this authorized mailbox, without spaces.",
      );
    if (response.status === 403 && (reason === "accessNotConfigured" || status === "SERVICE_DISABLED"))
      throw new GmailProviderError("Gmail API is disabled for this OAuth project. Enable Gmail API in Google Cloud.");
    if (response.status === 403 && (reason === "insufficientPermissions" || status === "PERMISSION_DENIED"))
      throw new GmailProviderError(
        "Google denied Gmail access. Reauthorize with the required Gmail scopes and update the refresh token.",
      );
    throw new GmailProviderError(
      `Gmail ${stage} failed (HTTP ${response.status}). Check the OAuth account, scopes and Gmail API settings.`,
    );
  }
  if (!result || typeof result !== "object")
    throw new GmailProviderError(
      `Gmail ${stage} returned an unreadable response. Check the provider before resending.`,
    );
  return result;
}

export async function gmailAccessToken(): Promise<string> {
  const values = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"].map(
    (key) => process.env[key]?.trim() || "",
  );
  if (values.some((value) => !value))
    throw new GmailProviderError(
      "Gmail OAuth configuration is incomplete. Check the three Gmail OAuth variables in Vercel.",
    );
  const result = await gmailRequest(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: values[0],
        client_secret: values[1],
        refresh_token: values[2],
        grant_type: "refresh_token",
      }),
    },
    "authorization",
  );
  if (typeof result.access_token !== "string" || !result.access_token)
    throw new GmailProviderError("Google did not return an access token. Check the OAuth configuration.");
  return result.access_token;
}

export async function verifyGmailConnection(): Promise<void> {
  const token = await gmailAccessToken();
  const profile = await gmailRequest(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    "profile",
  );
  const sender = process.env.GMAIL_SENDER?.trim().toLowerCase();
  if (!sender || typeof profile.emailAddress !== "string" || profile.emailAddress.toLowerCase() !== sender)
    throw new GmailProviderError(
      "The authorized Gmail account does not match GMAIL_SENDER. Reauthorize the intended mailbox or correct GMAIL_SENDER and redeploy.",
    );
}
