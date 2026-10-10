import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="auth-visual-inner">
          <Brand />
          <div className="auth-copy">
            <span className="auth-kicker">Private workspace</span>
            <h1>
              PSB
              <br />
              Workspace
            </h1>
            <div className="auth-rule" />
          </div>
          <small>PSB &amp; Associates LLP</small>
        </div>
        <div className="auth-orbit auth-orbit-one" />
        <div className="auth-orbit auth-orbit-two" />
      </section>
      <section className="auth-form-wrap">
        <LoginForm />
      </section>
    </main>
  );
}
