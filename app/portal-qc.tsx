"use client";

// Our quality team's check of the gigs students upload to the ministry portal
// (see app/api/portal-qc). Each portal student (their GUID in the sheets) has
// one Quality Member, who gets every gig of theirs still waiting for the
// coach; a review stays with its proof link across uploads of the gigs sheet.
// The member opens each gig, checks it by the team's SOP and approves or
// rejects it with a comment. The coach reads the verdict in Student progress
// and approves on the portal; the coordinator sees it in the gigs portal view.
// The Quality Lead sees everyone's queue, moves a student to another member,
// or shares the students waiting out again.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, MessageSquarePlus, RefreshCw, RotateCcw, Shuffle, X } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";
import { QcThread } from "@/components/qc-thread";
import { PortalGap } from "./portal-gap";
import { coachStatusOf } from "@/lib/domain/portal-figures";

type Row = Record<string, any>;
const pageSize = 25;
/** A review the portal moved past before our verdict stands apart from those waiting. */
const stateOf = (r: Row) => (r.settled ? "Settled" : r.status);

/** One gig: what the portal says, and our verdict or the form to give it. */
function GigCheck({ g, canDecide, busy, send }: { g: Row; canDecide: boolean; busy: boolean; send: (v: Row) => Promise<boolean> }) {
  const t = useT();
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  // A new decision brings a new comment; the earlier ones stay in the thread above.
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(g.status === "Pending" && !g.settled);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  // The proof is checked before any decision: opening it unlocks the buttons.
  const [proofOpened, setProofOpened] = useState(false);
  const needsProof = Boolean(g.proof_url) && !proofOpened;
  useEffect(() => {
    setComment("");
    setEditing(g.status === "Pending" && !g.settled);
  }, [g.status, g.comment, g.settled]);
  const decide = async (status: string) => {
    if (status === "Rejected" && comment.trim().length < 3) {
      toast.error(t("Write why the gig is rejected, so the coach can tell the student."));
      return;
    }
    if (needsProof && status !== "Pending") {
      toast.error(t("Open the proof before you approve or reject the gig."));
      return;
    }
    if (await send({ action: "decide", portal_gig_id: g.portal_gig_id, status, comment, proof_checked: proofOpened })) setEditing(status === "Pending");
  };
  const addNote = async () => {
    if (note.trim().length < 3) {
      toast.error(t("Write the comment first."));
      return;
    }
    if (await send({ action: "comment", portal_gig_id: g.portal_gig_id, comment: note })) {
      setNote("");
      setNoting(false);
    }
  };
  const tone = g.settled ? "is-info" : g.status === "Approved" ? "is-ok" : g.status === "Rejected" ? "is-bad" : "is-warn";
  return (
    <li className={"pqc-gig " + tone}>
      <div className="pqc-gig-head">
        <div>
          <strong className="wrap-text">{g.title || t("Untitled gig")}</strong>
          <small className="table-subline">
            {[g.category, g.price != null ? "$" + Number(g.price).toLocaleString("en-US", { maximumFractionDigits: 2 }) : null, g.created_on ? new Date(g.created_on).toLocaleDateString(tag) : null]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </div>
        <div className="pqc-links">
          {g.url && (
            <a className="text-link" href={g.url} target="_blank" rel="noreferrer">
              {t("Gig")} <ExternalLink size={12} />
            </a>
          )}
          {g.proof_url && (
            <a
              className={"text-link" + (needsProof && editing && canDecide ? " pqc-proof-due" : "")}
              href={g.proof_url}
              target="_blank"
              rel="noreferrer"
              onClick={() => setProofOpened(true)}
              onAuxClick={() => setProofOpened(true)}
            >
              {proofOpened ? <Check size={12} /> : null} {Number(g.in_sheet) ? t("Proof") : t("Proof (from an earlier sheet)")} <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
      <div className="pqc-portal">
        <span className="cue is-info" title={t("Coach on the portal")}>{t("Coach")}: {coachStatusOf(g) ? t(coachStatusOf(g)) : t("Pending")}</span>
        {g.trainer_status && <span className="cue is-info" title={t("The portal's own quality check, after the coach")}>{t("Portal QC")}: {g.provider_status ? t(g.provider_status) : t("Pending")}</span>}
        <span className="cue is-info" title={t("Auditor")}>{t("Auditor")}: {g.auditor_status ? t(g.auditor_status) : "—"}</span>
        {!Number(g.in_sheet) && <span className="cue is-warn">{t("No longer in the latest gigs sheet")}</span>}
        {(g.same_proof || []).length > 0 && (
          <span className="cue is-bad">{t("Same proof as gig {v0}", { v0: g.same_proof.join(", ") })}</span>
        )}
        {(g.same_picture || []).length > 0 && (
          <span className="cue is-bad">{t("Same picture as the proof of gig {v0}", { v0: g.same_picture.join(", ") })}</span>
        )}
        {(g.same_link_day || []).length > 0 && (
          <span className="cue is-warn">{t("Same link entered the same day as gig {v0}", { v0: g.same_link_day.join(", ") })}</span>
        )}
        {g.portal_comment && <small className="wrap-text">{g.portal_comment}</small>}
      </div>
      <QcThread notes={g.notes} />
      {editing && canDecide ? (
        <div className="pqc-decide">
          <textarea
            rows={2}
            maxLength={2000}
            placeholder={t("Comment for the coach (required to reject)")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {needsProof && <small className="pqc-proof-hint">{t("Open the proof first. Approve and Reject unlock once you have opened it.")}</small>}
          <div className="pqc-actions">
            <button type="button" className="small-btn pqc-approve" disabled={busy || needsProof} onClick={() => decide("Approved")}>
              <Check size={14} /> {t("Approve")}
            </button>
            <button type="button" className="small-btn pqc-reject" disabled={busy || needsProof} onClick={() => decide("Rejected")}>
              <X size={14} /> {t("Reject")}
            </button>
            {g.status !== "Pending" && (
              <button type="button" className="small-btn" disabled={busy} onClick={() => setEditing(false)}>
                {t("Cancel")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="pqc-verdict">
          <span className={"cue " + tone}>{g.settled ? t("Decided on the portal before our QC") : g.status === "Pending" ? t("Waiting for review") : t(g.status)}</span>
          {g.reviewed_by_name && <small>{g.reviewed_by_name}{g.reviewed_at ? " · " + new Date(g.reviewed_at).toLocaleDateString(tag) : ""}</small>}
          {g.comment && !(g.notes || []).length && <p className="wrap-text">{g.comment}</p>}
          {canDecide && g.status !== "Pending" && (
            <div className="pqc-actions">
              <button type="button" className="small-btn" disabled={busy} onClick={() => setEditing(true)}>
                <RotateCcw size={14} /> {t("Change the decision")}
              </button>
              {!noting && (
                <button type="button" className="small-btn" disabled={busy} onClick={() => setNoting(true)}>
                  <MessageSquarePlus size={14} /> {t("Add a comment")}
                </button>
              )}
            </div>
          )}
          {noting && (
            <div className="pqc-decide">
              <textarea rows={2} maxLength={2000} placeholder={t("A new comment, kept with the earlier ones")} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="pqc-actions">
                <button type="button" className="small-btn" disabled={busy} onClick={addNote}>
                  <Check size={14} /> {t("Save comment")}
                </button>
                <button type="button" className="small-btn" disabled={busy} onClick={() => setNoting(false)}>
                  {t("Cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function PortalQc() {
  const t = useT();
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("Pending");
  const [reviewer, setReviewer] = useState("All");
  const [provider, setProvider] = useState("All");
  const [limit, setLimit] = useState(pageSize);

  // A decision shows on its card at once and the queue reloads behind it. A
  // reload that began before a later decision was saved would bring that card
  // back as waiting, so its answer is dropped and the queue is read again;
  // reloads asked for while one runs become one more after it.
  const saved = useRef(0);
  const reloading = useRef(false);
  const reloadAgain = useRef(false);
  async function load() {
    if (reloading.current) {
      reloadAgain.current = true;
      return;
    }
    reloading.current = true;
    setLoading(true);
    setError("");
    try {
      do {
        reloadAgain.current = false;
        const seen = saved.current;
        const res = await fetch("/api/portal-qc", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || body.error) throw new Error(body?.error || t("Request failed"));
        if (seen === saved.current) setData(body);
        else reloadAgain.current = true;
      } while (reloadAgain.current);
    } catch (e: any) {
      setError(e.message);
    } finally {
      reloading.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Proof screenshots not fingerprinted yet are checked in the background, a
  // few at a time, and the queue reloads with what was found.
  const [scan, setScan] = useState<{ remaining: number; running: boolean } | null>(null);
  const remainingProofs = data?.proofs ? Number(data.proofs.total) - Number(data.proofs.checked) : 0;
  useEffect(() => {
    if (!data || remainingProofs <= 0 || scan?.running) return;
    let stop = false;
    (async () => {
      setScan({ remaining: remainingProofs, running: true });
      let rounds = 0;
      while (!stop && rounds++ < 200) {
        const res = await fetch("/api/portal-qc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check_proofs", request_id: crypto.randomUUID() }),
        }).catch(() => null);
        const body = res ? await res.json().catch(() => null) : null;
        if (!res?.ok || !body || body.error || !body.checked) break;
        setScan({ remaining: body.remaining, running: true });
        if (!body.remaining) break;
      }
      if (!stop) {
        setScan({ remaining: 0, running: false });
        load();
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.proofs?.total]);

  async function send(values: Row) {
    setBusy(true);
    try {
      const res = await fetch("/api/portal-qc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, request_id: crypto.randomUUID() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) throw new Error(body?.error || t("Request failed"));
      toast.success(t("Saved to the activity history"));
      saved.current++;
      // The decision on its card now; who decided, the thread and the rest come with the reload.
      if (values.action === "decide")
        setData((d) =>
          d && {
            ...d,
            reviews: (d.reviews || []).map((r: Row) =>
              r.portal_gig_id === values.portal_gig_id ? { ...r, status: values.status, comment: String(values.comment || "").trim() || null } : r,
            ),
          },
        );
      void load();
      return true;
    } catch (e: any) {
      toast.error(t(e.message));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const reviews: Row[] = data?.reviews || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reviews.filter(
      (r) =>
        (status === "All" || stateOf(r) === status) &&
        (reviewer === "All" || r.reviewer === reviewer) &&
        (provider === "All" || r.provider === provider) &&
        (!needle || [r.student_name, r.title, r.group_id, r.portal_student_id, r.url].some((v) => String(v || "").toLowerCase().includes(needle))),
    );
  }, [reviews, q, status, reviewer, provider]);
  // A student's gigs together, as they were handed out.
  const students = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filtered) m.set(r.portal_student_id, [...(m.get(r.portal_student_id) || []), r]);
    return [...m.entries()];
  }, [filtered]);
  useEffect(() => setLimit(pageSize), [q, status, reviewer, provider]);

  if (error) return <section className="panel"><p role="alert">{t(error)}</p><button className="small-btn" onClick={load}>{t("Try again")}</button></section>;
  if (!data) return <div className="dash-loading">{t("Loading…")}</div>;
  const count = (s: string) => reviews.filter((r) => stateOf(r) === s).length;
  const providers = [...new Set(reviews.map((r) => r.provider).filter(Boolean))].sort();

  return (
    <div className="fr pqc">
      <div className="fr-head">
        <div>
          <h2>{t("Portal gigs QC")}</h2>
          {scan?.running && (
            <small className="pqc-proof-hint">{t("Comparing proof pictures for duplicates: {v0} left", { v0: scan.remaining })}</small>
          )}
          <small>
            {t("Gigs uploaded on the ministry portal that the coach has not decided on yet. Check each one by the team's SOP; the coach and the coordinator see your verdict and the coach acts on the portal.")}
          </small>
        </div>
        <div className="detail-actions">
          {data.lead && (
            <button
              type="button"
              className="small-btn"
              disabled={busy || !count("Pending")}
              onClick={() => {
                if (window.confirm(t("Share the students waiting for review out again evenly? Each student moves with all their gigs."))) send({ action: "redistribute" });
              }}
            >
              <Shuffle size={14} /> {t("Share students out again")}
            </button>
          )}
          <button type="button" className="small-btn" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> {t("Refresh")}
          </button>
        </div>
      </div>
      {!data.sheet && <p className="footnote">{t("No gigs sheet has been uploaded yet. It is uploaded from the Gigs portal view.")}</p>}
      {data.sheet && !data.team && <p className="footnote" role="alert">{t("Add an active Quality Member before assigning reviews.")}</p>}

      <div className="fr-kpis fr-kpis-top">
        <div><span>{t("Waiting for review")}</span><strong><bdi dir="ltr">{count("Pending")}</bdi></strong></div>
        <div><span>{t("Approved")}</span><strong><bdi dir="ltr">{count("Approved")}</bdi></strong></div>
        <div className={count("Rejected") ? "is-bad" : ""}><span>{t("Rejected")}</span><strong><bdi dir="ltr">{count("Rejected")}</bdi></strong></div>
        {count("Settled") > 0 && <div><span>{t("Decided on the portal before our QC")}</span><strong><bdi dir="ltr">{count("Settled")}</bdi></strong></div>}
        <div><span>{t("Students")}</span><strong><bdi dir="ltr">{new Set(reviews.map((r) => r.portal_student_id)).size}</bdi></strong></div>
      </div>
      {data.lead && (data.reviewers || []).length > 0 && (
        <div className="pqc-load">
          {(data.reviewers || []).map((p: Row) => (
            <span key={p.id} className="cue is-info">{t("{v0}: {v1} students waiting", { v0: p.name, v1: p.pending })}</span>
          ))}
        </div>
      )}
      {data.lead && <PortalGap open />}

      <div className="fr-filters">
        <input className="fr-search" type="search" placeholder={t("Search student, gig, group or link")} value={q} onChange={(e) => setQ(e.target.value)} />
        <SearchableSelect
          label={t("Review")}
          value={status}
          onChange={setStatus}
          options={[
            { value: "Pending", label: t("Waiting for review") },
            { value: "Approved", label: t("Approved") },
            { value: "Rejected", label: t("Rejected") },
            { value: "Settled", label: t("Decided on the portal before our QC") },
            { value: "All", label: t("All") },
          ]}
        />
        {providers.length > 1 && (
          <SearchableSelect label={t("Provider")} value={provider} onChange={setProvider} options={[{ value: "All", label: t("All providers") }, ...providers.map((v) => ({ value: v, label: v }))]} />
        )}
        {data.lead && (
          <SearchableSelect
            label={t("Reviewer")}
            value={reviewer}
            onChange={setReviewer}
            options={[{ value: "All", label: t("Every reviewer") }, ...(data.reviewers || []).map((p: Row) => ({ value: p.id, label: p.name }))]}
          />
        )}
      </div>

      {!students.length ? (
        <section className="panel"><p className="footnote">{status === "Pending" ? t("Nothing waiting for your review.") : t("No gig matches these filters.")}</p></section>
      ) : (
        <>
          {students.slice(0, limit).map(([portalId, gigs]) => {
            const first = gigs[0];
            return (
              <section key={portalId} className="panel pqc-student">
                <header>
                  <div>
                    <strong>{first.student_name || portalId}</strong>
                    <small className="table-subline">
                      <bdi>{[first.group_id, first.track, first.provider].filter(Boolean).join(" · ") || t("Not linked")}</bdi>
                    </small>
                    <small className="table-subline pqc-guid">
                      {t("Portal student ID")}: <bdi dir="ltr">{portalId}</bdi>
                    </small>
                  </div>
                  {data.lead ? (
                    <SearchableSelect
                      label={t("Reviewer")}
                      value={first.reviewer}
                      onChange={(v) => v && v !== first.reviewer && send({ action: "reassign", portal_student_id: portalId, reviewer: v })}
                      options={[
                        ...(data.reviewers || []).map((p: Row) => ({ value: p.id, label: p.name })),
                        ...((data.reviewers || []).some((p: Row) => p.id === first.reviewer) ? [] : [{ value: first.reviewer, label: first.reviewer_name || first.reviewer }]),
                      ]}
                    />
                  ) : null}
                </header>
                <ul className="pqc-gigs">
                  {gigs.map((g) => (
                    <GigCheck key={g.portal_gig_id} g={g} canDecide={data.lead || g.reviewer === data.me} busy={busy} send={send} />
                  ))}
                </ul>
              </section>
            );
          })}
          {students.length > limit && (
            <button type="button" className="small-btn" onClick={() => setLimit(limit + pageSize)}>
              {t("Show more ({v0} more students)", { v0: students.length - limit })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
