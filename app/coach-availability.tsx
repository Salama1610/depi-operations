"use client";

// Every coach on the system with the hours they can take a session and the
// hours their sessions already take (see app/api/coach-availability). Coach
// Operations and the administrators filter by any combination of track, coach
// title, days and time, to find who is free when a group needs a coach; the
// heat map shows how many of the coaches in the selection are free at each hour
// of the week, and a click on it narrows to that hour. Opening a coach shows
// their week, where their free hours are set.

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Download, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  availabilityDays,
  availabilityHours,
  freeFor,
  hourLabel,
  hourRuns,
  hourState,
  slotKey,
  type HourState,
} from "@/lib/domain/coach-availability";

type Row = Record<string, any>;

const dayNames: Record<string, string> = {
  Sat: "Saturday",
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
};
const firstHour = availabilityHours[0];
const lastHour = availabilityHours[availabilityHours.length - 1] + 1;
// The programme's usual three-hour sessions, offered as one-click times.
const presets = [
  [17, 20],
  [18, 21],
  [19, 22],
] as const;

const blank = {
  q: "",
  track: "All",
  title: "All",
  status: "Active",
  declared: "All",
  days: [] as string[],
  from: firstHour,
  to: lastHour,
  match: "all" as "all" | "any",
  includeOpen: false,
};

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

/** A coach's declared hours and booked hours, ready for the filters. */
const prepare = (c: Row) => ({
  ...c,
  declaredSet: c.declared ? new Set<string>(c.declared) : null,
  bookedSet: new Set<string>((c.sessions || []).flatMap((s: Row) => s.keys || [])),
});

