import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <Brand />
        <div className="auth-copy">
          <span className="eyebrow">Firm management portal</span>
          <h1>
            Your team.
            <br />
            One clear view.
          </h1>
          <p>Attendance, leave and approvals designed around the working rhythm of PSB Associates.</p>
        </div>
        <small style={{ color: "#8fa2b0" }}>Secure internal access · Asia/Kolkata</small>
      </section>
      <section className="auth-form-wrap">
        <LoginForm />
      </section>
    </main>
  );
}
