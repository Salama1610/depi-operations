"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, LockKeyhole, RefreshCw, Send, ShieldCheck } from "lucide-react";

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
};

const empty = (): Service[] => [1, 2, 3].map((slot) => ({ slot, url: "", can_edit: true }));

function statusTone(status?: string) {
  if (status === "Locked" || status === "Verified" || status === "Complete") return "student-status success";
  if (status === "Needs Correction" || status === "Failed") return "student-status danger";
  return "student-status pending";
}

export default function StudentServicesPage() {
  const [student, setStudent] = useState<{ name: string; email?: string } | null>(null);
  const [services, setServices] = useState<Service[]>(empty());
  const [submission, setSubmission] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/student-services", { cache: "no-store" });
      const value = await response.json();
      if (!response.ok || value.error) throw new Error(value.error || "Unable to load your services.");
      setStudent(value.student);
      setServices(value.services || empty());
      setSubmission(value.submission);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
        <a className="student-signout" href="/signout-with-chatgpt?return_to=/student" target="_top">Sign out</a>
      </header>

      {loading ? (
        <section className="student-card student-loading"><RefreshCw className="spin" size={22} /> Loading your service links…</section>
      ) : error ? (
        <section className="student-card student-error" role="alert">
          <ShieldCheck size={24} />
          <div><h1>Student sign-in required</h1><p>{error}</p></div>
          <div className="student-actions">
            <a className="student-primary" href="/signin-with-chatgpt?return_to=/student" target="_top">Continue with ChatGPT</a>
            <button className="student-secondary" onClick={refresh}>Try again</button>
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
            <form onSubmit={submit}>
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
          <p className="student-footnote"><ShieldCheck size={15} /> Your links are visible to the DEPI QC team only for verification.</p>
        </>
      )}
    </main>
  );
}
