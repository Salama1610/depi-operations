"use client";

// The quality team's review of students' feedback after each session (see
// app/api/feedback-review for who sees what). Each session with feedback is
// given at random to one Quality Member, who opens its results, read the way a
// form's responses are summarised, and marks it reviewed. The Analysis tab
// reads the same results across whatever the filters select: one coach over all
// their groups, over a few groups or one, broken down by coach, group, session
// or week. The Students tab (the quality team only, not a coach) reads it
// student by student, with each student's responses one by one.

import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Shuffle, X } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { levelOf, scoreOf } from "@/lib/domain/feedback";
import { FeedbackScore, StudentFeedback, downloadCsv } from "./feedback-view";

type Row = Record<string, any>;

// The questions as the student's form asks them (app/student/page.tsx).
const ratingQuestions = [
  { key: "satisfaction", text: "How satisfied are you with today's session?" },
  { key: "clarity", text: "How clear was the coach's explanation?" },
  { key: "usefulness", text: "How useful was today's mentorship for you?" },
] as const;
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const yes = (v: any) => v === true || v === 1 || v === "1" || v === "true";
const average = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
const cairoParts = (iso: string) => {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }),
    weekday: d.toLocaleDateString("en-US", { timeZone: "Africa/Cairo", weekday: "long" }),
    time: d.toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }),
  };
};

