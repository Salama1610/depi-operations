"use client";

// Students' feedback after their sessions, for the people who run the groups
// (see lib/domain/feedback.ts for the scoring rule and app/api/feedback for who
// sees what). Two modes: Total (the overall picture and its trend) and Weekly
// (one block per week, coach by coach). Red flags, sessions rated below 3 out
// of 5, lead the page; Coach Operations records what was done about each one.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Flag, RefreshCw } from "lucide-react";
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
            {target ? `${target.group_id} · ${t("Week {v0}", { v0: target.week })} · ${target.coach_name || t("No coach")} · ${day(target.starts_at)}` : ""}
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
            {error && <div className="form-error" role="alert">{error}</div>}
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
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("total");
  const [filters, setFilters] = useState({ group: "All", coach: "All" });
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

  const visibleSessions = sessions.filter(
    (s) => (filters.group === "All" || s.group_id === filters.group) && (filters.coach === "All" || (s.coach_id || "") === filters.coach),
  );
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
        <p>{error}</p>
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
      </TableRow>
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
        {(filters.group !== "All" || filters.coach !== "All") && (
          <button className="small-btn" onClick={() => setFilters({ group: "All", coach: "All" })}>{t("Clear filters")}</button>
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
