import { gmailAccessToken, gmailRequest as providerRequest } from "../gmail-connection";
import { ingest } from "./store";

type Part = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: Part[] };
export function emailText(part: Part): string {
  if (part.filename) return "";
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8").slice(0, 10000);
  return (part.parts ?? []).map(emailText).join("\n").slice(0, 10000);
}
async function gmailRequest(token: string, path: string, init: RequestInit = {}) {
  return providerRequest(
    `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
    {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    },
    "intake",
  );
}
export async function pollGmail() {
  // Dedicated inbound label is mandatory: never scan the entire personal mailbox.
  const label = process.env.GMAIL_INTAKE_LABEL_ID?.trim();
  if (!label) return 0;
  const token = await gmailAccessToken();
  const list = await gmailRequest(token, `messages?labelIds=${encodeURIComponent(label)}&maxResults=1`);
  let count = 0;
  for (const item of list.messages ?? []) {
    const msg = await gmailRequest(token, `messages/${encodeURIComponent(item.id)}?format=full`);
    const header = (name: string) =>
      (msg.payload.headers as { name: string; value: string }[]).find((h) => h.name.toLowerCase() === name)?.value ??
      "";
    const from = header("from");
    const sender = (from.match(/<([^<>]+)>/)?.[1] ?? from).trim().toLowerCase();
    // Ignore automated responses and our own sends to prevent reply loops.
    if (
      /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender) &&
      sender !== process.env.GMAIL_SENDER?.toLowerCase() &&
      !header("auto-submitted") &&
      !/bulk|list|junk/i.test(header("precedence"))
    ) {
      await ingest(
        "gmail",
        msg.id,
        sender,
        from.split("<")[0].trim().slice(0, 200),
        `${header("subject")}\n${emailText(msg.payload) || "Email has no plain-text body; staff review required."}`.slice(
          0,
          12000,
        ),
      );
      count++;
    }
    // Remove intake label only after durable ingestion; retries deduplicate by Gmail id.
    await gmailRequest(token, `messages/${encodeURIComponent(msg.id)}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: [label] }),
    });
  }
  return count;
}
