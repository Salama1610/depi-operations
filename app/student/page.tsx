"use client";
import { LanguageToggle, useT } from "@/lib/i18n/context";

import { useEffect, useState } from "react";
import { Check, ExternalLink, LockKeyhole, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  linksPerPlatform,
  requiredServicePlatforms,
  maxLinksPerPlatform,
  maxServiceLinks,
  minServiceLinks,
  serviceProgress,
  verifyServiceLink,
} from "@/lib/domain/service-links";

/** A link's marketplace as the student reads it. */
const platformName = (platform?: string) => (platform === "External service" ? "Not an accepted marketplace" : platform || "");

type Service = {
  id?: string;
  slot: number;
  url: string;
  platform?: string;
  auto_status?: string;
  auto_result?: { message?: string; checks?: string[] };
  qc_status?: string;
  qc_comment?: string | null;
  can_edit?: boolean;
  submitted_at?: string;
  qc_at?: string | null;
};

const empty = (): Service[] => [];

/** The stored review states, in the words the student understands. */
const reviewLabel: Record<string, string> = {
  Locked: "Approved",
  "Pending QC": "With your coordinator",
  "In Progress": "Add more services",
  Pending: "With your coordinator",
};
const label = (status?: string) => (status ? reviewLabel[status] || status : "");

function statusTone(status?: string) {
  if (status === "Locked" || status === "Verified" || status === "Complete") return "student-status success";
  if (status === "Needs Correction" || status === "Failed") return "student-status danger";
  return "student-status pending";
}

/**
 * The service endpoint reports identity problems and unexpected failures
 * through the same channel, so the error screen decides its heading from the
 * message. Showing "sign in" for a database fault sends the student to a page
 * that cannot help them.
 */
function needsSignIn(message: string) {
  return /sign in|not been linked|no longer be updated|staff workspace/i.test(message);
}

