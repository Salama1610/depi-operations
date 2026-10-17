"use client";

// Students' feedback after their sessions, for the people who run the groups
// (see lib/domain/feedback.ts for the scoring rule and app/api/feedback for who
// sees what). Three modes: Total (the overall picture and its trend), Weekly
// (one block per week, coach by coach) and By student (each student's
// responses). Red flags, sessions rated below 3 out of 5, lead the page; Coach
// Operations records what was done about each one. Coach Operations and Project
// Operations also see the quality team's note on each session it reviewed.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Flag, RefreshCw } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/searchable-select";
import { levelOf, openFlags, scoreOf, sessionSummaries, totals, trendByWeek, weeklyBlocks } from "@/lib/domain/feedback";

type Row = Record<string, any>;

/** Reads a JSON reply; a gateway's HTML error page becomes the caller's own sentence. */
async function readJson(response: Response, failed: string) {
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || value.error) throw new Error(value?.error || failed);
  return value;
}

function useDay() {
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  return (value: string) => new Date(value).toLocaleDateString(tag, { timeZone: "Africa/Cairo", day: "numeric", month: "short" });
}

/** A score with its colour, icon and word: never colour alone. */
export function FeedbackScore({ score }: { score: number | null | undefined }) {
  const t = useT();
  const level = levelOf(score ?? null);
  if (score === null || score === undefined || !level) return <span className="cue is-info">—</span>;
  const tone = level === "good" ? "is-ok" : level === "watch" ? "is-warn" : "is-bad";
  const Icon = level === "good" ? CheckCircle2 : level === "watch" ? AlertTriangle : Flag;
  const word = level === "good" ? t("Good") : level === "watch" ? t("Watch") : t("Red flag");
  return (
    <span className={"cue feedback-score " + tone} title={word}>
      <Icon size={13} aria-hidden="true" />
      {score.toFixed(1)}
      <span className="feedback-score-word">{word}</span>
    </span>
  );
}

const said = (v: any) => v === true || v === 1 || v === "1" || v === "true";

