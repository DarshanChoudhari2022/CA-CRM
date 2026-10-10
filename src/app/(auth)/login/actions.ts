"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string };

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your work email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "We could not sign you in. Check your credentials or contact an administrator." };
  redirect("/dashboard");
}

export async function requestPasswordReset(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your work email first." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  return error
    ? { error: "Recovery email could not be sent. Try again later." }
    : { error: "If this email is registered, recovery instructions are on the way." };
}
