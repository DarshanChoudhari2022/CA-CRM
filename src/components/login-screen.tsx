import Link from "next/link";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { Brand } from "./brand";

export function LoginScreen({ audience }: { audience: "admin" | "employee" }) {
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="auth-visual-inner">
          <Brand />
          <div className="auth-copy">
            <span className="auth-kicker">{audience === "admin" ? "Administration" : "Employee workspace"}</span>
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
        <div>
          <LoginForm audience={audience} />
          <p style={{ textAlign: "center", marginTop: 24 }}>
            <Link href={audience === "admin" ? "/employee/login" : "/admin/login"}>
              {audience === "admin" ? "Employee sign in" : "Administrator sign in"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
