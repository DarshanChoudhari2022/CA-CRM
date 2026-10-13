"use client";

import { useActionState, useRef } from "react";
import { agentKinds } from "@/modules/ai/domain";
import {
  createWorkpaper,
  prepareWorkpaper,
  reviewReference,
  reviewWorkpaper,
  saveReference,
  type WorkpaperState,
} from "./actions";

function Feedback({ state }: { state: WorkpaperState }) {
  return (
    <>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
    </>
  );
}

export function BriefForm({ clients }: { clients: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(createWorkpaper, {});
  const requestId = useRef("");
  return (
    <form
      action={action}
      className="form-grid"
      onSubmit={(event) => {
        requestId.current ||= crypto.randomUUID();
        const field = event.currentTarget.elements.namedItem("requestId") as HTMLInputElement;
        field.value = requestId.current;
      }}
    >
      <input type="hidden" name="requestId" defaultValue="" />
      <label>
        Specialist
        <select name="kind">
          {Object.entries(agentKinds).map(([kind, agent]) => (
            <option key={kind} value={kind}>
              {agent.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Client
        <select name="clientId">
          <option value="">General firm work</option>
          {clients.map((client) => (
            <option value={client.id} key={client.id}>
              {client.title}
            </option>
          ))}
        </select>
      </label>
      <label className="full">
        Workpaper title
        <input name="title" minLength={3} maxLength={160} required />
      </label>
      <label>
        Jurisdiction
        <input name="jurisdiction" defaultValue="India" maxLength={120} required />
      </label>
      <label>
        Reporting period
        <input name="period" placeholder="e.g. FY 2026-27" maxLength={120} required />
      </label>
      <label className="full">
        What needs to be prepared?
        <textarea
          name="brief"
          minLength={20}
          maxLength={6000}
          rows={5}
          placeholder="Describe the requirement, relevant facts and the output you need."
          required
        />
      </label>
      <div className="full">
        <Feedback state={state} />
        <button className="button button-primary" type="submit" disabled={pending || Boolean(state.success)}>
          {pending ? "Saving…" : "Save workpaper"}
        </button>
        {state.success && (
          <button className="button button-secondary" type="button" onClick={() => window.location.reload()}>
            Create another
          </button>
        )}
      </div>
    </form>
  );
}

export function PrepareForm({ id, ready }: { id: string; ready: boolean }) {
  const [state, action, pending] = useActionState(prepareWorkpaper, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Feedback state={state} />
      <button className="button button-primary" type="submit" disabled={pending || !ready}>
        {pending ? "Preparing draft…" : "Prepare AI draft"}
      </button>
    </form>
  );
}

export function ReviewForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(reviewWorkpaper, {});
  return (
    <form action={action} className="section">
      <input type="hidden" name="id" value={id} />
      <label className="field">
        Review note
        <textarea name="note" minLength={10} maxLength={2000} required rows={3} />
      </label>
      <Feedback state={state} />
      <div className="ai-actions">
        <button type="submit" className="button button-primary" name="decision" value="approved" disabled={pending}>
          Approve workpaper
        </button>
        <button type="submit" className="button button-danger" name="decision" value="rejected" disabled={pending}>
          Reject draft
        </button>
      </div>
    </form>
  );
}

export function ReferenceForm() {
  const [state, action, pending] = useActionState(saveReference, {});
  return (
    <form action={action} className="form-grid">
      <label className="full">
        Reference title
        <input name="title" minLength={3} maxLength={160} required />
      </label>
      <label className="full">
        Source link
        <input name="url" type="url" placeholder="https://" required />
      </label>
      <label>
        Jurisdiction
        <input name="jurisdiction" defaultValue="India" maxLength={120} required />
      </label>
      <label>
        Review again by
        <input name="validUntil" type="date" required />
      </label>
      <label className="full">
        Verified extract / firm policy
        <textarea name="content" minLength={20} maxLength={8000} required rows={4} />
      </label>
      <div className="full">
        <Feedback state={state} />
        <button className="button button-secondary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save reference for review"}
        </button>
      </div>
    </form>
  );
}

export function ReferenceReview({ id, approved }: { id: string; approved: boolean }) {
  const [state, action, pending] = useActionState(reviewReference, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Feedback state={state} />
      <button
        name="state"
        value={approved ? "retired" : "approved"}
        type="submit"
        className="button button-secondary"
        disabled={pending}
      >
        {approved ? "Retire reference" : "Approve reference"}
      </button>
    </form>
  );
}
