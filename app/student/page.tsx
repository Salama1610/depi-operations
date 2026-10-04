"use client";
import { LanguageToggle, useT } from "@/lib/i18n/context";

import { useEffect, useState } from "react";
import { Check, ExternalLink, LockKeyhole, Plus, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  maxLinksPerPlatform,
  minServiceLinks,
  serviceCategory,
  serviceProgress,
  verifyServiceLink,
  type ServiceCategory,
} from "@/lib/domain/service-links";

/** The three sections of the form, in the order they are shown. */
const sections: { category: ServiceCategory; title: string; hint: string; example: string }[] = [
  { category: "Nafezly", title: "Nafezly", hint: "Your services on Nafezly.", example: "https://nafezly.com/service/…" },
  { category: "Kafiil", title: "Kafiil", hint: "Your services on Kafiil.", example: "https://kafiil.com/service/…" },
  { category: "Other", title: "Other", hint: "Optional. Services on any other site, Khamsat included. These do not count toward the three.", example: "https://…" },
];

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
  "Needs Correction": "Rejected",
  "Pending QC": "With your coordinator",
  "In Progress": "Add more links",
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

type FeedbackSession = { id: string; title: string; week: number; starts_at: string; coach_name: string | null; given: boolean };
type FeedbackAnswers = { satisfaction?: number; clarity?: number; searched_gig?: boolean; usefulness?: number; liked?: string; comments?: string };

/** The questions students answer after each session, about it and its coach. */
const ratingQuestions: { key: "satisfaction" | "clarity" | "usefulness"; text: string }[] = [
  { key: "satisfaction", text: "How satisfied are you with today's session?" },
  { key: "clarity", text: "How clear was the coach's explanation?" },
  { key: "usefulness", text: "How useful was today's mentorship for you?" },
];

/**
 * Feedback after each session: the student's ended sessions, newest first,
 * with a short form for each one they have not answered yet.
 */
