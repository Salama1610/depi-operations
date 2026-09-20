"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

export default function LoginForm({ configured }: { configured: boolean }) {
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
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password } : { email }),
      });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || "Unable to continue.");
      if (mode === "login") window.location.assign(value.redirect || "/");
      else setMessage(value.message || "If this email is registered, a reset link is on its way.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="DEPI Round 5">
        <a className="auth-brand" href="/login" aria-label="DEPI sign in">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static local logo; the Worker build does not run the image optimizer */}
          <img className="auth-logo" src="/brand/logo-white.png" alt="Freelance Yard" width={176} height={80} />
          <span><strong>DEPI</strong><small>Round 5 operations</small></span>
        </a>
        <div className="auth-story-copy">
          <span className="auth-kicker">COACHING &amp; FREELANCING OPERATIONS</span>
          <h1>One secure workspace for every student outcome.</h1>
          <p>Students submit service links. Quality teams review them. Operations staff keep the full journey accountable.</p>
        </div>
        <div className="auth-trust"><ShieldCheck size={18} /><span>Protected by Supabase Auth</span></div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-form-heading">
{/* eslint-disable-next-line @next/next/no-img-element -- a static local logo; the Worker build does not run the image optimizer */}
            <img className="auth-cobrand" src="/brand/cobrand.png" alt="Digital Egypt Pioneers Initiative and Freelance Yard" width={216} height={120} />
            <h2>{mode === "login" ? "Welcome back" : "Reset your password"}</h2>
            <p>{mode === "login" ? "Sign in with the email registered in your DEPI roster." : "We’ll send a secure reset link to your registered email."}</p>
          </div>

          {!configured && (
            <div className="auth-alert" role="alert">
              Authentication setup is being completed. Add the Supabase project URL and publishable key to enable sign-in.
            </div>
          )}

          <form className="auth-form" onSubmit={submit}>
            <label>
              <span>Email address</span>
              <div className="auth-input"><Mail size={18} /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></div>
            </label>
            {mode === "login" && (
              <label>
                <span>Password</span>
                <div className="auth-input"><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              </label>
            )}
            {error && <div className="auth-error" role="alert">{error}</div>}
            {message && <div className="auth-success" role="status">{message}</div>}
            <button className="auth-submit" type="submit" disabled={busy || !configured}>
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Send reset link"}
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>

          <button className="auth-mode" type="button" onClick={() => { setMode(mode === "login" ? "reset" : "login"); setError(""); setMessage(""); }}>
            {mode === "login" ? "Forgot your password?" : "Return to sign in"}
          </button>
          <p className="auth-help">Access is limited to active students and authorized DEPI staff.</p>
        </div>
      </section>
    </main>
  );
}