/** Rows to a CSV file, with a byte-order mark so a spreadsheet reads Arabic. */
export function downloadCsv(name: string, rows: Row[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const cell = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const text = "﻿" + [keys.map(cell).join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** A date and time in Cairo, on the 12-hour clock. */
function useCairoTime() {
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  return (value?: string | null) =>
    value
      ? new Date(value).toLocaleString(tag, { timeZone: "Africa/Cairo", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      : "—";
}

/** One row per student who answered: how many times, their average and lowest score, and what they said last. */
export function studentSummaries(sessions: Row[], responses: Row[]) {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const byStudent = new Map<string, Row[]>();
  for (const r of responses) {
    if (!sessionById.has(r.session_id)) continue;
    const key = String(r.student_id || "");
    if (!key) continue;
    byStudent.set(key, [...(byStudent.get(key) || []), r]);
  }
  return [...byStudent.entries()].map(([key, list]) => {
    const newest = [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const scores = list.map((r) => scoreOf([r as any])).filter((n): n is number => n !== null);
    return {
      key,
      name: String(list.find((r) => r.student_name)?.student_name || key),
      groups: [...new Set(list.map((r) => sessionById.get(r.session_id)?.group_id).filter(Boolean))].sort() as string[],
      responses: newest,
      score: scoreOf(list as any),
      lowest: scores.length ? Math.min(...scores) : null,
      searched: Math.round((100 * list.filter((r) => said(r.searched_gig)).length) / list.length),
      latest: String(newest.find((r) => String(r.comments || "").trim())?.comments || "").trim(),
    };
  });
}

/**
 * Feedback student by student: one row per student in the selection, lowest
 * score first by default; opening a student lists each of their responses.
 */
export function StudentFeedback({ sessions, responses, name = "feedback-by-student" }: { sessions: Row[]; responses: Row[]; name?: string }) {
  const t = useT();
  const when = useCairoTime();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("lowest");
  const [low, setLow] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(100);
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const students = useMemo(() => studentSummaries(sessions, responses), [sessions, responses]);
  const needle = q.trim().toLowerCase();
  const list = students
    .filter(
      (s) =>
        (!needle || [s.name, s.key, ...s.groups].some((v) => String(v).toLowerCase().includes(needle))) &&
        (!low || (s.lowest ?? 5) < 3),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "responses"
        ? b.responses.length - a.responses.length || a.name.localeCompare(b.name)
        : sort === "score"
        ? (a.score ?? 99) - (b.score ?? 99) || a.name.localeCompare(b.name)
        : (a.lowest ?? 99) - (b.lowest ?? 99) || (a.score ?? 99) - (b.score ?? 99) || a.name.localeCompare(b.name),
    );
  const sessionOf = (r: Row) => sessionById.get(r.session_id) || {};
  return (
    <section className="fr-panel fs-students">
      <header>
        <h3>{t("Students · {v0}", { v0: list.length })}</h3>
        <button
          type="button"
          className="small-btn"
          disabled={!list.length}
          onClick={() =>
            downloadCsv(
              name,
              list.flatMap((s) =>
                s.responses.map((r: Row) => {
                  const x = sessionOf(r);
                  return {
                    student: s.name, student_id: s.key, group: x.group_id || "", session: x.title || "", week: x.week ?? "",
                    date: when(x.starts_at || r.created_at), satisfaction: r.satisfaction, clarity: r.clarity, usefulness: r.usefulness,
                    score: scoreOf([r as any]) ?? "", searched_gig: said(r.searched_gig) ? "Yes" : "No", liked: r.liked || "", comments: r.comments || "",
                    student_average: s.score ?? "", student_lowest: s.lowest ?? "",
                  };
                }),
              ),
            )
          }
        >
          <Download size={14} /> {t("Export CSV")}
        </button>
      </header>
      <div className="fs-tools">
        <input className="fr-search" type="search" placeholder={t("Search student, ID or group")} value={q} onChange={(e) => { setQ(e.target.value); setShown(100); }} />
        <SearchableSelect
          label={t("Sort by")}
          value={sort}
          onChange={setSort}
          options={[
            { value: "lowest", label: t("Lowest score first") },
            { value: "score", label: t("Lowest average first") },
            { value: "responses", label: t("Most responses first") },
            { value: "name", label: t("Name") },
          ]}
        />
        <label className="check"><Checkbox checked={low} onCheckedChange={(v) => { setLow(v === true); setShown(100); }} />{t("Only students who rated a session below 3")}</label>
      </div>
      <small className="fr-hint">{t("Open a student to see each of their responses.")}</small>
      {list.length ? (
        <div className="fr-table-wrap">
          <table className="fr-table">
            <thead>
              <tr>
                <th>{t("Student")}</th>
                <th>{t("Group")}</th>
                <th>{t("Responses")}</th>
                <th>{t("Average")}</th>
                <th>{t("Lowest score")}</th>
                <th>{t("Searched for a gig")}</th>
                <th>{t("Latest comment")}</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, shown).map((s) => {
                const expanded = open === s.key;
                return (
                  <Fragment key={s.key}>
                    <tr className="fr-pick" onClick={() => setOpen(expanded ? null : s.key)}>
                      <td>
                        <button type="button" className="fs-toggle" aria-expanded={expanded} onClick={(e) => { e.stopPropagation(); setOpen(expanded ? null : s.key); }}>
                          {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" className="fs-chevron" />}
                          <strong><bdi>{s.name}</bdi></strong>
                        </button>
                        <small className="table-subline"><bdi dir="ltr">{s.key}</bdi></small>
                      </td>
                      <td><bdi>{s.groups.join(", ") || "—"}</bdi></td>
                      <td><bdi dir="ltr">{s.responses.length}</bdi></td>
                      <td><FeedbackScore score={s.score} /></td>
                      <td><FeedbackScore score={s.lowest} /></td>
                      <td><bdi dir="ltr">{s.searched}%</bdi></td>
                      <td><small className="fs-comment">{s.latest || "—"}</small></td>
                    </tr>
                    {expanded && (
                      <tr className="fs-detail">
                        <td colSpan={7}>
                          <div className="fr-table-wrap">
                            <table className="fr-table">
                              <thead>
                                <tr>
                                  <th>{t("Session")}</th>
                                  <th>{t("Date")}</th>
                                  <th>{t("Satisfaction")}</th>
                                  <th>{t("Clarity")}</th>
                                  <th>{t("Usefulness")}</th>
                                  <th>{t("Score")}</th>
                                  <th>{t("Searched for a gig")}</th>
                                  <th>{t("Liked most")}</th>
                                  <th>{t("Comments or support needed")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {s.responses.map((r: Row) => {
                                  const x = sessionOf(r);
                                  return (
                                    <tr key={r.id}>
                                      <td>
                                        <strong>{x.title || t("Session")}</strong>
                                        <small className="table-subline"><bdi>{x.group_id}</bdi>{x.week !== undefined && x.week !== null ? <> · {t("Week {v0}", { v0: x.week })}</> : null}</small>
                                      </td>
                                      <td><bdi>{when(x.starts_at || r.created_at)}</bdi></td>
                                      <td><bdi dir="ltr">{r.satisfaction}</bdi></td>
                                      <td><bdi dir="ltr">{r.clarity}</bdi></td>
                                      <td><bdi dir="ltr">{r.usefulness}</bdi></td>
                                      <td><FeedbackScore score={scoreOf([r as any])} /></td>
                                      <td>{said(r.searched_gig) ? t("Yes") : t("No")}</td>
                                      <td><small>{r.liked || "—"}</small></td>
                                      <td><small>{r.comments || "—"}</small></td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fr-empty">{students.length ? t("No student matches these filters.") : t("No feedback in this view")}</p>
      )}
      {list.length > shown && <button type="button" className="small-btn" onClick={() => setShown(shown + 200)}>{t("Show more ({v0} left)", { v0: list.length - shown })}</button>}
    </section>
  );
}

/** Width of an element as it lays out, so a chart draws at its real size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The average by week on a fixed 1–5 scale, with a crosshair readout. */
function TrendChart({ points }: { points: { week: number; score: number; responses: number }[] }) {
  const t = useT();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 220;
  const pad = { top: 14, right: 18, bottom: 30, left: 30 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v: number) => pad.top + ((5 - v) / 4) * innerH;
  // Thin the week labels so they never collide on a narrow screen.
  const every = Math.max(1, Math.ceil((points.length * 34) / Math.max(1, innerW)));
  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const px = clientX - svg.getBoundingClientRect().left;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    return best;
  };
  const point = active === null ? null : points[active];
  return (
    <div className="chart-box" ref={ref}>
      {width > 0 && points.length > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t("Average rating by week, from {v0} to {v1}", { v0: points[0].score.toFixed(1), v1: points[points.length - 1].score.toFixed(1) })}
          tabIndex={0}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(points.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? points.length) - 1));
            if (e.key === "ArrowRight") setActive((i) => Math.min(points.length - 1, (i ?? -1) + 1));
          }}
        >
          {[1, 2, 3, 4, 5].map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} className={v === 3 ? "chart-grid is-threshold" : "chart-grid"} />
              <text x={pad.left - 8} y={y(v)} className="chart-tick" textAnchor="end" dominantBaseline="middle">{v}</text>
            </g>
          ))}
          {points.map((p, i) =>
            i % every === 0 || i === points.length - 1 ? (
              <text key={p.week} x={x(i)} y={height - 9} className="chart-tick" textAnchor="middle">{t("W{v0}", { v0: p.week })}</text>
            ) : null,
          )}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + innerH} className="chart-crosshair" />}
          <path d={points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join(" ")} className="chart-line" />
          {points.map((p, i) => (
            <circle key={p.week} cx={x(i)} cy={y(p.score)} r={i === active ? 5 : 4} className="chart-dot" />
          ))}
        </svg>
      )}
      {point && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(active!), 70), width - 70), top: y(point.score) - 10 }}>
          <strong>{point.score.toFixed(1)}</strong>
          <span>{t("Week {v0}", { v0: point.week })} · {t("{v0} ratings", { v0: point.responses })}</span>
        </div>
      )}
    </div>
  );
}