export function CoachAvailability() {
  const t = useT();
  const locale = useLocale();
  const hour = (h: number) => hourLabel(h, locale);
  const range = (from: number, to: number) => `${hour(from)} – ${hour(to)}`;
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState<string | null>(null);
  const set = (key: keyof typeof blank, value: any) => setF((x) => ({ ...x, [key]: value }));

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/coach-availability", { cache: "no-store" }).catch(() => {
        throw new Error(t("Check your connection and try again."));
      });
      const value = await response.json().catch(() => null);
      if (!response.ok || !value || value.error) throw new Error(value?.error || t("Unable to load the coaches."));
      setData(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to load the coaches."));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coaches = useMemo(() => (data?.coaches || []).map(prepare), [data]);
  const tracks = [...new Set(coaches.flatMap((c: Row) => c.tracks))].sort() as string[];
  const titles = [...new Set(coaches.map((c: Row) => c.title).filter(Boolean))].sort() as string[];
  // A time chosen without a day means that time on any day of the week.
  const timeChosen = f.from !== firstHour || f.to !== lastHour;
  const filterDays = f.days.length ? f.days : timeChosen ? [...availabilityDays] : [];
  const filterMatch = f.days.length ? f.match : "any";
  const needle = f.q.trim().toLowerCase();

  // Everything but the free-time filter: the coaches the heat map counts.
  const pool = coaches.filter(
    (c: Row) =>
      (f.status === "All" || (f.status === "Active") === c.active) &&
      (f.track === "All" || c.tracks.includes(f.track)) &&
      (f.title === "All" || c.title === f.title) &&
      (f.declared === "All" || (f.declared === "Declared") === !!c.declaredSet) &&
      (!needle ||
        [c.name, c.email, c.phone, ...c.groups.map((g: Row) => g.group_id)].some((v) => String(v || "").toLowerCase().includes(needle))),
  );
  const shown = pool.filter((c: Row) =>
    freeFor(c.declaredSet, c.bookedSet, filterDays, f.from, f.to, { match: filterMatch, includeOpen: f.includeOpen }),
  );
  const freeAt = (day: string, h: number) =>
    pool.filter((c: Row) => {
      const s = hourState(c.declaredSet, c.bookedSet, slotKey(day, h));
      return s === "free" || (f.includeOpen && s === "open");
    }).length;
  const most = Math.max(1, ...availabilityDays.flatMap((d) => availabilityHours.map((h) => freeAt(d, h))));
  const active = JSON.stringify({ ...f }) !== JSON.stringify(blank);
  const toggleDay = (d: string) => set("days", f.days.includes(d) ? f.days.filter((x) => x !== d) : availabilityDays.filter((x) => x === d || f.days.includes(x)));
  const declaredCount = pool.filter((c: Row) => c.declaredSet).length;

  /** A coach's free hours on a day, as "5 PM – 8 PM, 9 PM – 10 PM". */
  const freeText = (c: Row, day: string) =>
    hourRuns(availabilityHours.filter((h) => hourState(c.declaredSet, c.bookedSet, slotKey(day, h)) === "free"))
      .map(([a, b]) => range(a, b))
      .join(", ");

  if (!data && !error) return <div className="panel"><RefreshCw className="spin" size={18} /> {t("Loading the coaches…")}</div>;
  if (error && !data)
    return (
      <div className="error-panel" role="alert">
        <p>{t(error)}</p>
        <button className="primary" onClick={load}>{t("Try again")}</button>
      </div>
    );

  const current = coaches.find((c: Row) => c.id === open) || null;

  return (
    <div className="ca">
      <div className="fr-head">
        <div>
          <small>
            {t("Every coach on the system, with the hours they can take a session and the hours their sessions already take. Combine the filters to find who is free on a day and at a time; open a coach to set their free hours.")}
          </small>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="small-btn"
            disabled={!shown.length}
            onClick={() =>
              downloadCsv(
                "coach-availability",
                shown.map((c: Row) => ({
                  coach: c.name,
                  title: c.title || "",
                  email: c.email || "",
                  phone: c.phone || "",
                  tracks: c.tracks.join(" / "),
                  groups: c.groups.map((g: Row) => g.group_id).join(" / "),
                  declared: c.declaredSet ? "yes" : "no",
                  ...Object.fromEntries(
                    availabilityDays.map((d) => [
                      d,
                      [
                        freeText(c, d) && `free ${freeText(c, d)}`,
                        ...(c.sessions || []).filter((s: Row) => s.day === d).map((s: Row) => `${s.group_id} ${s.time}`),
                      ]
                        .filter(Boolean)
                        .join("; "),
                    ]),
                  ),
                  note: c.note || "",
                })),
              )
            }
          >
            <Download size={14} /> {t("Export CSV")}
          </button>
          <button type="button" className="small-btn" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> {t("Refresh")}
          </button>
        </div>
      </div>

      <div className="fr-filters">
        <input className="fr-search" type="search" placeholder={t("Search coach, email, phone or group")} value={f.q} onChange={(e) => set("q", e.target.value)} />
        <SearchableSelect label={t("Track")} value={f.track} onChange={(v) => set("track", v)} options={[{ value: "All", label: t("Every track") }, ...tracks.map((v) => ({ value: v, label: t(v) }))]} />
        <SearchableSelect label={t("Coach type")} value={f.title} onChange={(v) => set("title", v)} options={[{ value: "All", label: t("Every coach type") }, ...titles.map((v) => ({ value: v, label: t(v) }))]} />
        <SearchableSelect
          label={t("Status")}
          value={f.status}
          onChange={(v) => set("status", v)}
          options={[{ value: "Active", label: t("Active coaches") }, { value: "Inactive", label: t("Deactivated coaches") }, { value: "All", label: t("Active and deactivated") }]}
        />
        <SearchableSelect
          label={t("Free hours")}
          value={f.declared}
          onChange={(v) => set("declared", v)}
          options={[{ value: "All", label: t("Recorded or not") }, { value: "Declared", label: t("Free hours recorded") }, { value: "Missing", label: t("Free hours not recorded yet") }]}
        />
      </div>

      <div className="fr-filters ca-when">
        <div className="ca-when-group">
          <span className="ca-label">{t("Free on")}</span>
          <div className="ca-chips" role="group" aria-label={t("Free on")}>
            {availabilityDays.map((d) => (
              <button key={d} type="button" className={"ca-chip" + (f.days.includes(d) ? " is-on" : "")} aria-pressed={f.days.includes(d)} onClick={() => toggleDay(d)}>
                {t(dayNames[d])}
              </button>
            ))}
          </div>
          {f.days.length > 1 && (
            <div className="ca-chips" role="group" aria-label={t("Days to match")}>
              <button type="button" className={"ca-chip" + (f.match === "all" ? " is-on" : "")} aria-pressed={f.match === "all"} onClick={() => set("match", "all")}>
                {t("Free on every chosen day")}
              </button>
              <button type="button" className={"ca-chip" + (f.match === "any" ? " is-on" : "")} aria-pressed={f.match === "any"} onClick={() => set("match", "any")}>
                {t("Free on any chosen day")}
              </button>
            </div>
          )}
        </div>
        <div className="ca-when-group">
          <span className="ca-label">{t("Between")}</span>
          <div className="ca-chips">
            <select className="ca-select" aria-label={t("From")} value={f.from} onChange={(e) => { const from = Number(e.target.value); setF((x) => ({ ...x, from, to: Math.max(x.to, from + 1) })); }}>
              {availabilityHours.map((h) => <option key={h} value={h}>{hour(h)}</option>)}
            </select>
            <span aria-hidden="true">–</span>
            <select className="ca-select" aria-label={t("To")} value={f.to} onChange={(e) => { const to = Number(e.target.value); setF((x) => ({ ...x, to, from: Math.min(x.from, to - 1) })); }}>
              {availabilityHours.map((h) => h + 1).map((h) => <option key={h} value={h}>{hour(h)}</option>)}
            </select>
            {presets.map(([a, b]) => (
              <button key={a} type="button" className={"ca-chip" + (f.from === a && f.to === b ? " is-on" : "")} onClick={() => setF((x) => ({ ...x, from: a, to: b }))}>
                {range(a, b)}
              </button>
            ))}
            <button type="button" className={"ca-chip" + (!timeChosen ? " is-on" : "")} onClick={() => setF((x) => ({ ...x, from: firstHour, to: lastHour }))}>
              {t("Any time")}
            </button>
          </div>
        </div>
        <label className="ca-check">
          <input type="checkbox" checked={f.includeOpen} onChange={(e) => set("includeOpen", e.target.checked)} />
          {t("Count coaches without recorded free hours as free when nothing is booked")}
        </label>
        {active && (
          <button type="button" className="small-btn" onClick={() => setF(blank)}>
            <X size={14} /> {t("Clear filters")}
          </button>
        )}
      </div>

      <div className="fr-kpis fr-kpis-top">
        <div><span>{t("Coaches")}</span><strong><bdi dir="ltr">{pool.length}</bdi></strong></div>
        <div className={filterDays.length ? "is-ok" : ""}>
          <span>{filterDays.length ? t("Free at the chosen time") : t("Shown")}</span>
          <strong><bdi dir="ltr">{shown.length}</bdi></strong>
        </div>
        <div><span>{t("Free hours recorded")}</span><strong><bdi dir="ltr">{declaredCount}</bdi></strong></div>
        <div className={pool.length - declaredCount ? "is-warn" : ""}><span>{t("Free hours not recorded yet")}</span><strong><bdi dir="ltr">{pool.length - declaredCount}</bdi></strong></div>
      </div>

      <section className="fr-panel">
        <header>
          <h3>{t("Free coaches by hour")}</h3>
          <small>{t("How many of the coaches above are free at each hour. Click an hour to find them.")}</small>
        </header>
        <div className="ca-heat-wrap">
          <table className="ca-heat">
            <thead>
              <tr>
                <th />
                {availabilityHours.map((h) => <th key={h} scope="col">{hour(h)}</th>)}
              </tr>
            </thead>
            <tbody>
              {availabilityDays.map((d) => (
                <tr key={d}>
                  <th scope="row">{t(dayNames[d])}</th>
                  {availabilityHours.map((h) => {
                    const n = freeAt(d, h);
                    const on = f.days.length === 1 && f.days[0] === d && f.from === h && f.to === h + 1;
                    return (
                      <td key={h}>
                        <button
                          type="button"
                          className={"ca-heat-cell" + (on ? " is-on" : "")}
                          style={{ ["--ca-level" as any]: n / most }}
                          title={t("{v0} free coaches on {v1} at {v2}", { v0: n, v1: t(dayNames[d]), v2: hour(h) })}
                          onClick={() => setF((x) => ({ ...x, days: [d], from: h, to: h + 1, match: "all" }))}
                        >
                          <bdi dir="ltr">{n || ""}</bdi>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fr-panel">
        <header>
          <h3>{t("Coaches · {v0}", { v0: shown.length })}</h3>
          <div className="ca-legend">
            <span><i className="ca-dot is-free" /> {t("Free")}</span>
            <span><i className="ca-dot is-booked" /> {t("Session")}</span>
            <span><i className="ca-dot is-away" /> {t("Not available")}</span>
            <span><i className="ca-dot is-open" /> {t("Not recorded")}</span>
          </div>
        </header>
        {shown.length ? (
          <div className="fr-table-wrap">
            <table className="fr-table ca-table">
              <thead>
                <tr>
                  <th>{t("Coach")}</th>
                  <th>{t("Track")}</th>
                  <th>{t("Groups")}</th>
                  {availabilityDays.map((d) => <th key={d} className="ca-day-col">{t(dayNames[d])}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((c: Row) => (
                  <tr key={c.id} className={c.active ? "" : "is-muted"}>
                    <td>
                      <strong>{c.name}</strong>
                      <small className="table-subline">
                        {[c.title && t(c.title), !c.active && t("Deactivated")].filter(Boolean).join(" · ")}
                      </small>
                      <small className="table-subline"><bdi dir="ltr">{c.phone || c.email || ""}</bdi></small>
                    </td>
                    <td>{c.tracks.length ? c.tracks.map((v: string) => t(v)).join("، ") : "—"}</td>
                    <td><bdi dir="ltr">{c.groups.length}</bdi></td>
                    {availabilityDays.map((d) => (
                      <td key={d} className="ca-day-col">
                        <DayStrip coach={c} day={d} hour={hour} highlight={filterDays.includes(d) ? [f.from, f.to] : null} />
                      </td>
                    ))}
                    <td>
                      <button type="button" className="small-btn" onClick={() => setOpen(c.id)}>
                        <CalendarClock size={14} /> {t("Open week")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fr-empty">{coaches.length ? t("No coach matches these filters.") : t("There are no coaches on the system yet.")}</p>
        )}
      </section>

      {current && <CoachWeek key={current.id} coach={current} hour={hour} onClose={() => setOpen(null)} onSaved={load} />}
    </div>
  );
}

/** One day of a coach's week as a thin bar of hours. */
function DayStrip({ coach, day, hour, highlight }: { coach: Row; day: string; hour: (h: number) => string; highlight: [number, number] | null }) {
  const t = useT();
  const sessions = (coach.sessions || []).filter((s: Row) => s.day === day);
  const words: Record<HourState, string> = { free: t("Free"), booked: t("Session"), away: t("Not available"), open: t("Not recorded") };
  return (
    <div className="ca-strip-cell">
      <div className="ca-strip" aria-hidden="true">
        {availabilityHours.map((h) => {
          const state = hourState(coach.declaredSet, coach.bookedSet, slotKey(day, h));
          const lit = highlight && h >= highlight[0] && h < highlight[1];
          return <i key={h} className={`is-${state}${lit ? " is-lit" : ""}`} title={`${hour(h)} · ${words[state]}`} />;
        })}
      </div>
      {sessions.map((s: Row) => (
        <small key={s.group_id + s.time} className="ca-strip-session"><bdi dir="ltr">{s.time} {s.group_id}</bdi></small>
      ))}
    </div>
  );
}

/** A coach's whole week: click or drag over hours to mark them free, then save. */
function CoachWeek({ coach, hour, onClose, onSaved }: { coach: Row; hour: (h: number) => string; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const [slots, setSlots] = useState<Set<string>>(() => new Set(coach.declared || []));
  const [note, setNote] = useState(coach.note || "");
  const [busy, setBusy] = useState(false);
  // While the mouse is held down, every hour passed over takes the same value.
  const [paint, setPaint] = useState<boolean | null>(null);
  useEffect(() => {
    const stop = () => setPaint(null);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);
  const mark = (key: string, value: boolean) =>
    setSlots((x) => {
      const next = new Set(x);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  const setDay = (day: string, value: boolean) => availabilityHours.forEach((h) => mark(slotKey(day, h), value));
  const setHour = (h: number, value: boolean) => availabilityDays.forEach((d) => mark(slotKey(d, h), value));

  async function send(body: Row) {
    setBusy(true);
    try {
      const response = await fetch("/api/coach-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: coach.id, ...body }),
      }).catch(() => {
        throw new Error(t("Check your connection and try again."));
      });
      const value = await response.json().catch(() => null);
      if (!response.ok || !value?.ok) throw new Error(value?.error || t("Unable to save."));
      toast.success(body.action === "clear" ? t("Free hours cleared") : t("Free hours saved"));
      onSaved();
      onClose();
    } catch (reason) {
      toast.error(t(reason instanceof Error ? reason.message : "Unable to save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="ca-dialog">
        <DialogHeader>
          <DialogTitle>{coach.name}</DialogTitle>
          <DialogDescription>
            {t("Click or drag over the hours this coach can take a session. Hours their sessions take are shown with the group; they stay busy whatever is marked.")}
          </DialogDescription>
        </DialogHeader>
        <div className="ca-week-meta">
          {coach.title && <span className="cue is-info">{t(coach.title)}</span>}
          {coach.tracks.map((v: string) => <span key={v} className="cue is-info">{t(v)}</span>)}
          {coach.email && <bdi dir="ltr">{coach.email}</bdi>}
          {coach.phone && <bdi dir="ltr">{coach.phone}</bdi>}
        </div>
        <div className="ca-heat-wrap">
          <table className="ca-grid" onPointerLeave={() => setPaint(null)}>
            <thead>
              <tr>
                <th />
                {availabilityHours.map((h) => {
                  const all = availabilityDays.every((d) => slots.has(slotKey(d, h)));
                  return (
                    <th key={h} scope="col">
                      <button type="button" className="ca-grid-head" title={t("Mark this hour on every day")} onClick={() => setHour(h, !all)}>{hour(h)}</button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {availabilityDays.map((d) => {
                const all = availabilityHours.every((h) => slots.has(slotKey(d, h)));
                return (
                  <tr key={d}>
                    <th scope="row">
                      <button type="button" className="ca-grid-head" title={t("Mark the whole day")} onClick={() => setDay(d, !all)}>{t(dayNames[d])}</button>
                    </th>
                    {availabilityHours.map((h) => {
                      const key = slotKey(d, h);
                      const session = (coach.sessions || []).find((s: Row) => (s.keys || []).includes(key));
                      const on = slots.has(key);
                      return (
                        <td key={h}>
                          <button
                            type="button"
                            className={"ca-grid-cell" + (session ? " is-booked" : on ? " is-free" : "")}
                            aria-pressed={on}
                            aria-label={`${t(dayNames[d])} ${hour(h)}`}
                            title={session ? `${session.group_id} · ${session.time}` : `${t(dayNames[d])} ${hour(h)}`}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              setPaint(!on);
                              mark(key, !on);
                            }}
                            onPointerEnter={() => paint !== null && mark(key, paint)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                mark(key, !on);
                              }
                            }}
                          >
                            {session && session.keys[0] === key ? <bdi dir="ltr">{session.group_id}</bdi> : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(coach.sessions || []).length > 0 && (
          <div className="ca-sessions">
            <h4>{t("Sessions coming up")}</h4>
            <ul>
              {coach.sessions.map((s: Row) => (
                <li key={s.group_id + s.day + s.time}>
                  <bdi dir="ltr">{s.group_id}</bdi>
                  <span>{t(dayNames[s.day] || s.day)} · <bdi dir="ltr">{s.time}</bdi></span>
                  <small>
                    {t("{v0} to come, next {v1}", {
                      v0: s.upcoming,
                      v1: new Date(s.next).toLocaleDateString(tag, { timeZone: "Africa/Cairo", day: "numeric", month: "short" }),
                    })}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        )}
        <label className="field">
          {t("Note")}
          <textarea value={note} maxLength={500} rows={2} placeholder={t("For example: prefers evenings, away 1–7 November")} onChange={(e) => setNote(e.target.value)} />
        </label>
        <small className="footnote">
          {coach.updated_at
            ? t("Last changed by {v0} on {v1}", {
                v0: coach.updated_by_name || "—",
                v1: new Date(coach.updated_at).toLocaleString(tag, { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
              })
            : t("No free hours recorded for this coach yet.")}
        </small>
        <div className="detail-actions ca-actions">
          {coach.declared && (
            <button
              type="button"
              className="small-btn"
              disabled={busy}
              onClick={() => window.confirm(t("Clear this coach's free hours? They will show as not recorded.")) && send({ action: "clear" })}
            >
              {t("Clear free hours")}
            </button>
          )}
          <button type="button" className="small-btn" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
          <button type="button" className="primary" disabled={busy} onClick={() => send({ action: "save", slots: [...slots], note })}>
            {busy ? t("Saving…") : t("Save free hours")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
