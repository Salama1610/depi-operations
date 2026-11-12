"use client";

// The coach's Gigs tab (see app/api/coach-gigs): the portal gigs our quality
// team has approved or rejected, each with its gig link and proof link, the
// verdict and comment, and the student's portal record (the portal's ID,
// name, email, phone and round) so the coach finds them on the ministry
// portal and carries the decision out there. Nothing here changes a record.

import { useEffect, useState } from "react";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";
import { QcThread } from "@/components/qc-thread";
import { coachStatusOf } from "@/lib/domain/portal-figures";

type Row = Record<string, any>;

// The Overview notice and the Gigs tab share one read: opening the tab right
// after the Overview does not ask again within a minute (12 November 2026).
// The tab's Refresh button always asks afresh.
let shared: { at: number; gigs: Promise<Row[]> } | null = null;
async function loadGigs(fresh = false): Promise<Row[]> {
  if (!fresh && shared && Date.now() - shared.at < 60_000) return shared.gigs;
  const gigs = (async () => {
    const r = await fetch("/api/coach-gigs", { cache: "no-store" });
    const v = await r.json().catch(() => null);
    if (!r.ok || !v || v.error) throw new Error(v?.error || "Request failed");
    return (v.gigs || []) as Row[];
  })();
  shared = { at: Date.now(), gigs };
  gigs.catch(() => (shared = null));
  return gigs;
}

