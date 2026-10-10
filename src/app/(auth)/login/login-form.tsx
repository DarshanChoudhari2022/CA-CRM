"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="auth-form">
      <span className="eyebrow">Internal portal</span>
      <h2>Welcome back.</h2>
      <p>Sign in with your PSB work account.</p>
      {state.error && (
        <div className="form-error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button
        className="button button-primary"
        type="submit"
        disabled={pending}
        style={{ width: "100%", marginTop: 8 }}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p style={{ fontSize: 13, marginTop: 18 }}>
        Access is invitation-only. Contact your administrator if your account is not active.
      </p>
    </form>
  );
}
