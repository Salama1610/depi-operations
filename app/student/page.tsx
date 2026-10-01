"use client";
import { LanguageToggle, useT } from "@/lib/i18n/context";

import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, LockKeyhole, Plus, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  acceptedServicePlatforms,
  linksPerPlatform,
  maxLinksPerPlatform,
  maxServiceLinks,
  minServiceLinks,
  verifyServiceLink,
} from "@/lib/domain/service-links";

/** True when a typed link is on a site other than the three marketplaces. */
const offMarketplace = (service: Service) =>
  Boolean(service.url.trim()) && verifyServiceLink(service.url).platform === "External service";

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

const empty = (): Service[] =>
  Array.from({ length: minServiceLinks }, (_, i) => ({ slot: i + 1, url: "", can_edit: true }));

/** The stored review states, in the words the student understands. */
const reviewLabel: Record<string, string> = {
  Locked: "Approved",
  "Pending QC": "With your coordinator",
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/student-services", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || t("Unable to load your services."));
      setStudent(value.student);
      const serverServices = value.services || empty();
      const draftKey = `depi-service-draft:${value.student.id}`;
      let draft: Record<string, string> = {};
      try { draft = JSON.parse(localStorage.getItem(draftKey) || "{}"); } catch {}
      setServices(serverServices.map((service: Service) =>
        service.can_edit !== false && draft[service.slot] ? { ...service, url: draft[service.slot] } : service,
      ));
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

  const editable = services.filter((service) => service.can_edit !== false);
  // Any mix of the three marketplaces, at least three links, three per marketplace at most.
  const perPlatform = linksPerPlatform(services.map((service) => service.url).filter((url) => url.trim()));
  const overLimit = Object.entries(perPlatform).filter(([, n]) => n > maxLinksPerPlatform).map(([p]) => p);
  const ready = useMemo(
    () => services.length >= minServiceLinks && services.every((service) => service.url.trim().length > 0),
    [services],
  );
  const savedCount = services.filter((service) => service.id).length;
  const lockedCount = services.filter((service) => service.qc_status === "Locked").length;

  function addLink() {
    setSaved(false);
    setServices((current) =>
      current.length >= maxServiceLinks
        ? current
        : [...current, { slot: Math.max(0, ...current.map((s) => s.slot)) + 1, url: "", can_edit: true }],
    );
  }

  // Only a link not yet submitted can be taken off the list, and never below three.
  function removeLink(slot: number) {
    setSaved(false);
    setServices((current) =>
      current
        .filter((service) => service.slot !== slot)
        .map((service, index) => (service.id ? service : { ...service, slot: index + 1 })),
    );
  }

  function update(slot: number, url: string) {
    setSaved(false);
    setServices((current) => current.map((service) => (service.slot === slot ? { ...service, url } : service)));
  }

  useEffect(() => {
    if (!student || loading) return;
    const editableDraft = Object.fromEntries(
      services.filter((service) => service.can_edit !== false).map((service) => [service.slot, service.url]),
    );
    localStorage.setItem(`depi-service-draft:${student.id}`, JSON.stringify(editableDraft));
  }, [services, student, loading]);

  function requestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConfirmOpen(true);
  }

  async function submit() {
    setConfirmOpen(false);
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/student-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit_services", services: services.map((service) => service.url) }),
      });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || t("Unable to submit your links."));
      setServices(value.services || empty());
      setSubmission(value.submission);
      setReviews(value.reviews || []);
      setLastReviewedAt(value.last_reviewed_at || null);
      if (student) localStorage.removeItem(`depi-service-draft:${student.id}`);
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
              <p>{t("Add at least three public links to services you provide on Nafezly, Kafiil or Khamsat, in any mix, with up to three on each. Each link is checked automatically, then reviewed by your coordinator.")}</p>
            </div>
            <div className="student-progress"><strong>{lockedCount}/{Math.max(savedCount, minServiceLinks)}</strong><span>{t("approved")}</span></div>
          </section>

          <section className="student-card">
            <div className="student-card-heading">
              <div><h2>{t("Your service links")}</h2><p>{t("Approved links cannot be changed. Links needing correction stay editable with your coordinator’s comment.")}</p></div>
              {submission && <span className={statusTone(submission.status)}>{t(label(submission.status))}</span>}
            </div>
            {submission && (
              <div className="student-meta student-submission-meta">
                <span>{t("Submitted")}{" "}{new Date(submission.submitted_at).toLocaleString()}</span>
                <span>{t("Last reviewed")}{" "}{lastReviewedAt ? new Date(lastReviewedAt).toLocaleString() : t("Not reviewed yet")}</span>
              </div>
            )}
            <form onSubmit={requestSubmit}>
              <div className="student-service-list">
                {services.map((service) => {
                  const locked = service.qc_status === "Locked";
                  const correction = service.qc_status === "Needs Correction";
                  return (
                    <article className={`student-service-row ${locked ? "is-locked" : correction ? "is-correction" : ""}`} key={service.slot}>
                      <div className="student-slot"><span>0{service.slot}</span><strong>{t("Service")}{" "}{service.slot}</strong></div>
                      <div className="student-url-field">
                        <label htmlFor={`service-${service.slot}`}>{t("Public service URL")}</label>
                        <div className="student-url-wrap">
                          <input id={`service-${service.slot}`} type="url" required value={service.url} disabled={locked || busy} placeholder={t("https://…")} onChange={(e) => update(service.slot, e.target.value)} />
                          {service.url && <a href={service.url} target="_blank" rel="noreferrer" aria-label={t("Open service {v0}", { v0: service.slot })}><ExternalLink size={17} /></a>}
                          {!service.id && services.length > minServiceLinks && (
                            <button type="button" className="student-remove" disabled={busy} onClick={() => removeLink(service.slot)} aria-label={t("Remove this link")}><X size={16} /></button>
                          )}
                        </div>
                        <div className="student-meta">
                          {service.platform && <span>{service.platform}</span>}
                          {service.auto_status && <span className={statusTone(service.auto_status)}>{service.auto_status === "Needs Review" ? t("Automatic check passed") : t(label(service.auto_status))}</span>}
                        </div>
                        {service.auto_result?.message && <p className="student-check-note">{service.auto_result.message}</p>}
                        {service.auto_result?.checks?.length ? (
                          <ul className="student-check-list">
                            {service.auto_result.checks.map((check) => <li key={check}>{check}</li>)}
                          </ul>
                        ) : null}
                        {offMarketplace(service) && <div className="student-qc-note">{t("Only Nafezly, Kafiil and Khamsat service links are accepted.")}</div>}
                        {correction && <div className="student-qc-note"><strong>{t("Correction needed:")}</strong> {service.qc_comment}</div>}
                        {locked && <div className="student-locked-note"><LockKeyhole size={15} /> {t("Approved by your coordinator")}{service.qc_comment ? ` · ${service.qc_comment}` : ""}</div>}
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="student-platform-count">
                <span>
                  {acceptedServicePlatforms.map((platform) => `${platform} ${perPlatform[platform] || 0}/${maxLinksPerPlatform}`).join(" · ")}
                </span>
                {services.length < maxServiceLinks && (
                  <button type="button" className="student-secondary" disabled={busy} onClick={addLink}><Plus size={16} />{t("Add another link")}</button>
                )}
              </div>
              {overLimit.length > 0 && (
                <p className="student-form-error" role="alert">
                  {t("At most three links per marketplace. Remove a {v0} link.", { v0: overLimit.join(", ") })}
                </p>
              )}
              {error && <p className="student-form-error" role="alert">{error}</p>}
              {saved && <p className="student-saved"><Check size={17} /> {t("Saved. Your coordinator can now review your links.")}</p>}
              <div className="student-form-footer">
                <span>
                  {!submission
                    ? t("Add at least three links, then submit them together.")
                    : editable.length > 0
                      ? t("{v0} link{v1} can be updated.", { v0: editable.length, v1: editable.length === 1 ? "" : "s" })
                      : savedCount >= minServiceLinks && lockedCount === savedCount
                        ? t("All your links are approved. Nothing more is needed.")
                        : t("Your links are with your coordinator. Nothing can be changed until they respond.")}
                </span>
                <button className="student-primary" disabled={!ready || busy || services.some(offMarketplace) || overLimit.length > 0 || (Boolean(submission) && editable.length === 0)} type="submit"><Send size={16} />{busy ? t("Submitting…") : submission ? t("Resubmit editable links") : t("Submit {v0} links", { v0: services.length })}</button>
              </div>
            </form>
          </section>
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
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Submit these service links?")}</DialogTitle>
            <DialogDescription>{t("Pending links become read-only until your coordinator reviews them. You can edit only links returned for correction.")}</DialogDescription>
          </DialogHeader>
          <ol className="student-confirm-list">
            {services.map((service) => <li key={service.slot}><strong>{t("Service")}{" "}{service.slot}</strong><span>{service.url}</span></li>)}
          </ol>
          <div className="student-actions">
            <button type="button" className="student-secondary" onClick={() => setConfirmOpen(false)}>{t("Review links")}</button>
            <button type="button" className="student-primary" disabled={busy} onClick={submit}>{t("Confirm submission")}</button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