export default function StudentServicesPage() {
  const t = useT();
  const [student, setStudent] = useState<{ id: string; name: string; email?: string } | null>(null);
  const [services, setServices] = useState<Service[]>(empty());
  const [submission, setSubmission] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);
  const [lastReviewedAt, setLastReviewedAt] = useState<string | null>(null);
  // The link being added, the corrections being typed, and which one is being confirmed.
  const [draft, setDraft] = useState("");
  const [fixes, setFixes] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<{ slot?: number; url: string } | null>(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/student-services", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || t("Unable to load your services."));
      setStudent(value.student);
      setServices(value.services || empty());
      setSubmission(value.submission);
      setReviews(value.reviews || []);
      setLastReviewedAt(value.last_reviewed_at || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Where the student stands: three services at least, a Kafiil and a Nafezly among them.
  const progress = serviceProgress(services.map((service) => service.platform || ""));
  const lockedCount = services.filter((service) => service.qc_status === "Locked").length;
  const complete = progress.met && lockedCount === services.length;
  const counts = linksPerPlatform(services.map((service) => service.url));
  const full = services.length >= maxServiceLinks;

  /** Why a link cannot be added, before it is sent; empty when it can. */
  function problem(url: string) {
    if (!url.trim()) return "";
    const check = verifyServiceLink(url);
    if (check.status === "Failed") return check.message;
    if ((counts[check.platform] || 0) >= maxLinksPerPlatform)
      return t("You already have {v0} {v1} services, the most allowed.", { v0: maxLinksPerPlatform, v1: check.platform });
    return "";
  }

  async function submit() {
    if (!pending) return;
    const entry = pending;
    setPending(null);
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/student-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit_service", url: entry.url, slot: entry.slot }),
      });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || t("Unable to submit your links."));
      setServices(value.services || empty());
      setSubmission(value.submission);
      setReviews(value.reviews || []);
      setLastReviewedAt(value.last_reviewed_at || null);
      if (entry.slot) setFixes((current) => ({ ...current, [entry.slot!]: "" }));
      else setDraft("");
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="student-shell">
      <header className="student-header">
        <a className="student-brand" href="/student" aria-label={t("DEPI student services")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a static local logo; the Worker build does not run the image optimizer */}
          <img className="brand-mark-img" src="/brand/mark.png" alt="" width={34} height={34} />
          <span><strong>{t("DEPI")}</strong><small>{t("Student services")}</small></span>
        </a>
        <span className="student-header-actions">
          <LanguageToggle />
          <a className="student-signout" href="/api/auth/logout">{t("Sign out")}</a>
        </span>
      </header>

      {loading ? (
        <section className="student-card student-loading"><RefreshCw className="spin" size={22} /> {t("Loading your service links…")}</section>
      ) : error ? (
        <section className="student-card student-error" role="alert">
          <ShieldCheck size={24} />
          <div>
            <h1>{needsSignIn(error) ? t("Student sign-in required") : t("We could not load your service links")}</h1>
            <p>{error}</p>
          </div>
          <div className="student-actions">
            {needsSignIn(error) ? <a className="student-primary" href="/login">{t("Sign in")}</a> : null}
            <button className={needsSignIn(error) ? "student-secondary" : "student-primary"} onClick={refresh}>{t("Try again")}</button>
          </div>
        </section>
      ) : (
        <>
          <section className="student-intro">
            <div>
              <span className="student-kicker">{t("SERVICE LINKS / ROUND 5")}</span>
              <h1>{student?.name ? t("Hi {v0}, submit your services.", { v0: student.name.split(" ")[0] }) : t("Submit your services.")}</h1>
              <p>{t("Submit your services one at a time. You need at least one on each of Kafiil, Nafezly and Khamsat, and you can add up to three on each. Each link is checked automatically, then reviewed by your coordinator.")}</p>
            </div>
            <div className="student-progress"><strong>{Math.min(services.length, minServiceLinks)}/{minServiceLinks}</strong><span>{t("uploaded")}</span></div>
          </section>

          <section className="student-card">
            <div className="student-card-heading">
              <div><h2>{t("Your progress")}</h2><p>{complete ? t("All your services are approved. Nothing more is needed.") : progress.met ? t("You have the services you need. Your coordinator is reviewing them.") : t("{v0} of {v1} services uploaded.", { v0: services.length, v1: minServiceLinks })}</p></div>
              {submission && <span className={statusTone(submission.status)}>{t(label(submission.status))}</span>}
            </div>
            <div className="student-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={minServiceLinks} aria-valuenow={Math.min(services.length, minServiceLinks)}>
              <span style={{ width: `${Math.min(100, (services.length / minServiceLinks) * 100)}%` }} />
            </div>
            <ul className="student-requirements">
              {requiredServicePlatforms.map((platform) => {
                const n = progress.perPlatform[platform] || 0;
                return (
                  <li key={platform} className={n > 0 ? "is-done" : ""}>
                    {n > 0 ? <Check size={15} /> : null}
                    {platform} {n}/{maxLinksPerPlatform}
                  </li>
                );
              })}
              <li className={services.length >= minServiceLinks ? "is-done" : ""}>{services.length >= minServiceLinks ? <Check size={15} /> : null}{t("{v0} services at least", { v0: minServiceLinks })}</li>
            </ul>
            {submission && (
              <div className="student-meta student-submission-meta">
                <span>{t("Submitted")}{" "}{new Date(submission.submitted_at).toLocaleString()}</span>
                <span>{t("Last reviewed")}{" "}{lastReviewedAt ? new Date(lastReviewedAt).toLocaleString() : t("Not reviewed yet")}</span>
              </div>
            )}
          </section>

          <section className="student-card">
            <div className="student-card-heading">
              <div><h2>{t("Add a service")}</h2><p>{t("Kafiil, Nafezly or Khamsat. Up to {v0} on each, {v1} in all.", { v0: maxLinksPerPlatform, v1: maxServiceLinks })}</p></div>
            </div>
            {full ? (
              <p className="student-check-note">{t("You have submitted the most links allowed.")}</p>
            ) : (
              <form
                className="student-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!problem(draft)) setPending({ url: draft.trim() });
                }}
              >
                <div className="student-url-field">
                  <label htmlFor="service-new">{t("Service {v0}", { v0: services.length + 1 })} · {t("Public service URL")}</label>
                  <div className="student-url-wrap">
                    <input id="service-new" type="url" required value={draft} disabled={busy} placeholder={t("https://…")} onChange={(e) => { setSaved(false); setDraft(e.target.value); }} />
                    <button className="student-primary" disabled={busy || !draft.trim() || Boolean(problem(draft))} type="submit"><Send size={16} />{busy ? t("Submitting…") : t("Submit")}</button>
                  </div>
                  {draft.trim() && (
                    <div className="student-meta">
                      <span>{t(platformName(verifyServiceLink(draft).platform))}</span>
                    </div>
                  )}
                  {problem(draft) && <div className="student-qc-note">{problem(draft)}</div>}
                </div>
              </form>
            )}
            {error && <p className="student-form-error" role="alert">{error}</p>}
            {saved && <p className="student-saved"><Check size={17} /> {t("Saved. Your coordinator can now review your links.")}</p>}
          </section>

          {services.length > 0 && (
            <section className="student-card">
              <div className="student-card-heading">
                <div><h2>{t("Your service links")}</h2><p>{t("Approved links cannot be changed. Links needing correction stay editable with your coordinator’s comment.")}</p></div>
              </div>
              <div className="student-service-list">
                {services.map((service) => {
                  const locked = service.qc_status === "Locked";
                  const correction = service.qc_status === "Needs Correction";
                  const fix = fixes[service.slot] ?? "";
                  return (
                    <article className={`student-service-row ${locked ? "is-locked" : correction ? "is-correction" : ""}`} key={service.slot}>
                      <div className="student-slot"><span>0{service.slot}</span><strong>{t("Service")}{" "}{service.slot}</strong></div>
                      <div className="student-url-field">
                        <div className="student-url-wrap">
                          <a className="student-url-text" href={service.url} target="_blank" rel="noreferrer">{service.url} <ExternalLink size={14} /></a>
                        </div>
                        <div className="student-meta">
                          {service.platform && <span>{t(platformName(service.platform))}</span>}
                          {service.qc_status && <span className={statusTone(service.qc_status)}>{t(label(service.qc_status))}</span>}
                        </div>
                        {service.auto_result?.message && <p className="student-check-note">{service.auto_result.message}</p>}
                        {correction && (
                          <>
                            <div className="student-qc-note"><strong>{t("Correction needed:")}</strong> {service.qc_comment}</div>
                            <form
                              className="student-url-wrap student-fix"
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (fix.trim()) setPending({ slot: service.slot, url: fix.trim() });
                              }}
                            >
                              <input type="url" required value={fix} disabled={busy} placeholder={t("Corrected link")} onChange={(e) => setFixes((current) => ({ ...current, [service.slot]: e.target.value }))} />
                              <button className="student-secondary" disabled={busy || !fix.trim()} type="submit"><RefreshCw size={15} />{t("Resubmit")}</button>
                            </form>
                          </>
                        )}
                        {locked && <div className="student-locked-note"><LockKeyhole size={15} /> {t("Approved by your coordinator")}{service.qc_comment ? ` · ${service.qc_comment}` : ""}</div>}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {reviews.length > 0 && (
            <section className="student-card" aria-labelledby="review-history-title">
              <div className="student-card-heading"><div><h2 id="review-history-title">{t("Review updates")}</h2><p>{t("Your approval and correction history.")}</p></div></div>
              <div className="student-service-list">
                {reviews.map((review) => (
                  <article className="student-service-row" key={review.id}>
                    <div className="student-slot"><span>0{review.slot}</span><strong>{t("Service")}{" "}{review.slot}</strong></div>
                    <div><span className={statusTone(review.decision)}>{t(label(review.decision))}</span><p>{review.comment}</p><small>{new Date(review.reviewed_at).toLocaleString()} {t("· revision")}{" "}{review.revision}</small></div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <p className="student-footnote"><ShieldCheck size={15} /> {t("Your links are visible to the DEPI operations team only for verification.")}</p>
        </>
      )}
      <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.slot ? t("Resubmit this service?") : t("Submit this service?")}</DialogTitle>
            <DialogDescription>{t("It goes to your coordinator for review and cannot be changed until they respond.")}</DialogDescription>
          </DialogHeader>
          <p className="student-confirm-url">{pending?.url}</p>
          <div className="student-actions">
            <button type="button" className="student-secondary" onClick={() => setPending(null)}>{t("Review links")}</button>
            <button type="button" className="student-primary" disabled={busy} onClick={submit}>{t("Confirm submission")}</button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
