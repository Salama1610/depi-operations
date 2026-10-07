"use client";
import { LanguageToggle, useT } from "@/lib/i18n/context";

import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

export default function LoginForm({ configured }: { configured: boolean }) {
  const t = useT();
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let response: Response;
      try {
        response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mode === "login" ? { email, password } : { email }),
        });
      } catch {
        throw new Error(t("Check your connection and try again."));
      }
      // A gateway error page is HTML; it must not surface as a parser message.
      const value = await response.json().catch(() => null);
      // The sign-in service answers in English; ar.ts carries its sentences.
      if (!response.ok || !value || value.error) throw new Error(value?.error ? t(value.error) : t("Unable to continue."));
      if (mode === "login") window.location.assign(value.redirect || "/");
      else setMessage(t(value.message || "If this email is registered, a reset link is on its way."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to continue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label={t("DEPI Round 5")}>
        <a className="auth-brand" href="/login" aria-label={t("DEPI sign in")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a static local logo; the Worker build does not run the image optimizer */}
          <img className="auth-logo" src="/brand/logo-white.png" alt={t("Freelance Yard")} width={176} height={80} />
          <span><strong>{t("DEPI")}</strong><small>{t("Round 5 operations")}</small></span>
        </a>
        <div className="auth-story-copy">
          <span className="auth-kicker">{t("COACHING & FREELANCING OPERATIONS")}</span>
          <h1>{t("One secure workspace for every student outcome.")}</h1>
          <p>{t("Students submit service links. Quality teams review them. Operations staff keep the full journey accountable.")}</p>
        </div>
        <div className="auth-trust"><ShieldCheck size={18} /><span>{t("Protected by Supabase Auth")}</span><LanguageToggle className="auth-lang" /></div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-form-heading">
{/* eslint-disable-next-line @next/next/no-img-element -- a static local logo; the Worker build does not run the image optimizer */}
            <img className="auth-cobrand" src="/brand/cobrand.png" alt={t("Digital Egypt Pioneers Initiative and Freelance Yard")} width={216} height={120} />
            <h2>{mode === "login" ? t("Welcome back") : t("Reset your password")}</h2>
            <p>{mode === "login" ? t("Sign in with the email registered in your DEPI roster.") : t("We’ll send a secure reset link to your registered email.")}</p>
          </div>

          {!configured && (
            <div className="auth-alert" role="alert">
              {t("Authentication setup is being completed. Add the Supabase project URL and publishable key to enable sign-in.")}
            </div>
          )}

          <form className="auth-form" onSubmit={submit}>
            <label>
              <span>{t("Email address")}</span>
              <div className="auth-input"><Mail size={18} /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("name@example.com")} /></div>
            </label>
            {mode === "login" && (
              <label>
                <span>{t("Password")}</span>
                <div className="auth-input"><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("Enter your password")} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t("Hide password") : t("Show password")}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              </label>
            )}
            {error && <div className="auth-error" role="alert">{error}</div>}
            {message && <div className="auth-success" role="status">{message}</div>}
            <button className="auth-submit" type="submit" disabled={busy || !configured}>
              {busy ? t("Please wait…") : mode === "login" ? t("Sign in") : t("Send reset link")}
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>

          <button className="auth-mode" type="button" onClick={() => { setMode(mode === "login" ? "reset" : "login"); setError(""); setMessage(""); }}>
            {mode === "login" ? t("Forgot your password?") : t("Return to sign in")}
          </button>
          <p className="auth-help">{t("Access is limited to active students and authorized DEPI staff.")}</p>
        </div>
      </section>
    </main>
  );
}
