"use client";

// A coach's read-only view of their own students' progress (see
// app/api/coach-progress): gigs counted toward graduation (x of 3), their total
// in US dollars, and each gig's status in our review and on the ministry
// portal. View only: nothing here changes a record.

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";
import { GraduationDots } from "./today";

type Row = Record<string, any>;

/** Where a gig is in our review, in words a coach reads at a glance. */
const reviewWords: Record<string, { label: string; tone: string }> = {
  "Coordinator L1": { label: "Coordinator check", tone: "is-warn" },
  "Coach Review": { label: "Coordinator check", tone: "is-warn" },
  "Quality Review": { label: "Quality decision", tone: "is-warn" },
  "L3 Review": { label: "Final review", tone: "is-warn" },
  Returned: { label: "Returned for correction", tone: "is-bad" },
  Rejected: { label: "Rejected", tone: "is-bad" },
  Accepted: { label: "Approved", tone: "is-ok" },
  "Closed L3": { label: "Closed", tone: "is-info" },
};

function portalTone(value?: string | null) {
  const v = String(value || "");
  if (/approv|graduat|accept/i.test(v)) return "is-ok";
  if (/reject|not /i.test(v)) return "is-bad";
  return v ? "is-warn" : "is-info";
}

export function CoachProgress() {
  const t = useT();
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const day = (value?: string) => (value ? new Date(value).toLocaleDateString(tag, { timeZone: "Africa/Cairo", day: "numeric", month: "short" }) : "—");
  const usd = (value: number | null | undefined) => (value === null || value === undefined ? "—" : "$" + Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/coach-progress", { cache: "no-store" }).catch(() => {
        throw new Error(t("Check your connection and try again."));
      });
      const value = await response.json().catch(() => null);
      if (!response.ok || !value || value.error) throw new Error(value?.error || t("Unable to load your students' progress."));
      setData(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to load your students' progress."));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const students: Row[] = useMemo(() => data?.students || [], [data]);
  const needed = Number(data?.needed) || 3;
  const groups = [...new Set(students.map((s) => s.group_id))].sort();
  const shown = students.filter(
    (s) => (group === "All" || s.group_id === group) && (!query.trim() || String(s.name).toLowerCase().includes(query.trim().toLowerCase())),
  );
  const graduated = shown.filter((s) => /Graduat/.test(s.graduation || "")).length;

  if (!data && !error) return <div className="panel"><RefreshCw className="spin" size={18} /> {t("Loading your students' progress…")}</div>;
  if (error && !data)
    return (
      <div className="error-panel" role="alert">
        <p>{error}</p>
        <button className="primary" onClick={load}>{t("Try again")}</button>
      </div>
    );

  return (
    <div className="coach-progress">
      <p className="footnote">{t("Your students' gigs, as our reviewers and the ministry portal see them. This page is for following progress; nothing on it changes a record.")}</p>
      <div className="filter-row">
        <label className="field">
          {t("Group")}
          <SearchableSelect label={t("Group")} value={group} onChange={setGroup} options={[{ value: "All", label: t("Every group") }, ...groups.map((g) => ({ value: g, label: g }))]} />
        </label>
        <label className="field">
          {t("Student")}
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search by name")} />
        </label>
      </div>
      <div className="mini-stats">
        <span><strong>{shown.length}</strong>{t("Students")}</span>
        <span><strong>{graduated}</strong>{t("Graduated")}</span>
        <span><strong>{shown.filter((s) => !/Graduat/.test(s.graduation || "") && s.counted > 0).length}</strong>{t("On their way")}</span>
        <span><strong>{shown.filter((s) => !s.counted).length}</strong>{t("No approved gig yet")}</span>
      </div>
      {!shown.length ? (
        <section className="panel"><p className="footnote">{students.length ? t("No student matches this search.") : t("No students in your groups yet.")}</p></section>
      ) : (
        <section className="panel coach-progress-list">
          {shown.map((s) => (
            <details key={s.id} className="coach-progress-row">
              <summary>
                <span className="coach-progress-name">
                  <strong>{s.name}</strong>
                  <small>{s.group_id}</small>
                </span>
                <span className="coach-progress-count" title={t("Gigs that count toward graduation")}>
                  <GraduationDots graduation={s.graduation} />
                  {/Graduat/.test(s.graduation || "") ? t("Graduated") : t("{v0} of {v1} gigs", { v0: Math.min(s.counted, needed), v1: needed })}
                </span>
                <span className="coach-progress-total">{usd(s.total_usd)}</span>
                <span className={"cue " + portalTone(s.portal?.final_status)} title={t("Status on the ministry portal")}>
                  {s.portal?.final_status || t("Not on the portal yet")}
                </span>
              </summary>
              <div className="coach-progress-detail">
                <div>
                  <h3>{t("In our review")}</h3>
                  {!s.gigs.length ? (
                    <p className="footnote">{t("No gig recorded yet.")}</p>
                  ) : (
                    <ul>
                      {s.gigs.map((g: Row) => {
                        const word = reviewWords[g.review_status] || { label: g.review_status ? g.review_status : "Not submitted yet", tone: "is-info" };
                        return (
                          <li key={g.id}>
                            <span>{g.platform} · {usd(g.usd)} · {day(g.date)}</span>
                            <span className={"cue " + word.tone}>{t(word.label)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div>
                  <h3>{t("On the ministry portal")}</h3>
                  {!s.portal?.gigs?.length ? (
                    <p className="footnote">{s.portal ? t("No gig on the portal yet.") : t("This student is not linked to the portal sheet yet.")}</p>
                  ) : (
                    <ul>
                      {s.portal.gigs.map((g: Row) => (
                        <li key={g.id}>
                          <span>{g.title || t("Untitled gig")} · {usd(g.price)} · {day(g.date)}</span>
                          <span className="coach-progress-portal">
                            <span className={"cue " + portalTone(g.status)} title={t("Portal status")}>{g.status || "—"}</span>
                            <span className={"cue " + portalTone(g.auditor_status)} title={t("Auditor")}>{g.auditor_status || "—"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
