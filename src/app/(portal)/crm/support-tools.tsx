"use client";
import { useActionState, useState } from "react";
import { checkGmailConnection, supportDraft, supportSend } from "./support-actions";
export function SupportTools({ id, admin, authkey = false }: { id: string; admin: boolean; authkey?: boolean }) {
  const [channel, setChannel] = useState("gmail");
  const leave = authkey && channel === "whatsapp";
  const [draft, draftAction, drafting] = useActionState(supportDraft, {});
  const [sent, sendAction, sending] = useActionState(supportSend, {});
  const [requestId] = useState(() => crypto.randomUUID());
  const [connection, checkConnection, checking] = useActionState(checkGmailConnection, {});
  return (
    <details>
      <summary>AI draft & messaging</summary>
      {admin && (
        <form action={checkConnection}>
          <button className="button button-secondary" disabled={checking} type="submit">
            {checking ? "Checking Gmail…" : "Check Gmail connection"}
          </button>
          {connection.error && <p role="alert">{connection.error}</p>}
          {connection.success && <p role="status">{connection.success}</p>}
        </form>
      )}
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
            <select name="channel" onChange={(event) => setChannel(event.target.value)}>
              <option value="gmail">Gmail</option>
              <option value="whatsapp">WhatsApp approved template</option>
            </select>
          </label>
          <label>
            Recipient
            <input name="recipient" required placeholder="Email or +country phone" />
          </label>
          {leave && (
            <>
              <label>
                Employee name
                <input name="leaveName" required maxLength={100} />
              </label>
              <label>
                Leave dates
                <input name="leaveDates" required maxLength={160} placeholder="26 October to 27 October 2026" />
              </label>
              <label>
                Decision
                <select name="leaveStatus">
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
              <input type="hidden" name="body" value="Reviewed leave update" />
              <p className="stat-note full">Sends the approved leave-update template using these three values.</p>
            </>
          )}
          <label className="full">
            Subject
            <input name="subject" required maxLength={160} />
          </label>
          {!leave && (
            <label className="full">
              Reviewed message
              <textarea key={draft.draft} name="body" defaultValue={draft.draft} required maxLength={4000} />
            </label>
          )}
          <label className="full">
            <input type="checkbox" name="confirmed" value="yes" required /> I reviewed this message and have permission
            to contact this recipient.
          </label>
          {!authkey && (
            <p className="stat-note full">WhatsApp uses the configured approved template with one body variable.</p>
          )}
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
