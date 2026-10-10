"use client";
import { useActionState } from "react";
import { changePassword } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {});
  return (
    <form action={action}>
      <h2>Set your password</h2>
      <p>Choose a private password for your account.</p>
      {state.error && (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="password">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="confirm">Confirm password</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          required
        />
      </div>
      <button type="submit" className="button button-primary" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
