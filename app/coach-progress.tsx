"use client";

// A coach's read-only view of their own students' progress (see
// app/api/coach-progress): gigs counted toward graduation (x of 3), their total
// in US dollars, the portal's summary of accepted and rejected gigs, and, for
// the week chosen, attendance and the gigs added. View only: nothing here
// changes a record, and contact follow-up stays with the coordinators.

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useDir, useLocale, useT } from "@/lib/i18n/context";
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

/** The Cairo calendar day of an instant, as YYYY-MM-DD. */
function cairoDay(at: string | number | Date) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
const shiftDay = (day: string, n: number) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The Friday that opens the programme week (Friday to Thursday) containing `day`. */
const fridayOf = (day: string) => shiftDay(day, -((new Date(day + "T12:00:00Z").getUTCDay() - 5 + 7) % 7));

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
  // The programme week shown, Friday to Thursday: 0 is this week.
  const [week, setWeek] = useState(0);
  const dir = useDir();

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
  const from = shiftDay(fridayOf(cairoDay(Date.now())), week * 7);
  const to = shiftDay(from, 7);
  const inWeek = (at?: string) => !!at && cairoDay(at) >= from && cairoDay(at) < to;
  const weekLabel = `${new Date(from + "T12:00:00Z").toLocaleDateString(tag, { day: "numeric", month: "short", timeZone: "UTC" })} – ${new Date(shiftDay(to, -1) + "T12:00:00Z").toLocaleDateString(tag, { day: "numeric", month: "short", timeZone: "UTC" })}`;
  // What each student did in the chosen week.
  const weekOf = (s: Row) => {
    const marks = (s.attendance || []).filter((a: Row) => inWeek(a.at));
    const gigs = (s.portal?.gigs || []).filter((g: Row) => inWeek(g.date));
    return {
      attended: marks.some((a: Row) => a.present) ? "yes" : marks.length ? "no" : "none",
      gigs: gigs.length,
      approved: gigs.filter((g: Row) => /approv|accept/i.test(String(g.auditor_status || g.status || ""))).length,
      rejected: gigs.filter((g: Row) => /reject/i.test(String(g.auditor_status || g.status || ""))).length,
    };
  };
  const weekRows = shown.map(weekOf);

  if (!data && !error) return <div className="panel"><RefreshCw className="spin" size={18} /> {t("Loading your students' progress…")}</div>;
  if (error && !data)
    return (
      <div className="error-panel" role="alert">
        <p>{t(error)}</p>
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
      <div className="filter-row">
        <div className="week-nav" role="group" aria-label={t("Week")}>
          <button type="button" className="small-btn" onClick={() => setWeek(week - 1)} aria-label={t("Previous week")}>
            {dir === "rtl" ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <span className="week-nav-label">
            <strong>{weekLabel}</strong>
            <small>{week === 0 ? t("This week") : week === -1 ? t("Last week") : week === 1 ? t("Next week") : week > 0 ? t("In {v0} weeks", { v0: week }) : t("{v0} weeks ago", { v0: -week })}</small>
          </span>
          <button type="button" className="small-btn" onClick={() => setWeek(week + 1)} aria-label={t("Next week")}>
            {dir === "rtl" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
          {week !== 0 && <button type="button" className="small-btn" onClick={() => setWeek(0)}>{t("This week")}</button>}
        </div>
      </div>
      <div className="mini-stats">
        <span><strong>{shown.length}</strong>{t("Students")}</span>
        <span><strong>{graduated}</strong>{t("Graduated")}</span>
        <span><strong>{weekRows.filter((w) => w.attended === "yes").length}</strong>{t("Attended this week")}</span>
        <span><strong>{weekRows.filter((w) => w.attended === "no").length}</strong>{t("Missed this week")}</span>
        <span><strong>{weekRows.reduce((n, w) => n + w.approved, 0)}</strong>{t("Gigs accepted this week")}</span>
        <span><strong>{weekRows.reduce((n, w) => n + w.rejected, 0)}</strong>{t("Gigs rejected this week")}</span>
      </div>
      {!shown.length ? (
        <section className="panel"><p className="footnote">{students.length ? t("No student matches this search.") : t("No students in your groups yet.")}</p></section>
      ) : (
        <section className="panel coach-progress-list">
          {shown.map((s, i) => (
            <details key={s.id} className="coach-progress-row">
              <summary>
                <span className="coach-progress-name">
                  <strong>{s.name}</strong>
                  <small>{s.group_id}</small>
                </span>
                {/* The portal sheet's summary: gigs accepted and rejected, of all its gigs. */}
                <span className="coach-progress-portal-sum" title={t("On the ministry portal")}>
                  {s.portal && s.portal.total !== null ? (
                    <>
                      <span className="cue is-ok">{t("{v0} accepted", { v0: s.portal.approved ?? 0 })}</span>
                      <span className="cue is-bad">{t("{v0} rejected", { v0: s.portal.rejected ?? 0 })}</span>
                      <small>{t("of {v0}", { v0: s.portal.total })}</small>
                    </>
                  ) : (
                    <small>{t("Not on the portal yet")}</small>
                  )}
                </span>
                <span className="coach-progress-week" title={t("The week shown")}>
                  <span className={"cue " + (weekRows[i].attended === "yes" ? "is-ok" : weekRows[i].attended === "no" ? "is-bad" : "is-info")}>
                    {weekRows[i].attended === "yes" ? t("Attended") : weekRows[i].attended === "no" ? t("Absent") : t("No session marked")}
                  </span>
                  {weekRows[i].gigs > 0 && <small>{t("{v0} new gigs", { v0: weekRows[i].gigs })}</small>}
                </span>
                <span className="coach-progress-count" title={t("Gigs that count toward graduation")}>
                  <GraduationDots graduation={s.graduation} />
                  {/Graduat/.test(s.graduation || "") ? t("Graduated") : t("{v0} of {v1} gigs", { v0: Math.min(s.counted, needed), v1: needed })}
                </span>
                <span className="coach-progress-total">{usd(s.total_usd)}</span>
                <span className={"cue " + portalTone(s.portal?.final_status)} title={t("Status on the ministry portal")}>
                  {s.portal?.final_status ? t(s.portal.final_status) : t("Not on the portal yet")}
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
                            <span><bdi>{g.platform}</bdi> · <bdi>{usd(g.usd)}</bdi> · <bdi>{day(g.date)}</bdi></span>
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
                          <span><bdi>{g.title || t("Untitled gig")}</bdi> · <bdi>{usd(g.price)}</bdi> · <bdi>{day(g.date)}</bdi></span>
                          <span className="coach-progress-portal">
                            <span className={"cue " + portalTone(g.status)} title={t("Portal status")}>{g.status ? t(g.status) : "—"}</span>
                            <span className={"cue " + portalTone(g.auditor_status)} title={t("Auditor")}>{g.auditor_status ? t(g.auditor_status) : "—"}</span>
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
