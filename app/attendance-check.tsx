"use client";

// The quality team's check of each held session's attendance register (see
// app/api/attendance-check for who sees what). Quality opens a session, reads
// who was marked present or absent and by whom, and marks the register Valid
// or Has problems with a comment. The marks themselves are not changed here;
// Coach Operations and Project Operations read the checks and act on them.

import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Row = Record<string, any>;

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const page = 25;
const cairoParts = (iso: string) => {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }),
    weekday: d.toLocaleDateString("en-US", { timeZone: "Africa/Cairo", weekday: "long" }),
    // 24-hour key for sorting and filtering; shown to people in 12-hour form.
    time: d.toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }),
  };
};
const checkOf = (s: Row) => s.check_status || "Not checked";
const cueOf = (status: string) => (status === "Valid" ? "is-ok" : status === "Has problems" ? "is-bad" : "is-warn");

function downloadCsv(name: string, rows: Row[]) {
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

export function AttendanceCheck() {
  const t = useT();
  const locale = useLocale();
  const ar = locale === "ar";
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const blankOf = (checks: boolean): Row => ({
    q: "", provider: "All", track: "All", groups: [] as string[], coach: "All", week: "All", from: "", to: "", day: "All", time: "All", checker: "All",
    status: checks ? "Not checked" : "All",
  });
  const [f, setF] = useState<Row | null>(null);
  const [limit, setLimit] = useState(page);
  const [openId, setOpenId] = useState<string | null>(null);
  const [register, setRegister] = useState<Row[] | null>(null);
  const [registerError, setRegisterError] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/attendance-check", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) throw new Error(body?.error || t("Request failed"));
      setData(body);
      setF((old) => old || blankOf(Boolean(body.checks)));
    } catch (e: any) {
      setError(t(e.message));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openSession(id: string) {
    setOpenId(id);
    setRegister(null);
    setRegisterError("");
    setNote(sessions.find((s) => s.id === id)?.check_note || "");
    try {
      const res = await fetch("/api/attendance-check?session=" + encodeURIComponent(id), { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) throw new Error(body?.error || t("Request failed"));
      setRegister(body.register || []);
    } catch (e: any) {
      setRegisterError(t(e.message));
    }
  }

  async function send(values: Row) {
    setBusy(true);
    try {
      const res = await fetch("/api/attendance-check", {
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

  const sessions: Row[] = data?.sessions || [];
  const dateTag = ar ? "ar-EG-u-nu-latn" : "en-GB";
  const when = (iso: string) =>
    new Date(iso).toLocaleString(dateTag, { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "numeric", hour12: true, minute: "2-digit" });
  const clock = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(ar ? "ar-EG-u-nu-latn" : "en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true });
  };

  if (error && !data)
    return (
      <div className="fr">
        <p className="form-error">{error}</p>
        <button type="button" className="small-btn" onClick={load}>{t("Try again")}</button>
      </div>
    );
  if (!data || !f) return <div className="dash-loading">{t("Loading…")}</div>;

  const checks = Boolean(data.checks);
  const blank = blankOf(checks);
  const uniq = (xs: any[]) => [...new Set(xs.filter(Boolean))].sort() as string[];
  const shown = sessions.filter((s) => {
    const p = cairoParts(s.starts_at);
    const q = f.q.trim().toLowerCase();
    return (
      (!q || [s.title, s.group_id, s.coach_name, s.coordinator_name, s.checked_by_name, s.check_note, ...(s.recorded_by || [])].some((v) => String(v || "").toLowerCase().includes(q))) &&
      (f.provider === "All" || s.provider === f.provider) &&
      (f.track === "All" || s.track === f.track) &&
      (!f.groups.length || f.groups.includes(s.group_id)) &&
      (f.coach === "All" || s.coach_id === f.coach) &&
      (f.week === "All" || String(s.week) === f.week) &&
      (!f.from || p.day >= f.from) &&
      (!f.to || p.day <= f.to) &&
      (f.day === "All" || p.weekday === f.day) &&
      (f.time === "All" || p.time === f.time) &&
      (f.checker === "All" || s.checked_by === f.checker) &&
      (f.status === "All" || checkOf(s) === f.status)
    );
  });
  const coaches = new Map<string, string>(sessions.filter((s) => s.coach_id).map((s) => [s.coach_id, s.coach_name || s.coach_id]));
  const checkers = new Map<string, string>(sessions.filter((s) => s.checked_by).map((s) => [s.checked_by, s.checked_by_name || s.checked_by]));
  const opened = sessions.find((s) => s.id === openId) || null;
  const count = (status: string) => shown.filter((s) => checkOf(s) === status).length;
  const present = shown.reduce((n, s) => n + s.present, 0);
  const marked = shown.reduce((n, s) => n + s.marked, 0);
  const set = (k: string, v: any) => {
    setF({ ...f, [k]: v });
    setLimit(page);
  };
  const opt = (all: string, values: { value: string; label: string }[]) => [{ value: "All", label: all }, ...values];
  const active = JSON.stringify(f) !== JSON.stringify(blank);
  const statusLabel = (status: string) => t(status);
  const unmarked = (s: Row) => Math.max(0, s.enrolled - s.marked);

  return (
    <div className="fr">
      <div className="fr-head">
        <div>
          <h2>{t("Attendance check")}</h2>
          <small>
            {checks
              ? t("Open a held session to read its register, then mark it Valid or Has problems with a comment. Coach Operations and Project Operations read your check; the marks themselves are not changed.")
              : t("The quality team checks each held session's register. You see every check and its comment; correcting the marks stays with the people who run the group.")}
          </small>
        </div>
        <div className="detail-actions">
          <button type="button" className="small-btn" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> {t("Refresh")}
          </button>
        </div>
      </div>

      <div className="fr-filters">
        <input className="fr-search" type="search" placeholder={t("Search session, group, coach or comment")} value={f.q} onChange={(e) => set("q", e.target.value)} />
        <SearchableSelect label={t("Provider")} value={f.provider} onChange={(v) => set("provider", v)} options={opt(t("All providers"), uniq(sessions.map((s) => s.provider)).map((v) => ({ value: v, label: v })))} />
        <SearchableSelect label={t("Track")} value={f.track} onChange={(v) => set("track", v)} options={opt(t("Every track"), uniq(sessions.map((s) => s.track)).map((v) => ({ value: v, label: t(v) })))} />
        <SearchableSelect
          label={t("Groups")}
          value=""
          placeholder={f.groups.length ? t("Add a group") : t("All groups")}
          onChange={(v) => v && !f.groups.includes(v) && set("groups", [...f.groups, v])}
          options={uniq(sessions.filter((s) => f.track === "All" || s.track === f.track).map((s) => s.group_id)).map((v) => ({ value: v, label: v }))}
        />
        <SearchableSelect label={t("Coach")} value={f.coach} onChange={(v) => set("coach", v)} options={opt(t("All coaches"), [...coaches].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)))} />
        <SearchableSelect label={t("Week")} value={f.week} onChange={(v) => set("week", v)} options={opt(t("Every week"), uniq(sessions.map((s) => String(s.week))).sort((a, b) => Number(a) - Number(b)).map((v) => ({ value: v, label: t("Week {v0}", { v0: v }) })))} />
        <SearchableSelect label={t("Day")} value={f.day} onChange={(v) => set("day", v)} options={opt(t("Every day"), weekdays.filter((d) => sessions.some((s) => cairoParts(s.starts_at).weekday === d)).map((d) => ({ value: d, label: t(d) })))} />
        <SearchableSelect label={t("Time")} value={f.time} onChange={(v) => set("time", v)} options={opt(t("Any time"), uniq(sessions.map((s) => cairoParts(s.starts_at).time)).map((v) => ({ value: v, label: clock(v) })))} />
        <label className="fr-date">{t("From")}<input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set("from", e.target.value)} /></label>
        <label className="fr-date">{t("To")}<input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set("to", e.target.value)} /></label>
        <SearchableSelect label={t("Checked by")} value={f.checker} onChange={(v) => set("checker", v)} options={opt(t("Anyone"), [...checkers].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)))} />
        <SearchableSelect
          label={t("Check")}
          value={f.status}
          onChange={(v) => set("status", v)}
          options={opt(t("Every check"), ["Not checked", "Valid", "Has problems"].map((v) => ({ value: v, label: statusLabel(v) })))}
        />
      </div>
      {(f.groups.length > 0 || active) && (
        <div className="dash-chips">
          {f.groups.map((g: string) => (
            <button key={g} type="button" className="dash-chip" onClick={() => set("groups", f.groups.filter((x: string) => x !== g))}>
              <bdi>{g}</bdi> <X size={12} />
            </button>
          ))}
          {active && (
            <button type="button" className="small-btn" onClick={() => { setF(blank); setLimit(page); }}>
              {t("Clear filters")}
            </button>
          )}
        </div>
      )}

      <div className="fr-kpis fr-kpis-top">
        <div><span>{t("Sessions")}</span><strong><bdi dir="ltr">{shown.length}</bdi></strong></div>
        <div className={count("Not checked") ? "is-warn" : ""}><span>{t("Not checked")}</span><strong><bdi dir="ltr">{count("Not checked")}</bdi></strong></div>
        <div className="is-ok"><span>{t("Valid")}</span><strong><bdi dir="ltr">{count("Valid")}</bdi></strong></div>
        <div className={count("Has problems") ? "is-bad" : ""}><span>{t("Has problems")}</span><strong><bdi dir="ltr">{count("Has problems")}</bdi></strong></div>
        <div>
          <span>{t("Attendance rate")}</span>
          <strong><bdi dir="ltr">{marked ? Math.round((100 * present) / marked) + "%" : "—"}</bdi></strong>
        </div>
      </div>

      <section className="fr-panel">
        <header>
          <h3>{t("Held sessions · {v0}", { v0: shown.length })}</h3>
          <button
            type="button"
            className="small-btn"
            disabled={!shown.length}
            onClick={() =>
              downloadCsv(
                "attendance-check",
                shown.map((s) => ({
                  session: s.title, group: s.group_id, track: s.track || "", provider: s.provider || "", week: s.week,
                  date: cairoParts(s.starts_at).day, time: clock(cairoParts(s.starts_at).time), coach: s.coach_name || "", coordinator: s.coordinator_name || "",
                  present: s.present, absent: s.absent, not_marked: unmarked(s), recorded_by: (s.recorded_by || []).join("; "),
                  check: checkOf(s), note: s.check_note || "", checked_by: s.checked_by_name || "", checked_at: s.checked_at ? when(s.checked_at) : "",
                })),
              )
            }
          >
            <Download size={14} /> {t("Export CSV")}
          </button>
        </header>
        {shown.length ? (
          <>
            <div className="fr-table-wrap">
              <table className="fr-table">
                <thead>
                  <tr>
                    <th>{t("Session")}</th>
                    <th>{t("Date")}</th>
                    <th>{t("Coach")}</th>
                    <th>{t("Present")}</th>
                    <th>{t("Absent")}</th>
                    <th>{t("Not marked")}</th>
                    <th>{t("Recorded by")}</th>
                    <th>{t("Check")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, limit).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.title || t("Session")}</strong>
                        <small className="table-subline"><bdi>{s.group_id}</bdi> · {t("Week {v0}", { v0: s.week })}</small>
                      </td>
                      <td className="ac-nowrap">{when(s.starts_at)}</td>
                      <td>{s.coach_name || "—"}</td>
                      <td><bdi dir="ltr">{s.present}</bdi></td>
                      <td><bdi dir="ltr">{s.absent}</bdi></td>
                      <td className={unmarked(s) ? "ac-gap" : ""}><bdi dir="ltr">{unmarked(s)}</bdi></td>
                      <td>{(s.recorded_by || []).length ? (s.recorded_by as string[]).join(ar ? "، " : ", ") : "—"}</td>
                      <td>
                        <span className={"cue " + cueOf(checkOf(s))}>{statusLabel(checkOf(s))}</span>
                        {s.checked_by_name && <small className="table-subline">{s.checked_by_name}</small>}
                      </td>
                      <td>
                        <button type="button" className="small-btn" onClick={() => openSession(s.id)}>
                          {t("Open register")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length > limit && (
              <button type="button" className="small-btn ac-more" onClick={() => setLimit(limit + page)}>
                {t("Show {v0} more", { v0: Math.min(page, shown.length - limit) })} · {t("{v0} of {v1}", { v0: limit, v1: shown.length })}
              </button>
            )}
          </>
        ) : (
          <p className="fr-empty">{sessions.length ? t("No session matches these filters.") : t("No held session to check yet.")}</p>
        )}
      </section>

      <Dialog open={Boolean(opened)} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent className="fr-dialog">
          {opened && (
            <>
              <DialogHeader>
                <DialogTitle>{opened.title || t("Session")}</DialogTitle>
                <DialogDescription>
                  <bdi>{opened.group_id}</bdi> · {t("Week {v0}", { v0: opened.week })} · {when(opened.starts_at)} · {t("Coach")} {opened.coach_name || "—"}
                  {opened.coordinator_name ? <> · {t("Coordinator")} {opened.coordinator_name}</> : null}
                </DialogDescription>
              </DialogHeader>

              <div className="fr-kpis">
                <div><span>{t("Present")}</span><strong><bdi dir="ltr">{opened.present}</bdi></strong></div>
                <div><span>{t("Absent")}</span><strong><bdi dir="ltr">{opened.absent}</bdi></strong></div>
                <div className={unmarked(opened) ? "is-warn" : ""}><span>{t("Not marked")}</span><strong><bdi dir="ltr">{unmarked(opened)}</bdi></strong></div>
                <div><span>{t("Students in the group")}</span><strong><bdi dir="ltr">{opened.enrolled}</bdi></strong></div>
              </div>

              {registerError ? (
                <p className="form-error">{registerError}</p>
              ) : !register ? (
                <div className="dash-loading">{t("Loading…")}</div>
              ) : register.length ? (
                <div className="fr-table-wrap">
                  <table className="fr-table">
                    <thead>
                      <tr>
                        <th>{t("Student")}</th>
                        <th>{t("Attendance")}</th>
                        <th>{t("Marked by")}</th>
                        <th>{t("When")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {register.map((r) => (
                        <tr key={r.student_id}>
                          <td>
                            <bdi>{r.student_name}</bdi>
                            <small className="table-subline">
                              <bdi dir="ltr">{r.student_id}</bdi>
                              {r.student_group && r.student_group !== opened.group_id ? <> · {t("Now in {v0}", { v0: r.student_group })}</> : null}
                            </small>
                          </td>
                          <td>
                            <span className={"cue " + (r.status === "Present" ? "is-ok" : r.status === "Absent" ? "is-bad" : "is-warn")}>
                              {r.status ? t(r.status) : t("Not marked")}
                            </span>
                          </td>
                          <td>{r.recorder_name || "—"}</td>
                          <td className="ac-nowrap">{r.updated_at ? when(r.updated_at) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="fr-empty">{t("Nobody is on this register.")}</p>
              )}

              <section className="fr-review">
                <h4>{t("Quality check")}</h4>
                <small>
                  <span className={"cue " + cueOf(checkOf(opened))}>{statusLabel(checkOf(opened))}</span>
                  {opened.checked_by_name ? " " + t("by {v0}", { v0: opened.checked_by_name }) : ""}
                  {opened.checked_at ? " · " + when(opened.checked_at) : ""}
                </small>
                {!checks && (opened.check_note ? <p className="ac-note">{opened.check_note}</p> : <small>{t("No comment.")}</small>)}
                {checks && (
                  <>
                    <textarea
                      value={note}
                      maxLength={2000}
                      placeholder={t("What is wrong with this register, or anything to note (required for Has problems)")}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="detail-actions">
                      <button type="button" className="primary" disabled={busy} onClick={() => send({ action: "check", session_id: opened.id, status: "Valid", note })}>
                        {t("Mark Valid")}
                      </button>
                      <button
                        type="button"
                        className="small-btn ac-problem"
                        disabled={busy || note.trim().length < 3}
                        title={note.trim().length < 3 ? t("Say what the problem is with this register.") : undefined}
                        onClick={() => send({ action: "check", session_id: opened.id, status: "Has problems", note })}
                      >
                        {t("Mark Has problems")}
                      </button>
                      {data.lead && opened.check_status && (
                        <button
                          type="button"
                          className="small-btn"
                          disabled={busy}
                          onClick={() => window.confirm(t("Remove this check? The session goes back to Not checked.")) && send({ action: "clear", session_id: opened.id })}
                        >
                          {t("Remove the check")}
                        </button>
                      )}
                    </div>
                    <small className="fr-hint">{t("Has problems tells Coach Operations; they and Project Operations read your comment.")}</small>
                  </>
                )}
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
