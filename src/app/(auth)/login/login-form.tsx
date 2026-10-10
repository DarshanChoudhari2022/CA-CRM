"use client";

import { useState } from "react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="auth-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setPending(true);
        const form = new FormData(event.currentTarget);
        try {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
          });
          const body = await response.json();
          if (!response.ok) setError(body.error ?? "We could not sign you in.");
          else window.location.assign("/dashboard");
        } catch {
          setError("The sign-in service could not be reached. Try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="auth-form-topline">
        <span>PSB WORKSPACE</span>
        <span>01</span>
      </div>
      <h2>
        Welcome back<span>.</span>
      </h2>
      <p className="auth-form-intro">Sign in to continue.</p>
      {error && (
        <div className="form-error" role="alert">
          {error}
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
      <p style={{ fontSize: 13, marginTop: 18 }}>Need access? Contact your administrator.</p>
    </form>
  );
}
