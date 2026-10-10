import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <Brand />
        <div className="auth-copy">
          <h1>PSB Workspace</h1>
        </div>
        <small style={{ color: "#8fa2b0" }}>Private access</small>
      </section>
      <section className="auth-form-wrap">
        <LoginForm />
      </section>
    </main>
  );
}
