"use client";
import Link from "next/link";
import { useState } from "react";
import { Brand } from "@/components/brand";
export default function ForgotPassword() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <main className="auth-form-wrap" style={{ minHeight: "100vh" }}>
      <form
        className="auth-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setMessage("");
          const form = new FormData(event.currentTarget);
          try {
            const response = await fetch("/api/auth/recovery", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: form.get("email") }),
            });
            const data = await response.json();
            setMessage(data.error ?? data.success);
          } catch {
            setMessage("Recovery request could not complete. Try again or contact your administrator.");
          } finally {
            setPending(false);
          }
        }}
      >
        <Brand />
        <h1>Reset password</h1>
        <p>Enter your work email.</p>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        {message && <p role="status">{message}</p>}
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? "Requesting…" : "Send recovery link"}
        </button>
        <p>
          <Link href="/employee/login">Back to sign in</Link>
        </p>
      </form>
    </main>
  );
}
