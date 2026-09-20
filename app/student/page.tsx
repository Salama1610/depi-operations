"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, LockKeyhole, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

const empty = (): Service[] => [1, 2, 3].map((slot) => ({ slot, url: "", can_edit: true }));

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
      if (!response.ok || value.error) throw new Error(value.error || "Unable to load your services.");
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
  const ready = useMemo(
    () => services.length === 3 && services.every((service) => service.url.trim().length > 0),
    [services],
  );
  const lockedCount = services.filter((service) => service.qc_status === "Locked").length;

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
      if (!response.ok || value.error) throw new Error(value.error || "Unable to submit your links.");
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
        <a className="student-brand" href="/student" aria-label="DEPI student services">
          <span className="brand-mark">D↗</span>
          <span><strong>DEPI</strong><small>Student services</small></span>
        </a>
        <a className="student-signout" href="/api/auth/logout">Sign out</a>
      </header>

      {loading ? (
        <section className="student-card student-loading"><RefreshCw className="spin" size={22} /> Loading your service links…</section>
      ) : error ? (
        <section className="student-card student-error" role="alert">
          <ShieldCheck size={24} />
          <div>
            <h1>{needsSignIn(error) ? "Student sign-in required" : "We could not load your service links"}</h1>
            <p>{error}</p>
          </div>
          <div className="student-actions">
            {needsSignIn(error) ? <a className="student-primary" href="/login">Sign in</a> : null}
            <button className={needsSignIn(error) ? "student-secondary" : "student-primary"} onClick={refresh}>Try again</button>
          </div>
        </section>
      ) : (
        <>
          <section className="student-intro">
            <div>
              <span className="student-kicker">SERVICE LINKS / ROUND 5</span>
              <h1>{student?.name ? `Hi ${student.name.split(" ")[0]}, submit your services.` : "Submit your services."}</h1>
              <p>Add exactly three public links to services you provide. Each link is checked automatically, then reviewed by the QC team.</p>
            </div>
            <div className="student-progress"><strong>{lockedCount}/3</strong><span>locked by QC</span></div>
          </section>

          <section className="student-card">
            <div className="student-card-heading">
              <div><h2>Your three service links</h2><p>Locked links cannot be changed. Links needing correction stay editable with the QC comment.</p></div>
              {submission && <span className={statusTone(submission.status)}>{submission.status}</span>}
            </div>
            {submission && (
              <div className="student-meta student-submission-meta">
                <span>Submitted {new Date(submission.submitted_at).toLocaleString()}</span>
                <span>Last reviewed {lastReviewedAt ? new Date(lastReviewedAt).toLocaleString() : "Not reviewed yet"}</span>
              </div>
            )}
            <form onSubmit={requestSubmit}>
              <div className="student-service-list">
                {services.map((service) => {
                  const locked = service.qc_status === "Locked";
                  const correction = service.qc_status === "Needs Correction";
                  return (
                    <article className={`student-service-row ${locked ? "is-locked" : correction ? "is-correction" : ""}`} key={service.slot}>
                      <div className="student-slot"><span>0{service.slot}</span><strong>Service {service.slot}</strong></div>
                      <div className="student-url-field">
                        <label htmlFor={`service-${service.slot}`}>Public service URL</label>
                        <div className="student-url-wrap">
                          <input id={`service-${service.slot}`} type="url" required value={service.url} disabled={locked || busy} placeholder="https://…" onChange={(e) => update(service.slot, e.target.value)} />
                          {service.url && <a href={service.url} target="_blank" rel="noreferrer" aria-label={`Open service ${service.slot}`}><ExternalLink size={17} /></a>}
                        </div>
                        <div className="student-meta">
                          {service.platform && <span>{service.platform}</span>}
                          {service.auto_status && <span className={statusTone(service.auto_status)}>{service.auto_status === "Needs Review" ? "Automatic check passed" : service.auto_status}</span>}
                        </div>
                        {service.auto_result?.message && <p className="student-check-note">{service.auto_result.message}</p>}
                        {service.auto_result?.checks?.length ? (
                          <ul className="student-check-list">
                            {service.auto_result.checks.map((check) => <li key={check}>{check}</li>)}
                          </ul>
                        ) : null}
                        {correction && <div className="student-qc-note"><strong>QC correction:</strong> {service.qc_comment}</div>}
                        {locked && <div className="student-locked-note"><LockKeyhole size={15} /> Locked by QC{service.qc_comment ? ` · ${service.qc_comment}` : ""}</div>}
                      </div>
                    </article>
                  );
                })}
              </div>
              {error && <p className="student-form-error" role="alert">{error}</p>}
              {saved && <p className="student-saved"><Check size={17} /> Saved. The QC team can now review your links.</p>}
              <div className="student-form-footer">
                <span>{editable.length === 0 ? "All links are locked." : `${editable.length} link${editable.length === 1 ? "" : "s"} can be updated.`}</span>
                <button className="student-primary" disabled={!ready || busy} type="submit"><Send size={16} />{busy ? "Submitting…" : submission ? "Resubmit editable links" : "Submit 3 links"}</button>
              </div>
            </form>
          </section>
          {reviews.length > 0 && (
            <section className="student-card" aria-labelledby="review-history-title">
              <div className="student-card-heading"><div><h2 id="review-history-title">QC updates</h2><p>Your approval and correction history.</p></div></div>
              <div className="student-service-list">
                {reviews.map((review) => (
                  <article className="student-service-row" key={review.id}>
                    <div className="student-slot"><span>0{review.slot}</span><strong>Service {review.slot}</strong></div>
                    <div><span className={statusTone(review.decision)}>{review.decision}</span><p>{review.comment}</p><small>{new Date(review.reviewed_at).toLocaleString()} · revision {review.revision}</small></div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <p className="student-footnote"><ShieldCheck size={15} /> Your links are visible to the DEPI QC team only for verification.</p>
        </>
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit these three service links?</DialogTitle>
            <DialogDescription>Pending links become read-only until QC reviews them. You can edit only links returned for correction.</DialogDescription>
          </DialogHeader>
          <ol className="student-confirm-list">
            {services.map((service) => <li key={service.slot}><strong>Service {service.slot}</strong><span>{service.url}</span></li>)}
          </ol>
          <div className="student-actions">
            <button type="button" className="student-secondary" onClick={() => setConfirmOpen(false)}>Review links</button>
            <button type="button" className="student-primary" disabled={busy} onClick={submit}>Confirm submission</button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
