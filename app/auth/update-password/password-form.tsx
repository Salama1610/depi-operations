"use client";
import { LanguageToggle, useT } from "@/lib/i18n/context";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

export default function PasswordForm({ first = false }: { first?: boolean }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) return setError(t("Passwords do not match."));
    setBusy(true);
    setError("");
    try {
      let response: Response;
      try {
        response = await fetch("/api/auth/update-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      } catch {
        throw new Error(t("Check your connection and try again."));
      }
      // A gateway error page is HTML; it must not surface as a parser message.
      const value = await response.json().catch(() => null);
      if (!response.ok || !value || value.error) throw new Error(value?.error ? t(value.error) : t("Unable to update your password."));
      window.location.assign("/");
    } catch (reason) {
      // Whatever failed, the button must not stay stuck on "Updating…".
      setError(reason instanceof Error ? reason.message : t("Unable to update your password."));
      setBusy(false);
    }
  }
  const mismatch = confirmation.length > 0 && !password.startsWith(confirmation) && password !== confirmation;

  return (
    <main className="auth-shell auth-single">
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <a className="auth-brand auth-brand-dark" href="/login">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static local logo; the Worker build does not run the image optimizer */}
          <img className="brand-mark-img" src="/brand/mark.png" alt="" width={38} height={38} />
          <span><strong>{t("DEPI")}</strong><small>{t("Round 5 operations")}</small></span></a>
          <LanguageToggle className="auth-lang auth-lang-dark" />
          <div className="auth-form-heading"><span className="auth-icon"><LockKeyhole size={22} /></span><h2>{first ? t("Choose your own password") : t("Choose a new password")}</h2><p>{first ? t("Your first password is your national ID. Choose your own to continue: at least eight characters, and not your national ID.") : t("Use at least eight characters. A longer, unique password is safer.")}</p></div>
          <form className="auth-form" onSubmit={submit}>
            <label><span>{t("New password")}</span><div className="auth-input"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></div></label>
            <label><span>{t("Confirm password")}</span><div className="auth-input"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div></label>
            {mismatch && !error && <div className="auth-error" role="status">{t("Passwords do not match.")}</div>}
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="auth-submit" disabled={busy}>{busy ? t("Updating…") : t("Update password")}<ArrowRight size={18} /></button>
          </form>
        </div>
      </section>
    </main>
  );
}
