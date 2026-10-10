"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function changePassword(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const password = String(form.get("password") ?? "");
  if (password.length < 12 || password.length > 128) return { error: "Use a password between 12 and 128 characters." };
  if (password !== form.get("confirm")) return { error: "Passwords do not match." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Password could not be updated. Use a different password or sign in again." };
  redirect("/modules");
}
