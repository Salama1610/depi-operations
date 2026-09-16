"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

export default function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) return setError("Passwords do not match.");
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/update-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const value = await response.json();
    if (!response.ok || value.error) {
      setError(value.error || "Unable to update your password.");
      setBusy(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <main className="auth-shell auth-single">
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <a className="auth-brand auth-brand-dark" href="/login"><span className="brand-mark">D↗</span><span><strong>DEPI</strong><small>Round 5 operations</small></span></a>
          <div className="auth-form-heading"><span className="auth-icon"><LockKeyhole size={22} /></span><h2>Choose a new password</h2><p>Use at least eight characters. A longer, unique password is safer.</p></div>
          <form className="auth-form" onSubmit={submit}>
            <label><span>New password</span><div className="auth-input"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></div></label>
            <label><span>Confirm password</span><div className="auth-input"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div></label>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="auth-submit" disabled={busy}>{busy ? "Updating…" : "Update password"}<ArrowRight size={18} /></button>
          </form>
        </div>
      </section>
    </main>
  );
}