function SessionFeedback({ sessions, onSent }: { sessions: FeedbackSession[]; onSent: (s: FeedbackSession[]) => void }) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<FeedbackAnswers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const due = sessions.filter((s) => !s.given);
  const complete =
    ratingQuestions.every((q) => answers[q.key]) && typeof answers.searched_gig === "boolean";
  async function send(sessionId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/student-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session_feedback", session_id: sessionId, ...answers }),
      });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || t("Unable to send your feedback."));
      onSent(value.sessions || []);
      setOpenId(null);
      setAnswers({});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!sessions.length) return null;
  return (
    <section className="student-card" aria-labelledby="feedback-title">
      <div className="student-card-heading">
        <div>
          <h2 id="feedback-title">{t("Session feedback")}</h2>
          <p>{due.length ? t("Tell us how each session went. It takes a minute.") : t("Thank you. You have given feedback on every session so far.")}</p>
        </div>
        {due.length > 0 && <span className="student-status pending">{t("{v0} waiting", { v0: due.length })}</span>}
      </div>
      <div className="student-service-list">
        {sessions.map((s) => (
          <article className="student-service-row feedback-row" key={s.id}>
            <div className="student-slot">
              <span>{t("Week {v0}", { v0: s.week })}</span>
              <strong>{new Date(s.starts_at).toLocaleDateString()}</strong>
            </div>
            <div>
              <div className="feedback-head">
                <span><strong>{s.title}</strong>{s.coach_name ? <small> · {s.coach_name}</small> : null}</span>
                {s.given ? (
                  <span className="student-status success"><Check size={13} /> {t("Feedback sent")}</span>
                ) : openId !== s.id ? (
                  <button type="button" className="student-secondary" onClick={() => { setOpenId(s.id); setAnswers({}); setError(""); }}>{t("Give feedback")}</button>
                ) : null}
              </div>
              {openId === s.id && (
                <form className="feedback-form" onSubmit={(e) => { e.preventDefault(); if (complete) send(s.id); }}>
                  {ratingQuestions.map((q) => (
                    <fieldset key={q.key}>
                      <legend>{t(q.text)}</legend>
                      <div className="feedback-scale">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button type="button" key={n} className={answers[q.key] === n ? "is-on" : ""} onClick={() => setAnswers({ ...answers, [q.key]: n })} aria-label={`${n}`}>{n}</button>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <fieldset>
                    <legend>{t("Did you search for a gig through platforms?")}</legend>
                    <div className="feedback-scale">
                      <button type="button" className={answers.searched_gig === true ? "is-on" : ""} onClick={() => setAnswers({ ...answers, searched_gig: true })}>{t("Yes")}</button>
                      <button type="button" className={answers.searched_gig === false ? "is-on" : ""} onClick={() => setAnswers({ ...answers, searched_gig: false })}>{t("No")}</button>
                    </div>
                  </fieldset>
                  <label className="feedback-text">
                    {t("What did you like most about today's session?")}
                    <textarea rows={2} value={answers.liked || ""} onChange={(e) => setAnswers({ ...answers, liked: e.target.value })} />
                  </label>
                  <label className="feedback-text">
                    {t("Any comments or support needed?")}
                    <textarea rows={2} value={answers.comments || ""} onChange={(e) => setAnswers({ ...answers, comments: e.target.value })} />
                  </label>
                  {error && <p className="student-form-error" role="alert">{error}</p>}
                  <div className="student-actions">
                    <button type="button" className="student-secondary" onClick={() => setOpenId(null)}>{t("Cancel")}</button>
                    <button type="submit" className="student-primary" disabled={!complete || busy}><Send size={16} />{busy ? t("Sending…") : t("Send feedback")}</button>
                  </div>
                </form>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
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
  const [feedbackSessions, setFeedbackSessions] = useState<FeedbackSession[]>([]);
  const [lastReviewedAt, setLastReviewedAt] = useState<string | null>(null);
  // New links typed into each section, corrections to links sent back, and
  // whether the student is confirming the submission.
  const [drafts, setDrafts] = useState<Record<ServiceCategory, string[]>>({ Nafezly: [""], Kafiil: [""], Other: [] });
  const [fixes, setFixes] = useState<Record<number, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/student-services", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || t("Unable to load your services."));
      setStudent(value.student);
      setFeedbackSessions(value.feedback_sessions || []);
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

  // Where the student stands: Kafiil and Nafezly links toward the three needed.
  const platformOf = (url: string) => verifyServiceLink(url, { open: true }).platform;
  const filled = (category: ServiceCategory) => drafts[category].map((url) => url.trim()).filter(Boolean);
  const newLinks = [...filled("Nafezly"), ...filled("Kafiil"), ...filled("Other")];
  const corrected = services.map((service) => (fixes[service.slot]?.trim() ? fixes[service.slot].trim() : service.url));
  const progress = serviceProgress([...corrected, ...newLinks].map(platformOf));
  const savedProgress = serviceProgress(services.map((service) => service.platform || ""));
  const lockedRequired = services.filter((service) => service.qc_status === "Locked" && serviceCategory(service.platform || "") !== "Other").length;
  const complete = submission?.status === "Complete" || lockedRequired >= minServiceLinks;
  const inSection = (category: ServiceCategory) =>
    services.filter((service) => serviceCategory(service.platform || "") === category);

  /** Why a link typed into a section cannot go there; empty when it can. */
  function problem(category: ServiceCategory, url: string) {
    if (!url.trim()) return "";
    const check = verifyServiceLink(url, { open: true });
    if (check.status === "Failed") return check.message;
    const belongs = serviceCategory(check.platform);
    if (belongs !== category)
      return category === "Other"
        ? t("This is a {v0} link. Add it in the {v0} section.", { v0: belongs })
        : t("This section takes {v0} links only.", { v0: category });
    return "";
  }
  const problems = [
    ...sections.flatMap(({ category }) => drafts[category].map((url) => problem(category, url))),
    ...services.map((service) => (fixes[service.slot]?.trim() ? problem(serviceCategory(platformOf(fixes[service.slot])), fixes[service.slot]) : "")),
  ].filter(Boolean);
  const changed = newLinks.length > 0 || services.some((service) => fixes[service.slot]?.trim());
  const canSubmit = progress.met && problems.length === 0 && changed && !busy;

  function setDraft(category: ServiceCategory, index: number, url: string) {
    setSaved(false);
    setDrafts((current) => ({ ...current, [category]: current[category].map((u, i) => (i === index ? url : u)) }));
  }
  function addField(category: ServiceCategory) {
    setDrafts((current) => ({ ...current, [category]: [...current[category], ""] }));
  }
  function removeField(category: ServiceCategory, index: number) {
    setDrafts((current) => ({ ...current, [category]: current[category].filter((_, i) => i !== index) }));
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
        body: JSON.stringify({ action: "submit_services", services: [...corrected, ...newLinks] }),
      });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || t("Unable to submit your links."));
      setServices(value.services || empty());
      setSubmission(value.submission);
      setReviews(value.reviews || []);
      setLastReviewedAt(value.last_reviewed_at || null);
      setDrafts({ Nafezly: [], Kafiil: [], Other: [] });
      setFixes({});
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
              <p>{t("Add at least three links on Kafiil and Nafezly, in any mix: three on one, or two and one. Links on other sites are optional. Each link is checked automatically, then reviewed by your coordinator.")}</p>
            </div>
            <div className="student-progress"><strong>{Math.min(progress.required, minServiceLinks)}/{minServiceLinks}</strong><span>{t("Kafiil + Nafezly")}</span></div>
          </section>

          <section className="student-card">
            <div className="student-card-heading">
              <div>
                <h2>{t("Your services")}</h2>
                <p>{complete ? t("Your services are approved. Nothing more is needed.") : savedProgress.met ? t("You have the links you need. Your coordinator is reviewing them.") : t("{v0} of {v1} Kafiil or Nafezly links.", { v0: Math.min(progress.required, minServiceLinks), v1: minServiceLinks })}</p>
              </div>
              {submission && <span className={statusTone(submission.status)}>{t(label(submission.status))}</span>}
            </div>
            <div className="student-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={minServiceLinks} aria-valuenow={Math.min(progress.required, minServiceLinks)}>
              <span style={{ width: `${Math.min(100, (progress.required / minServiceLinks) * 100)}%` }} />
            </div>
            {submission && (
              <div className="student-meta student-submission-meta">
                <span>{t("Submitted")}{" "}{new Date(submission.submitted_at).toLocaleString()}</span>
                <span>{t("Last reviewed")}{" "}{lastReviewedAt ? new Date(lastReviewedAt).toLocaleString() : t("Not reviewed yet")}</span>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) setConfirmOpen(true); }}>
              {sections.map(({ category, title, hint, example }) => {
                const existing = inSection(category);
                const room = maxLinksPerPlatform - existing.length - drafts[category].length;
                return (
                  <div className="student-section" key={category}>
                    <div className="student-section-heading">
                      <h3>{t(title)} <small>{existing.length + filled(category).length}/{maxLinksPerPlatform}</small></h3>
                      <p>{t(hint)}</p>
                    </div>
                    {existing.map((service) => {
                      const locked = service.qc_status === "Locked";
                      const correction = service.qc_status === "Needs Correction";
                      const fix = fixes[service.slot] ?? "";
                      return (
                        <article className={`student-service-row ${locked ? "is-locked" : correction ? "is-correction" : ""}`} key={service.slot}>
                          <div className="student-url-field">
                            <a className="student-url-text" href={service.url} target="_blank" rel="noreferrer">{service.url} <ExternalLink size={14} /></a>
                            <div className="student-meta">
                              {service.qc_status && <span className={statusTone(service.qc_status)}>{t(label(service.qc_status))}</span>}
                            </div>
                            {correction && (
                              <>
                                <div className="student-qc-note"><strong>{t("Rejected:")}</strong> {service.qc_comment} {t("Paste the updated link below and submit it.")}</div>
                                <div className="student-url-wrap student-fix">
                                  <input type="url" value={fix} disabled={busy} placeholder={t("Corrected link")} onChange={(e) => { setSaved(false); setFixes((current) => ({ ...current, [service.slot]: e.target.value })); }} />
                                </div>
                                {fix.trim() && problem(serviceCategory(platformOf(fix)), fix) && <div className="student-qc-note">{problem(serviceCategory(platformOf(fix)), fix)}</div>}
                              </>
                            )}
                            {locked && <div className="student-locked-note"><LockKeyhole size={15} /> {t("Approved by your coordinator")}{service.qc_comment ? ` · ${service.qc_comment}` : ""}</div>}
                          </div>
                        </article>
                      );
                    })}
                    {drafts[category].map((url, index) => (
                      <div className="student-url-field student-new-link" key={`${category}-${index}`}>
                        <div className="student-url-wrap">
                          <input type="url" value={url} disabled={busy} placeholder={example} aria-label={t("{v0} link", { v0: t(title) })} onChange={(e) => setDraft(category, index, e.target.value)} />
                          <button type="button" className="student-remove" disabled={busy} onClick={() => removeField(category, index)} aria-label={t("Remove this link")}><X size={16} /></button>
                        </div>
                        {problem(category, url) && <div className="student-qc-note">{problem(category, url)}</div>}
                      </div>
                    ))}
                    {room > 0 && (
                      <button type="button" className="student-add-link" disabled={busy} onClick={() => addField(category)}>
                        <Plus size={15} /> {t("Add a {v0} link", { v0: t(title) })}
                      </button>
                    )}
                  </div>
                );
              })}
              {error && <p className="student-form-error" role="alert">{error}</p>}
              {saved && <p className="student-saved"><Check size={17} /> {t("Saved. Your coordinator can now review your links.")}</p>}
              <div className="student-form-footer">
                <span>
                  {progress.met
                    ? t("Ready to submit.")
                    : minServiceLinks - progress.required === 1
                      ? t("Add 1 more Kafiil or Nafezly link to submit.")
                      : t("Add {v0} more Kafiil or Nafezly links to submit.", { v0: minServiceLinks - progress.required })}
                </span>
                <button className="student-primary" disabled={!canSubmit} type="submit"><Send size={16} />{busy ? t("Submitting…") : t("Submit")}</button>
              </div>
            </form>
          </section>
          <SessionFeedback sessions={feedbackSessions} onSent={setFeedbackSessions} />
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
            <DialogTitle>{t("Submit your service links?")}</DialogTitle>
            <DialogDescription>{t("They go to your coordinator for review and cannot be changed until they respond.")}</DialogDescription>
          </DialogHeader>
          <ol className="student-confirm-list">
            {[...services.filter((service) => fixes[service.slot]?.trim()).map((service) => fixes[service.slot].trim()), ...newLinks].map((url) => (
              <li key={url}><strong>{t(serviceCategory(platformOf(url)))}</strong><span>{url}</span></li>
            ))}
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
