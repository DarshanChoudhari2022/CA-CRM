"use client";
import { useActionState, useState } from "react";
import { supportDraft, supportSend } from "./support-actions";
export function SupportTools({ id, admin }: { id: string; admin: boolean }) {
  const [draft, draftAction, drafting] = useActionState(supportDraft, {});
  const [sent, sendAction, sending] = useActionState(supportSend, {});
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <details>
      <summary>AI draft & messaging</summary>
      <form action={draftAction}>
        <input type="hidden" name="id" value={id} />
        <button className="button button-secondary" disabled={drafting} type="submit">
          {drafting ? "Drafting…" : "Draft reply with Groq"}
        </button>
      </form>
      {draft.error && <p role="alert">{draft.error}</p>}
      {draft.draft && (
        <>
          <p className="stat-note">AI draft — verify before using.</p>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{draft.draft}</pre>
        </>
      )}
      {admin && (
        <form className="form-grid section" action={sendAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="requestId" value={requestId} />
          <label>
            Channel
            <select name="channel">
              <option value="gmail">Gmail</option>
              <option value="whatsapp">WhatsApp approved template</option>
            </select>
          </label>
          <label>
            Recipient
            <input name="recipient" required placeholder="Email or +country phone" />
          </label>
          <label className="full">
            Subject
            <input name="subject" required maxLength={160} />
          </label>
          <label className="full">
            Reviewed message
            <textarea key={draft.draft} name="body" defaultValue={draft.draft} required maxLength={4000} />
          </label>
          <label className="full">
            <input type="checkbox" name="confirmed" value="yes" required /> I reviewed this message and have permission
            to contact this recipient.
          </label>
          <p className="stat-note full">WhatsApp uses the configured approved template with one body variable.</p>
          {sent.error && (
            <p className="full" role="alert">
              {sent.error}
            </p>
          )}
          {sent.success && (
            <p className="full" role="status">
              {sent.success}
            </p>
          )}
          <button className="button button-primary" type="submit" disabled={sending || Boolean(sent.success)}>
            {sending ? "Sending…" : "Send reviewed message"}
          </button>
        </form>
      )}
    </details>
  );
}