/** On the coach's Overview: how many checked gigs wait for them, and a way to the Gigs tab. */
export function CoachGigsNotice({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const [waiting, setWaiting] = useState<number | null>(null);
  useEffect(() => {
    loadGigs()
      .then((gigs) => setWaiting(gigs.filter((g) => g.waiting).length))
      .catch(() => setWaiting(null));
  }, []);
  if (!waiting) return null;
  return (
    <div className="coach-gigs-notice">
      <strong>{t("{v0} gigs checked by our quality team are waiting for you on the portal", { v0: waiting })}</strong>
      <button type="button" className="primary" onClick={onOpen}>
        {t("Open Gigs")}
      </button>
    </div>
  );
}

export function CoachGigs() {
  const t = useT();
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const day = (value?: string) => (value ? new Date(value).toLocaleDateString(tag, { timeZone: "Africa/Cairo", day: "numeric", month: "short" }) : "—");
  const [gigs, setGigs] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [verdict, setVerdict] = useState<"Approved" | "Rejected" | "All">("Approved");
  const [state, setState] = useState<"waiting" | "all">("waiting");
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");

  async function load(fresh = false) {
    setError("");
    try {
      setGigs(await loadGigs(fresh));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(t("Copied")),
      () => toast.error(t("Could not copy")),
    );
  };

  if (error)
    return (
      <div className="error-panel" role="alert">
        <p>{t(error)}</p>
        <button className="primary" onClick={() => load(true)}>{t("Try again")}</button>
      </div>
    );
  if (!gigs) return <div className="dash-loading">{t("Loading…")}</div>;

  const groups = [...new Set(gigs.map((g) => g.student.group_id).filter(Boolean))].sort();
  const q = query.trim().toLowerCase();
  const base = gigs.filter(
    (g) =>
      (state === "all" || g.waiting) &&
      (group === "All" || g.student.group_id === group) &&
      (!q || [g.student.name, g.student.portal_name, g.student.id, g.student.portal_id, g.student.email, g.student.phone, g.title].some((v) => String(v || "").toLowerCase().includes(q))),
  );
  const approved = base.filter((g) => g.qc_status === "Approved");
  const rejected = base.filter((g) => g.qc_status === "Rejected");
  const list = verdict === "All" ? base : verdict === "Approved" ? approved : rejected;

  return (
    <div className="coach-gigs">
      <p className="footnote">
        {t("The gigs our quality team has checked. Open the gig and its proof, find the student on the ministry portal by their portal ID, then approve or reject the gig there as the verdict says. A gig stops waiting once the next portal sheet shows your decision.")}
      </p>
      <div className="filter-row">
        <label className="field">
          {t("Group")}
          <SearchableSelect label={t("Group")} value={group} onChange={setGroup} options={[{ value: "All", label: t("Every group") }, ...groups.map((g) => ({ value: g, label: g }))]} />
        </label>
        <label className="field">
          {t("Showing")}
          <SearchableSelect
            label={t("Showing")}
            value={state}
            onChange={(v) => setState(v as "waiting" | "all")}
            options={[
              { value: "waiting", label: t("Waiting for you on the portal") },
              { value: "all", label: t("Every checked gig") },
            ]}
          />
        </label>
        <label className="field">
          {t("Student")}
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Name, ID, portal ID, email or phone")} />
        </label>
        <button type="button" className="small-btn" onClick={() => load(true)}>
          <RefreshCw size={14} /> {t("Refresh")}
        </button>
      </div>
      <div className="coach-qc-tabs" role="group" aria-label={t("Our QC")}>
        {(
          [
            ["Approved", t("Approved by QC · {v0}", { v0: approved.length })],
            ["Rejected", t("Rejected by QC · {v0}", { v0: rejected.length })],
            ["All", t("All · {v0}", { v0: base.length })],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" className={"small-btn" + (verdict === value ? " is-on" : "")} aria-pressed={verdict === value} onClick={() => setVerdict(value)}>
            {label}
          </button>
        ))}
      </div>
      {list.length ? (
        <ul className="coach-gigs-list">
          {list.map((g) => (
            <li key={g.id} className={g.qc_status === "Approved" ? "is-ok" : "is-bad"}>
              <div className="coach-gigs-student">
                <strong>{g.student.name || g.student.portal_name || "—"}</strong>
                <small>
                  <bdi>{g.student.id}</bdi> · <bdi>{g.student.group_id}</bdi>
                </small>
                {g.student.portal_id && (
                  <span className="coach-gigs-guid">
                    <small>{t("Portal ID")}</small>
                    <code dir="ltr">{g.student.portal_id}</code>
                    <button type="button" className="icon-btn" title={t("Copy the portal ID")} aria-label={t("Copy the portal ID")} onClick={() => copy(g.student.portal_id)}>
                      <Copy size={13} />
                    </button>
                  </span>
                )}
                {g.student.portal_name && g.student.portal_name !== g.student.name && <small>{t("On the portal: {v0}", { v0: g.student.portal_name })}</small>}
                {g.student.email && <small><bdi dir="ltr">{g.student.email}</bdi></small>}
                {g.student.phone && <small><bdi dir="ltr">{g.student.phone}</bdi></small>}
                <small>
                  {[g.student.round_code, g.student.provider, g.student.final_status].filter(Boolean).join(" · ")}
                </small>
                {g.student.proofs.length > 0 && (
                  <span className="coach-gigs-links">
                    {g.student.proofs.map((p: string, i: number) => (
                      <a key={p + i} className="text-link" href={p} target="_blank" rel="noreferrer">
                        {t("Student proof {v0}", { v0: i + 1 })} <ExternalLink size={11} />
                      </a>
                    ))}
                  </span>
                )}
              </div>
              <div className="coach-gigs-gig">
                <strong className="wrap-text">{g.title || t("Gig")}</strong>
                <small>
                  {g.price !== null && g.price !== undefined ? "$" + g.price + " · " : ""}
                  {day(g.date)}
                  {coachStatusOf(g) ? " · " + t("Coach on the portal: {v0}", { v0: t(coachStatusOf(g)) }) : ""}
                </small>
                <span className="coach-gigs-links">
                  {g.url ? (
                    <a className="small-btn" href={g.url} target="_blank" rel="noreferrer">
                      {t("Open the gig")} <ExternalLink size={12} />
                    </a>
                  ) : (
                    <small>{t("No gig link")}</small>
                  )}
                  {g.proof_url ? (
                    <a className="small-btn" href={g.proof_url} target="_blank" rel="noreferrer">
                      {t("Open the proof")} <ExternalLink size={12} />
                    </a>
                  ) : (
                    <small>{t("No proof link")}</small>
                  )}
                </span>
              </div>
              <div className="coach-gigs-verdict">
                <span className={"cue " + (g.qc_status === "Approved" ? "is-ok" : "is-bad")}>
                  {g.waiting ? (g.qc_status === "Approved" ? t("Approve it on the portal") : t("Reject it on the portal")) : g.qc_status === "Approved" ? t("Approved by QC") : t("Rejected by QC")}
                </span>
                {(g.qc_notes || []).length ? (
                  <QcThread notes={g.qc_notes} className="coach-progress-qc" />
                ) : (
                  g.qc_comment && <small className="coach-progress-qc wrap-text" dir="auto">{g.qc_comment}</small>
                )}
                {g.qc_at && <small>{t("Checked {v0}", { v0: day(g.qc_at) })}</small>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <section className="panel">
          <p className="footnote">{gigs.length ? t("Nothing in this list.") : t("Our quality team has not checked any of your students' gigs yet.")}</p>
        </section>
      )}
    </div>
  );
}