/** How often each rating 1 to 5 was given, one column each. */
function DistributionChart({ counts }: { counts: number[] }) {
  const t = useT();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 220;
  const pad = { top: 22, right: 8, bottom: 30, left: 8 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / 5;
  const bar = Math.min(24, slot * 0.6);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const base = pad.top + innerH;
  const column = (i: number) => {
    const h = (counts[i] / max) * innerH;
    const x0 = pad.left + slot * i + (slot - bar) / 2;
    const top = base - h;
    const r = Math.min(4, h, bar / 2);
    // Rounded at the data end, square at the baseline.
    return h <= 0 ? "" : `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bar - r} Q${x0 + bar},${top} ${x0 + bar},${top + r} V${base} Z`;
  };
  const words = [t("Poor"), "", "", "", t("Excellent")];
  return (
    <div className="chart-box" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={t("Ratings given: {v0}", { v0: counts.map((n, i) => `${i + 1}: ${n}`).join(", ") })}>
          <line x1={pad.left} x2={width - pad.right} y1={base} y2={base} className="chart-grid" />
          {counts.map((n, i) => (
            <g
              key={i}
              tabIndex={0}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={innerH + pad.bottom} fill="transparent" />
              <path d={column(i)} className={"chart-bar" + (active === i ? " is-active" : "")} />
              <text x={pad.left + slot * i + slot / 2} y={base - (n / max) * innerH - 6} className="chart-value" textAnchor="middle">{n}</text>
              <text x={pad.left + slot * i + slot / 2} y={height - 9} className="chart-tick" textAnchor="middle">{words[i] ? `${i + 1} ${words[i]}` : i + 1}</text>
            </g>
          ))}
        </svg>
      )}
      {active !== null && width > 0 && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(pad.left + slot * active + slot / 2, 70), width - 70), top: base - (counts[active] / max) * innerH - 26 }}>
          <strong>{counts[active]}</strong>
          <span>{t("Rated {v0}", { v0: active + 1 })} · {total ? Math.round((100 * counts[active]) / total) : 0}%</span>
        </div>
      )}
    </div>
  );
}