/** Each response of one session with the student who gave it (the quality team only). */
function ResponseList({ responses }: { responses: Row[] }) {
  const t = useT();
  if (!responses.length) return null;
  return (
    <section className="fr-card">
      <h4>{t("Each response")}</h4>
      <div className="fr-table-wrap">
        <table className="fr-table">
          <thead>
            <tr>
              <th>{t("Student")}</th>
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
            {[...responses]
              .sort((a, b) => (scoreOf([a as any]) ?? 99) - (scoreOf([b as any]) ?? 99))
              .map((r) => (
                <tr key={r.id}>
                  <td><bdi>{r.student_name || r.student_id || "—"}</bdi></td>
                  <td><bdi dir="ltr">{r.satisfaction}</bdi></td>
                  <td><bdi dir="ltr">{r.clarity}</bdi></td>
                  <td><bdi dir="ltr">{r.usefulness}</bdi></td>
                  <td><FeedbackScore score={scoreOf([r as any])} /></td>
                  <td>{yes(r.searched_gig) ? t("Yes") : t("No")}</td>
                  <td><small>{r.liked || "—"}</small></td>
                  <td><small>{r.comments || "—"}</small></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One answer per row, as a form's summary shows it: the answer, its bar, how many and what share. */
function AnswerBars({ rows }: { rows: { label: string; count: number }[] }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  const most = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="fr-bars">
      {rows.map((r) => (
        <div className="fr-bar" key={r.label}>
          <span className="fr-bar-label">{r.label}</span>
          <span className="fr-bar-track" aria-hidden="true">
            <span className="fr-bar-fill" style={{ width: `${(100 * r.count) / most}%` }} />
          </span>
          <span className="fr-bar-value">
            <bdi dir="ltr">{r.count}</bdi> · <bdi dir="ltr">{total ? Math.round((100 * r.count) / total) : 0}%</bdi>
          </span>
        </div>
      ))}
    </div>
  );
}

/** The written answers, newest first; long lists open on request. */
function TextAnswers({ title, answers }: { title: string; answers: string[] }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? answers : answers.slice(0, 8);
  return (
    <section className="fr-card">
      <h4>{title}</h4>
      <small>{t("{v0} answers", { v0: answers.length })}</small>
      {answers.length ? (
        <ul className="fr-texts">
          {shown.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : (
        <p className="fr-empty">{t("No written answers.")}</p>
      )}
      {answers.length > 8 && (
        <button type="button" className="small-btn" onClick={() => setAll(!all)}>
          {all ? t("Show fewer") : t("Show all {v0}", { v0: answers.length })}
        </button>
      )}
    </section>
  );
}

/** Every response in the selection, summarised question by question, like a form's results. */
function FormSummary({ responses, sessions }: { responses: Row[]; sessions?: number }) {
  const t = useT();
  const score = scoreOf(responses as any);
  const searched = responses.filter((r) => yes(r.searched_gig)).length;
  const texts = (key: "liked" | "comments") =>
    responses
      .filter((r) => String(r[key] || "").trim())
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((r) => String(r[key]).trim());
  if (!responses.length) return <p className="fr-empty">{t("No feedback in this selection.")}</p>;
  return (
    <div className="fr-summary">
      <div className="fr-kpis">
        <div><span>{t("Responses")}</span><strong><bdi dir="ltr">{responses.length}</bdi></strong></div>
        {sessions !== undefined && <div><span>{t("Sessions")}</span><strong><bdi dir="ltr">{sessions}</bdi></strong></div>}
        <div><span>{t("Overall score")}</span><strong><FeedbackScore score={score} /></strong></div>
        <div><span>{t("Searched for a gig")}</span><strong><bdi dir="ltr">{Math.round((100 * searched) / responses.length)}%</bdi></strong></div>
      </div>
      <div className="fr-cards">
        {ratingQuestions.map((q) => {
          const values = responses.map((r) => Number(r[q.key])).filter((v) => v >= 1 && v <= 5);
          return (
            <section className="fr-card" key={q.key}>
              <h4>{t(q.text)}</h4>
              <small>
                {t("Average {v0} of 5", { v0: average(values) ?? "—" })} · {t("{v0} answers", { v0: values.length })}
              </small>
              <AnswerBars rows={[5, 4, 3, 2, 1].map((n) => ({ label: `${n} ★`, count: values.filter((v) => v === n).length }))} />
            </section>
          );
        })}
        <section className="fr-card">
          <h4>{t("Did you search for a gig through platforms?")}</h4>
          <small>{t("{v0} answers", { v0: responses.length })}</small>
          <AnswerBars rows={[{ label: t("Yes"), count: searched }, { label: t("No"), count: responses.length - searched }]} />
        </section>
        <TextAnswers title={t("What did you like most about today's session?")} answers={texts("liked")} />
        <TextAnswers title={t("Any comments or support needed?")} answers={texts("comments")} />
      </div>
    </div>
  );
}

export function FeedbackReview() {
  const t = useT();
  const locale = useLocale();
  const ar = locale === "ar";
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = { q: "", provider: "All", track: "All", groups: [] as string[], coach: "All", week: "All", from: "", to: "", day: "All", time: "All", reviewer: "All", status: "All" };
  const [f, setF] = useState<Row>(blank);
  const [by, setBy] = useState("coach");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/feedback-review", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) throw new Error(body?.error || t("Request failed"));
      setData(body);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(values: Row) {
    setBusy(true);
    try {
      const res = await fetch("/api/feedback-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, request_id: crypto.randomUUID() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) throw new Error(body?.error || t("Request failed"));
      toast.success(t("Saved to the activity history"));
      await load();
      return true;
    } catch (e: any) {
      toast.error(t(e.message));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const sessions: Row[] = useMemo(() => data?.sessions || [], [data]);
  const responses: Row[] = useMemo(() => data?.responses || [], [data]);
  const bySession = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of responses) m.set(r.session_id, [...(m.get(r.session_id) || []), r]);
    return m;
  }, [responses]);
  const dateTag = ar ? "ar-EG-u-nu-latn" : "en-GB";
  const when = (iso: string) =>
    new Date(iso).toLocaleString(dateTag, { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "numeric", hour12: true, minute: "2-digit" });

  const uniq = (xs: any[]) => [...new Set(xs.filter(Boolean))].sort() as string[];
  const shown = sessions.filter((s) => {
    const p = cairoParts(s.starts_at);
    const q = f.q.trim().toLowerCase();
    return (
      (!q || [s.title, s.group_id, s.coach_name, s.reviewer_name].some((v) => String(v || "").toLowerCase().includes(q))) &&
      (f.provider === "All" || s.provider === f.provider) &&
      (f.track === "All" || s.track === f.track) &&
      (!f.groups.length || f.groups.includes(s.group_id)) &&
      (f.coach === "All" || s.coach_id === f.coach) &&
      (f.week === "All" || String(s.week) === f.week) &&
      (!f.from || p.day >= f.from) &&
      (!f.to || p.day <= f.to) &&
      (f.day === "All" || p.weekday === f.day) &&
      (f.time === "All" || p.time === f.time) &&
      (f.reviewer === "All" || s.reviewer === f.reviewer) &&
      (f.status === "All" || s.status === f.status)
    );
  });
  const shownResponses = shown.flatMap((s) => bySession.get(s.id) || []);
  const scoreOfSession = (id: string) => scoreOf((bySession.get(id) || []) as any);
  const coaches = new Map<string, string>(sessions.filter((s) => s.coach_id).map((s) => [s.coach_id, s.coach_name || s.coach_id]));
  const opened = sessions.find((s) => s.id === openId) || null;

  // The breakdown: one row per coach, group, session or week of the selection.
  const breakdown = (() => {
    const keyOf = (s: Row) => (by === "coach" ? s.coach_id || "-" : by === "group" ? s.group_id : by === "week" ? String(s.week) : s.id);
    const nameOf = (s: Row) =>
      by === "coach" ? s.coach_name || t("No coach recorded") : by === "group" ? s.group_id : by === "week" ? t("Week {v0}", { v0: s.week }) : `${s.group_id} · ${t("Week {v0}", { v0: s.week })}`;
    const rows = new Map<string, Row>();
    for (const s of shown) {
      const k = keyOf(s);
      const row = rows.get(k) || { key: k, name: nameOf(s), sessions: 0, responses: [] as Row[] };
      row.sessions += 1;
      row.responses.push(...(bySession.get(s.id) || []));
      rows.set(k, row);
    }
    return [...rows.values()]
      .map((r): Row => ({
        ...r,
        satisfaction: average(r.responses.map((x: Row) => Number(x.satisfaction))),
        clarity: average(r.responses.map((x: Row) => Number(x.clarity))),
        usefulness: average(r.responses.map((x: Row) => Number(x.usefulness))),
        score: scoreOf(r.responses),
      }))
      .sort((a, b) => (a.score ?? 99) - (b.score ?? 99) || a.name.localeCompare(b.name));
  })();
  const pick = (r: Row) => {
    if (by === "coach" && r.key !== "-") setF({ ...f, coach: r.key });
    else if (by === "group") setF({ ...f, groups: [r.key] });
    else if (by === "week") setF({ ...f, week: r.key });
    else if (by === "session") openSession(r.key);
  };
  function openSession(id: string) {
    setOpenId(id);
    setNote(sessions.find((s) => s.id === id)?.note || "");
  }

  if (error && !data)
    return (
      <div className="fr">
        <p className="form-error">{error}</p>
        <button type="button" className="small-btn" onClick={load}>{t("Try again")}</button>
      </div>
    );
  if (!data) return <div className="dash-loading">{t("Loading…")}</div>;

  const pending = shown.filter((s) => s.status === "Pending").length;
  const flagged = shown.filter((s) => levelOf(scoreOfSession(s.id)) === "flag").length;
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const opt = (all: string, values: { value: string; label: string }[]) => [{ value: "All", label: all }, ...values];
  const active = JSON.stringify(f) !== JSON.stringify(blank);

  return (
    <div className="fr">
      <div className="fr-head">
        <div>
          <h2>{data.coach ? t("Your sessions' feedback") : t("Session feedback review")}</h2>
          <small>
            {data.coach
              ? t("What your students said after each session you led. You can read it; nobody can change it.")
              : data.lead
              ? t("Each session with feedback goes at random to one Quality Member. You see every review and can hand one to someone else.")
              : t("The sessions given to you. Open one to read its results, then mark it reviewed.")}
          </small>
        </div>
        <div className="detail-actions">
          {data.lead && (
            <button
              type="button"
              className="small-btn"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("Share every pending review out again, at random and evenly?"))) send({ action: "redistribute" });
              }}
            >
              <Shuffle size={14} /> {t("Share pending reviews out again")}
            </button>
          )}
          <button type="button" className="small-btn" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> {t("Refresh")}
          </button>
        </div>
      </div>

      <div className="fr-filters">
        <input className="fr-search" type="search" placeholder={t("Search session, group or coach")} value={f.q} onChange={(e) => set("q", e.target.value)} />
        <SearchableSelect label={t("Provider")} value={f.provider} onChange={(v) => set("provider", v)} options={opt(t("All providers"), uniq(sessions.map((s) => s.provider)).map((v) => ({ value: v, label: v })))} />
        <SearchableSelect label={t("Track")} value={f.track} onChange={(v) => set("track", v)} options={opt(t("Every track"), uniq(sessions.map((s) => s.track)).map((v) => ({ value: v, label: t(v) })))} />
        <SearchableSelect
          label={t("Groups")}
          value=""
          placeholder={f.groups.length ? t("Add a group") : t("All groups")}
          onChange={(v) => v && !f.groups.includes(v) && set("groups", [...f.groups, v])}
          options={uniq(sessions.filter((s) => f.track === "All" || s.track === f.track).map((s) => s.group_id)).map((v) => ({ value: v, label: v }))}
        />
        {!data.coach && <SearchableSelect label={t("Coach")} value={f.coach} onChange={(v) => set("coach", v)} options={opt(t("All coaches"), [...coaches].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)))} />}
        <SearchableSelect label={t("Week")} value={f.week} onChange={(v) => set("week", v)} options={opt(t("Every week"), uniq(sessions.map((s) => String(s.week))).sort((a, b) => Number(a) - Number(b)).map((v) => ({ value: v, label: t("Week {v0}", { v0: v }) })))} />
        <SearchableSelect label={t("Day")} value={f.day} onChange={(v) => set("day", v)} options={opt(t("Every day"), weekdays.filter((d) => sessions.some((s) => cairoParts(s.starts_at).weekday === d)).map((d) => ({ value: d, label: t(d) })))} />
        <SearchableSelect label={t("Time")} value={f.time} onChange={(v) => set("time", v)} options={opt(t("Any time"), uniq(sessions.map((s) => cairoParts(s.starts_at).time)).map((v) => ({ value: v, label: v })))} />
        <label className="fr-date">{t("From")}<input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set("from", e.target.value)} /></label>
        <label className="fr-date">{t("To")}<input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set("to", e.target.value)} /></label>
        {data.lead && (
          <SearchableSelect label={t("Reviewer")} value={f.reviewer} onChange={(v) => set("reviewer", v)} options={opt(t("Every reviewer"), (data.reviewers || []).map((p: Row) => ({ value: p.id, label: p.name })))} />
        )}
        {!data.coach && <SearchableSelect label={t("Review")} value={f.status} onChange={(v) => set("status", v)} options={opt(t("Pending and reviewed"), [{ value: "Pending", label: t("Waiting for review") }, { value: "Reviewed", label: t("Reviewed") }])} />}
      </div>
      {(f.groups.length > 0 || active) && (
        <div className="dash-chips">
          {f.groups.map((g: string) => (
            <button key={g} type="button" className="dash-chip" onClick={() => set("groups", f.groups.filter((x: string) => x !== g))}>
              <bdi>{g}</bdi> <X size={12} />
            </button>
          ))}
          {active && (
            <button type="button" className="small-btn" onClick={() => setF(blank)}>
              {t("Clear filters")}
            </button>
          )}
        </div>
      )}

      <div className="fr-kpis fr-kpis-top">
        <div><span>{t("Sessions")}</span><strong><bdi dir="ltr">{shown.length}</bdi></strong></div>
        {!data.coach && <div><span>{t("Waiting for review")}</span><strong><bdi dir="ltr">{pending}</bdi></strong></div>}
        {!data.coach && <div><span>{t("Reviewed")}</span><strong><bdi dir="ltr">{shown.length - pending}</bdi></strong></div>}
        <div><span>{t("Responses")}</span><strong><bdi dir="ltr">{shownResponses.length}</bdi></strong></div>
        <div><span>{t("Overall score")}</span><strong><FeedbackScore score={scoreOf(shownResponses as any)} /></strong></div>
        <div className={flagged ? "is-bad" : ""}><span>{t("Red flags")}</span><strong><bdi dir="ltr">{flagged}</bdi></strong></div>
      </div>

      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">{t("Sessions")}</TabsTrigger>
          {!data.coach && <TabsTrigger value="students">{t("Students")}</TabsTrigger>}
          <TabsTrigger value="analysis">{t("Analysis")}</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <section className="fr-panel">
            <header>
              <h3>{t("Sessions with feedback · {v0}", { v0: shown.length })}</h3>
              <button
                type="button"
                className="small-btn"
                onClick={() =>
                  downloadCsv(
                    "session-feedback",
                    shown.map((s) => ({
                      session: s.title, group: s.group_id, week: s.week, date: cairoParts(s.starts_at).day, time: cairoParts(s.starts_at).time,
                      coach: s.coach_name || "", responses: (bySession.get(s.id) || []).length, score: scoreOfSession(s.id) ?? "",
                      ...(data.coach ? {} : { reviewer: s.reviewer_name || "", review: s.status, note: s.note || "" }),
                    })),
                  )
                }
              >
                <Download size={14} /> {t("Export CSV")}
              </button>
            </header>
            {shown.length ? (
              <div className="fr-table-wrap">
                <table className="fr-table">
                  <thead>
                    <tr>
                      <th>{t("Session")}</th>
                      <th>{t("Week")}</th>
                      <th>{t("Date")}</th>
                      <th>{t("Coach")}</th>
                      <th>{t("Responses")}</th>
                      <th>{t("Score")}</th>
                      {data.lead && <th>{t("Reviewer")}</th>}
                      {!data.coach && <th>{t("Review")}</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.title || t("Session")}</strong>
                          <small className="table-subline"><bdi>{s.group_id}</bdi></small>
                        </td>
                        <td>{t("Week {v0}", { v0: s.week })}</td>
                        <td>{when(s.starts_at)}</td>
                        <td>{s.coach_name || "—"}</td>
                        <td><bdi dir="ltr">{(bySession.get(s.id) || []).length}</bdi></td>
                        <td><FeedbackScore score={scoreOfSession(s.id)} /></td>
                        {data.lead && <td>{s.reviewer_name || "—"}</td>}
                        {!data.coach && (
                          <td>
                            <span className={"cue " + (s.status === "Reviewed" ? "is-ok" : "is-warn")}>
                              {s.status === "Reviewed" ? t("Reviewed") : t("Waiting for review")}
                            </span>
                          </td>
                        )}
                        <td>
                          <button type="button" className="small-btn" onClick={() => openSession(s.id)}>
                            {t("Open results")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="fr-empty">{sessions.length ? t("No session matches these filters.") : t("No session feedback to review yet.")}</p>
            )}
          </section>
        </TabsContent>

        {!data.coach && (
          <TabsContent value="students">
            <StudentFeedback sessions={shown} responses={shownResponses} name="session-feedback-by-student" />
          </TabsContent>
        )}

        <TabsContent value="analysis">
          <section className="fr-panel">
            <header>
              <h3>{t("Results for the selection")}</h3>
              <small>
                {f.coach !== "All" ? coaches.get(f.coach) : t("All coaches")} ·{" "}
                {f.groups.length ? f.groups.join(ar ? "، " : ", ") : t("All groups")}
              </small>
            </header>
            <FormSummary responses={shownResponses} sessions={shown.length} />
          </section>
          <section className="fr-panel">
            <header>
              <h3>{t("Broken down")}</h3>
              <div className="detail-actions">
                <SearchableSelect
                  label={t("Break down by")}
                  value={by}
                  onChange={setBy}
                  options={[
                    { value: "coach", label: t("Coach") },
                    { value: "group", label: t("Group") },
                    { value: "session", label: t("Session") },
                    { value: "week", label: t("Week") },
                  ]}
                />
                <button
                  type="button"
                  className="small-btn"
                  onClick={() =>
                    downloadCsv(
                      "feedback-by-" + by,
                      breakdown.map((r) => ({ name: r.name, sessions: r.sessions, responses: r.responses.length, satisfaction: r.satisfaction ?? "", clarity: r.clarity ?? "", usefulness: r.usefulness ?? "", score: r.score ?? "" })),
                    )
                  }
                >
                  <Download size={14} /> {t("Export CSV")}
                </button>
              </div>
            </header>
            <small className="fr-hint">{t("Lowest score first. Click a row to narrow the results to it.")}</small>
            <div className="fr-table-wrap">
              <table className="fr-table">
                <thead>
                  <tr>
                    <th>{by === "coach" ? t("Coach") : by === "group" ? t("Group") : by === "week" ? t("Week") : t("Session")}</th>
                    <th>{t("Sessions")}</th>
                    <th>{t("Responses")}</th>
                    <th>{t("Satisfaction")}</th>
                    <th>{t("Clarity")}</th>
                    <th>{t("Usefulness")}</th>
                    <th>{t("Score")}</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((r) => (
                    <tr key={r.key} className="fr-pick" onClick={() => pick(r)}>
                      <td><bdi>{r.name}</bdi></td>
                      <td><bdi dir="ltr">{r.sessions}</bdi></td>
                      <td><bdi dir="ltr">{r.responses.length}</bdi></td>
                      <td><bdi dir="ltr">{r.satisfaction ?? "—"}</bdi></td>
                      <td><bdi dir="ltr">{r.clarity ?? "—"}</bdi></td>
                      <td><bdi dir="ltr">{r.usefulness ?? "—"}</bdi></td>
                      <td><FeedbackScore score={r.score} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(opened)} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="fr-dialog">
          {opened && (
            <>
              <DialogHeader>
                <DialogTitle>{opened.title || t("Session")}</DialogTitle>
                <DialogDescription>
                  <bdi>{opened.group_id}</bdi> · {t("Week {v0}", { v0: opened.week })} · {when(opened.starts_at)} · {t("Coach")}{" "}
                  {opened.coach_name || "—"}
                </DialogDescription>
              </DialogHeader>
              <FormSummary responses={bySession.get(opened.id) || []} />
              {!data.coach && <ResponseList responses={bySession.get(opened.id) || []} />}
              {!data.coach && <section className="fr-review">
                <h4>{t("Your review")}</h4>
                <small>
                  {t("Reviewer")} {opened.reviewer_name || "—"}
                  {opened.reviewed_at ? " · " + t("Reviewed {v0}", { v0: when(opened.reviewed_at) }) : ""}
                </small>
                {(data.lead || opened.reviewer === data.me) && (
                  <>
                    <textarea
                      value={note}
                      maxLength={2000}
                      placeholder={t("What stands out in this session's feedback, and anything to follow up")}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="detail-actions">
                      <button type="button" className="primary" disabled={busy} onClick={() => send({ action: "review", session_id: opened.id, note, status: "Reviewed" })}>
                        {opened.status === "Reviewed" ? t("Save the note") : t("Mark reviewed")}
                      </button>
                      {opened.status === "Reviewed" && (
                        <button type="button" className="small-btn" disabled={busy} onClick={() => send({ action: "review", session_id: opened.id, note, status: "Pending" })}>
                          {t("Open it again")}
                        </button>
                      )}
                    </div>
                  </>
                )}
                {data.lead && <small>{t("Give it to")}</small>}
                {data.lead && (
                  <SearchableSelect
                    label={t("Give it to")}
                    value={opened.reviewer || ""}
                    onChange={(v) => v !== opened.reviewer && send({ action: "reassign", session_id: opened.id, reviewer: v })}
                    options={(data.reviewers || []).map((p: Row) => ({ value: p.id, label: p.name }))}
                  />
                )}
              </section>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
