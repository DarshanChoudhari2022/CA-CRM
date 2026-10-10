import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "./password-form";

export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  return (
    <main className="auth-form-wrap" style={{ minHeight: "100vh" }}>
      <div className="auth-form">
        <Brand />
        <PasswordForm />
      </div>
    </main>
  );
}