/**
 * The urgent card at the top of Coach Operations' first screen: how many red
 * flags nobody has handled yet. It is not shown when there are none.
 */
export function FeedbackAlertCard({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/feedback?summary=1", { cache: "no-store" })
      .then((r) => readJson(r, ""))
      .then((v) => live && setOpen(v.handles ? Number(v.open) || 0 : 0))
      .catch(() => live && setOpen(0));
    return () => {
      live = false;
    };
  }, []);
  if (!open) return null;
  return (
    <section className="feedback-alert" role="alert">
      <Flag size={22} aria-hidden="true" />
      <div>
        <strong>
          {open === 1
            ? t("1 session with low student feedback needs action")
            : t("{v0} sessions with low student feedback need action", { v0: open })}
        </strong>
        <p>{t("Students rated these sessions below 3 out of 5. Each stays here until someone records what was done.")}</p>
      </div>
      <button type="button" onClick={onOpen}>{t("Review now")}</button>
    </section>
  );
}

/** Coach Operations records what was done about one red flag, and may open a case. */
function HandleDialog({ target, responses, onClose, onDone }: { target: Row | null; responses: Row[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const day = useDay();
  const [note, setNote] = useState("");
  const [openCase, setOpenCase] = useState(false);
  const [caseTitle, setCaseTitle] = useState("");
  const [caseDue, setCaseDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!target) return;
    const due = new Date(Date.now() + 3 * 86400000);
    setNote("");
    setOpenCase(false);
    setCaseTitle(t("Low session feedback · {v0} · Week {v1}", { v0: target.group_id, v1: target.week }));
    setCaseDue(new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.session_id]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "handle_flag", session_id: target.session_id, note, open_case: openCase, case_title: caseTitle, case_due: caseDue }),
      }).catch(() => {
        throw new Error(t("Check your connection and try again."));
      });
      await readJson(response, t("Unable to save. Try again."));
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to save. Try again."));
    } finally {
      setBusy(false);
    }
  }
  const given = target ? responses.filter((r) => r.session_id === target.session_id) : [];
  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="action-dialog sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Handle a red flag")}</DialogTitle>
          <DialogDescription>
            {/* Each part isolated, so codes and names keep their order on an Arabic page. */}
            {target ? (
              <>
                <bdi>{target.group_id}</bdi> · <bdi>{t("Week {v0}", { v0: target.week })}</bdi> · <bdi>{target.coach_name || t("No coach")}</bdi> · <bdi>{day(target.starts_at)}</bdi>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        {target && (
          <form className="feedback-handle" onSubmit={submit}>
            <div className="feedback-handle-score">
              <FeedbackScore score={target.score} />
              <span>{t("{v0} ratings", { v0: target.responses })}</span>
            </div>
            <ul className="feedback-handle-list">
              {given.map((r) => (
                <li key={r.id}>
                  <span><strong>{r.student_name || r.student_id}</strong> · {r.satisfaction} · {r.clarity} · {r.usefulness}</span>
                  {r.comments ? <small>{r.comments}</small> : null}
                  {r.liked ? <small>{t("Liked most")}: {r.liked}</small> : null}
                </li>
              ))}
            </ul>
            <label className="field">
              {t("What was done")}
              <textarea required minLength={5} maxLength={2000} rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("For example: called the coach, agreed a change for next week's session.")} />
            </label>
            <label className="check">
              <Checkbox checked={openCase} onCheckedChange={(v) => setOpenCase(v === true)} />
              {t("Also open a case to follow up")}
            </label>
            {openCase && (
              <>
                <label className="field">
                  {t("Case title")}
                  <input required maxLength={200} value={caseTitle} onChange={(e) => setCaseTitle(e.target.value)} />
                </label>
                <label className="field">
                  {t("Case due")}
                  <input required type="date" value={caseDue} onChange={(e) => setCaseDue(e.target.value)} />
                </label>
              </>
            )}
            {error && <div className="form-error" role="alert">{t(error)}</div>}
            <div className="detail-actions">
              <button type="button" className="small-btn" onClick={onClose}>{t("Cancel")}</button>
              <button type="submit" className="primary" disabled={busy || note.trim().length < 5}>{busy ? t("Saving…") : t("Mark as handled")}</button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The Feedback tab in Sessions. */
export function FeedbackView() {
  const t = useT();
  const day = useDay();
  const when = useCairoTime();
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("total");
  const [filters, setFilters] = useState({ group: "All", coach: "All", noted: false });
  const [only, setOnly] = useState({ low: false, comments: false });
  const [shown, setShown] = useState(100);
  const [handling, setHandling] = useState<Row | null>(null);

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/feedback", { cache: "no-store" }).catch(() => {
        throw new Error(t("Check your connection and try again."));
      });
      setData(await readJson(response, t("Unable to load the feedback.")));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to load the feedback."));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessions: Row[] = useMemo(() => data?.sessions || [], [data]);
  const responses: Row[] = useMemo(() => data?.responses || [], [data]);
  const handled = useMemo(() => new Map<string, Row>((data?.handled || []).map((h: Row) => [h.session_id, h])), [data]);
  const handledIds = useMemo(() => new Set(handled.keys()), [handled]);
  const coachNames = useMemo(() => new Map<string, string>(sessions.filter((s) => s.coach_id).map((s) => [s.coach_id, s.coach_name || s.coach_id])), [sessions]);
  const coachName = (id?: string | null) => (id ? coachNames.get(id) || id : t("No coach"));
  // The quality team's review of each session, for Coach Operations and Project Operations only.
  const quality = Boolean(data?.quality);
  const reviews = useMemo(() => new Map<string, Row>((data?.reviews || []).map((r: Row) => [r.session_id, r])), [data]);
  const hasNote = (id: string) => Boolean(String(reviews.get(id)?.note || "").trim());

  const visibleSessions = sessions.filter(
    (s) =>
      (filters.group === "All" || s.group_id === filters.group) &&
      (filters.coach === "All" || (s.coach_id || "") === filters.coach) &&
      (!filters.noted || hasNote(s.id)),
  );
  const noted = visibleSessions.filter((s) => hasNote(s.id)).length;
  const sessionById = new Map(visibleSessions.map((s) => [s.id, s]));
  const rows = responses.filter((r) => sessionById.has(r.session_id));
  const summaries = sessionSummaries(visibleSessions as any, rows as any);
  const overall = totals(rows as any);
  const trend = trendByWeek(summaries, rows as any);
  const blocks = weeklyBlocks(summaries, rows as any, handledIds);
  const open = openFlags(summaries, handledIds);
  const flagged = summaries.filter((s) => s.level === "flag");
  const handles = Boolean(data?.handles);
  const detail = (s: Row) => ({ ...s, ...sessionById.get(s.session_id) });

  const groupOptions = [{ value: "All", label: t("Every group") }, ...[...new Set(sessions.map((s) => s.group_id))].sort().map((g) => ({ value: g, label: g }))];
  const coachOptions = [{ value: "All", label: t("Every coach") }, ...[...coachNames.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
  const listed = rows.filter(
    (r) => (!only.low || (scoreOf([r as any]) ?? 5) < 3) && (!only.comments || String(r.comments || r.liked || "").trim()),
  );
  const searched = rows.filter((r) => Number(r.searched_gig) === 1 || r.searched_gig === true).length;

  if (!data && !error)
    return <div className="panel"><RefreshCw className="spin" size={18} /> {t("Loading the feedback…")}</div>;
  if (error && !data)
    return (
      <div className="error-panel" role="alert">
        <p>{t(error)}</p>
        <button className="primary" onClick={load}>{t("Try again")}</button>
      </div>
    );

  const flagRow = (s: Row) => {
    const done = handled.get(s.session_id);
    return (
      <TableRow key={s.session_id}>
        <TableCell><span>{day(s.starts_at)}<small className="table-subline">{s.group_id} · {t("Week {v0}", { v0: s.week })}</small></span></TableCell>
        <TableCell>{coachName(s.coach_id)}</TableCell>
        <TableCell>{s.responses}</TableCell>
        <TableCell><FeedbackScore score={s.score} /></TableCell>
        <TableCell>
          {s.level !== "flag" ? (
            "—"
          ) : done ? (
            <span className="feedback-handled">
              {t("Handled by {v0}, {v1}", { v0: done.handled_by_name || done.handled_by, v1: day(done.handled_at) })}
              <small className="table-subline">{done.note}{done.case_id ? ` · ${t("Case")}: ${t(done.case_status || "Open")}` : ""}</small>
            </span>
          ) : handles ? (
            <button className="primary small" onClick={() => setHandling(detail(s))}>{t("Handle")}</button>
          ) : (
            <span className="cue is-bad">{t("Open")}</span>
          )}
        </TableCell>
        {quality && <TableCell>{qualityNote(s.session_id)}</TableCell>}
      </TableRow>
    );
  };
  /** The quality team's review of a session: its state, the note, and who wrote it when. */
  const qualityNote = (id: string) => {
    const r = reviews.get(id);
    if (!r) return "—";
    const done = r.status === "Reviewed";
    return (
      <span className="fs-quality">
        <span className={"cue " + (done ? "is-ok" : "is-warn")}>{done ? t("Reviewed") : t("Waiting for review")}</span>
        {r.note ? <small className="fs-note">{r.note}</small> : null}
        <small className="table-subline">
          {done
            ? t("By {v0}, {v1}", { v0: r.reviewer_name || r.reviewer || "—", v1: when(r.reviewed_at) })
            : t("Given to {v0}", { v0: r.reviewer_name || r.reviewer || "—" })}
        </small>
      </span>
    );
  };
  const sessionTable = (list: Row[]) => (
    <div className="table-wrap">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Session")}</TableHead>
            <TableHead>{t("Coach")}</TableHead>
            <TableHead>{t("Ratings")}</TableHead>
            <TableHead>{t("Average")}</TableHead>
            <TableHead>{t("Flag")}</TableHead>
            {quality && <TableHead>{t("Quality note")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>{list.map(flagRow)}</TableBody>
      </Table>
    </div>
  );

  return (
    <div className="feedback-view">
      <div className="filter-row">
        <label className="field">{t("Group")}<SearchableSelect label={t("Group")} value={filters.group} onChange={(group) => setFilters({ ...filters, group })} options={groupOptions} /></label>
        <label className="field">{t("Coach")}<SearchableSelect label={t("Coach")} value={filters.coach} onChange={(coach) => setFilters({ ...filters, coach })} options={coachOptions} /></label>
        {quality && (
          <label className="check">
            <Checkbox checked={filters.noted} onCheckedChange={(v) => setFilters({ ...filters, noted: v === true })} />
            {t("Only sessions with a quality note")}
          </label>
        )}
        {(filters.group !== "All" || filters.coach !== "All" || filters.noted) && (
          <button className="small-btn" onClick={() => setFilters({ group: "All", coach: "All", noted: false })}>{t("Clear filters")}</button>
        )}
      </div>

      {flagged.length > 0 && (
        <section className={"panel feedback-flags" + (handles && open.length ? " is-urgent" : "")}>
          <div className="panel-heading">
            <h2><Flag size={18} aria-hidden="true" /> {t("Red flags")}</h2>
            <span className={"cue " + (open.length ? "is-bad" : "is-ok")}>{t("{v0} open", { v0: open.length })}</span>
          </div>
          <p className="footnote">{t("A session whose students rated it below 3 out of 5. It stays open until Coach Operations records what was done.")}</p>
          {sessionTable([...open, ...flagged.filter((s) => handledIds.has(s.session_id))])}
        </section>
      )}

      <Tabs value={mode} onValueChange={setMode}>
        <TabsList>
          <TabsTrigger value="total">{t("Total")}</TabsTrigger>
          <TabsTrigger value="weekly">{t("Weekly")}</TabsTrigger>
          <TabsTrigger value="students">{t("By student")}</TabsTrigger>
        </TabsList>

        <TabsContent value="total">
          {!rows.length ? (
            <section className="panel"><p className="footnote">{t("No feedback in this view yet. Students give it on their page once a session has ended.")}</p></section>
          ) : (
            <>
              <div className="mini-stats">
                <span><strong><FeedbackScore score={overall.score} /></strong>{t("Overall average")}</span>
                <span><strong>{overall.responses}</strong>{t("Ratings")}</span>
                <span><strong>{summaries.length}</strong>{t("Sessions rated")}</span>
                <span><strong>{open.length}</strong>{t("Red flags open")}</span>
                <span><strong>{Math.round((100 * searched) / rows.length)}%</strong>{t("Searched for work on the platforms")}</span>
                {quality && <span><strong>{noted}</strong>{t("Sessions with a quality note")}</span>}
              </div>
              <div className="feedback-charts">
                <section className="panel">
                  <div className="panel-heading"><h2>{t("Rating distribution")}</h2></div>
                  <p className="footnote">{t("How often each rating was given, across the three questions.")}</p>
                  <DistributionChart counts={overall.distribution} />
                </section>
                <section className="panel">
                  <div className="panel-heading"><h2>{t("Average rating by week")}</h2></div>
                  <p className="footnote">{t("The line at 3 is where a session becomes a red flag.")}</p>
                  <TrendChart points={trend} />
                </section>
              </div>
              <div className="mini-stats">
                <span><strong><FeedbackScore score={overall.satisfaction} /></strong>{t("Satisfaction")}</span>
                <span><strong><FeedbackScore score={overall.clarity} /></strong>{t("Coach's clarity")}</span>
                <span><strong><FeedbackScore score={overall.usefulness} /></strong>{t("Mentorship usefulness")}</span>
              </div>
              <section className="panel">
                <div className="panel-heading"><h2>{t("Rated sessions")}</h2></div>
                {sessionTable(summaries)}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>{t("Responses")}</h2>
                  <span className="feedback-only">
                    <label className="check"><Checkbox checked={only.low} onCheckedChange={(v) => { setOnly({ ...only, low: v === true }); setShown(100); }} />{t("Only below 3")}</label>
                    <label className="check"><Checkbox checked={only.comments} onCheckedChange={(v) => { setOnly({ ...only, comments: v === true }); setShown(100); }} />{t("Only with written comments")}</label>
                  </span>
                </div>
                <div className="table-wrap">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Session")}</TableHead>
                        <TableHead>{t("Coach")}</TableHead>
                        <TableHead>{t("Student")}</TableHead>
                        <TableHead>{t("Ratings")}</TableHead>
                        <TableHead>{t("Searched for work on the platforms")}</TableHead>
                        <TableHead>{t("Liked most")}</TableHead>
                        <TableHead>{t("Comments or support needed")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {listed.slice(0, shown).map((r) => {
                        const s = sessionById.get(r.session_id) || {};
                        return (
                          <TableRow key={r.id}>
                            <TableCell><span>{s.starts_at ? day(s.starts_at) : "—"}<small className="table-subline">{s.group_id} · {t("Week {v0}", { v0: s.week })}</small></span></TableCell>
                            <TableCell>{coachName(s.coach_id)}</TableCell>
                            <TableCell>{r.student_name || r.student_id}</TableCell>
                            <TableCell><span className="feedback-ratings" title={t("Satisfaction · clarity · usefulness")}><FeedbackScore score={scoreOf([r as any])} /> <small>{r.satisfaction} · {r.clarity} · {r.usefulness}</small></span></TableCell>
                            <TableCell>{Number(r.searched_gig) === 1 || r.searched_gig === true ? t("Yes") : t("No")}</TableCell>
                            <TableCell><small>{r.liked || "—"}</small></TableCell>
                            <TableCell><small>{r.comments || "—"}</small></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {!listed.length && <p className="footnote">{t("No feedback in this view")}</p>}
                {listed.length > shown && <button className="small-btn" onClick={() => setShown(shown + 200)}>{t("Show more ({v0} left)", { v0: listed.length - shown })}</button>}
              </section>
            </>
          )}
        </TabsContent>

        <TabsContent value="weekly">
          {!blocks.length && <section className="panel"><p className="footnote">{t("No feedback in this view yet. Students give it on their page once a session has ended.")}</p></section>}
          {blocks.map((block) => (
            <section className={"panel feedback-week" + (block.open_flags && handles ? " is-urgent" : "")} key={block.week}>
              <div className="panel-heading">
                <h2>{t("Week {v0}", { v0: block.week })}</h2>
                <span className="feedback-week-summary">
                  <FeedbackScore score={block.score} />
                  <span>{t("{v0} ratings", { v0: block.responses })}</span>
                  <span className={"cue " + (block.open_flags ? "is-bad" : block.flags ? "is-ok" : "is-info")}>
                    {block.flags ? t("{v0} flags · {v1} open", { v0: block.flags, v1: block.open_flags }) : t("No flags")}
                  </span>
                </span>
              </div>
              <div className="table-wrap">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Coach")}</TableHead>
                      <TableHead>{t("Sessions")}</TableHead>
                      <TableHead>{t("Ratings")}</TableHead>
                      <TableHead>{t("Average")}</TableHead>
                      <TableHead>{t("Flags")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {block.coaches.map((c) => (
                      <TableRow key={c.coach_id || "none"}>
                        <TableCell>{coachName(c.coach_id)}</TableCell>
                        <TableCell>{c.sessions}</TableCell>
                        <TableCell>{c.responses}</TableCell>
                        <TableCell><FeedbackScore score={c.score} /></TableCell>
                        <TableCell>{c.flags ? <span className={"cue " + (c.open_flags ? "is-bad" : "is-ok")}>{t("{v0} flags · {v1} open", { v0: c.flags, v1: c.open_flags })}</span> : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ))}
        </TabsContent>

        <TabsContent value="students">
          <StudentFeedback sessions={visibleSessions} responses={rows} />
        </TabsContent>
      </Tabs>

      <HandleDialog
        target={handling}
        responses={responses}
        onClose={() => setHandling(null)}
        onDone={() => {
          setHandling(null);
          load();
        }}
      />
    </div>
  );
}
