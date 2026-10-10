"use client";

// The administrator's dashboard: every tracker in the programme and what
// everyone did, on report pages that share one row of filters, in the manner
// of a BI report. The data arrives once from /api/dashboard; every filter and
// figure is worked out here, so changing a filter is instant. Clicking a bar or
// a person narrows the whole report to it.

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, RefreshCw, X } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { scoreOf } from "@/lib/domain/feedback";

type Row = Record<string, any>;

// Categorical slots in fixed order (validated palette), and the reserved status colours.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"];
const STATUS = { good: "#2f7a6d", warn: "#c98500", bad: "#c0453a", neutral: "#8592a6" };
const GRID = "#e6eaf1";
const INK = "#52627b";

const DAY = 86400000;
const cairoDay = (v: any) => (v ? new Date(v).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }) : "");

/** The programme week runs Friday to Thursday, Cairo time. */
function programmeWeekStart(now = new Date()) {
  const day = new Date(cairoDay(now) + "T00:00:00Z");
  const back = (day.getUTCDay() - 5 + 7) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

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

/** The history's action codes, as a person reads them. */
const actionNames: Record<string, string> = {
  staff: "Staff record saved", transfer: "Student transferred", saved_view: "View saved", session_check: "Checklist step ticked",
  session_confirm: "Session confirmed", complete_task: "Action completed", contact: "Contact logged", session_attendance: "Attendance taken",
  service_qc_review: "Service link decided", service_qc_assign: "Reviews assigned", bulk_group_owner: "Group handed over",
  lifecycle: "Lifecycle changed", group_close: "Group closed", policy_check: "Policy check run", case: "Case opened",
  case_transition: "Case updated", task: "Action created", engagement: "Risk reviewed", milestone: "Milestone updated",
  account_topup: "Account topped up", account_coordinator: "Account assigned", session: "Session scheduled",
  session_reschedule: "Group rescheduled", session_coach: "Coach changed", session_unavailable: "Marked unavailable",
  session_cancel: "Session cancelled", group_contact: "Group message logged", gig: "Paid service recorded",
  gig_transition: "Service step recorded", evidence: "Proof submitted", review: "Proof reviewed", student: "Student added",
  account_request: "Account requested", account: "Account added", account_status: "Account state changed",
};
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);
const rate = (a: number, b: number) => { const p = pct(a, b); return p === null ? "—" : p + "%"; };

const formatNumber = (ar: boolean, v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { maximumFractionDigits: digits });

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className={"dash-kpi" + (tone ? " is-" + tone : "")}>
      <span>{label}</span>
      <strong>
        <bdi dir="ltr">{value}</bdi>
      </strong>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function Card({ title, children, wide, action }: { title: string; children: React.ReactNode; wide?: boolean; action?: React.ReactNode }) {
  return (
    <section className={"dash-card" + (wide ? " is-wide" : "")}>
      <header>
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

/** A ranking: one horizontal bar per name; clicking one filters the report to it. */
function Ranking({ rows, valueLabel, onPick, tone = SERIES[0], height, max }: { rows: { id: string; name: string; value: number }[]; valueLabel: string; onPick?: (id: string) => void; tone?: string; height?: number; max?: number }) {
  const t = useT();
  const ar = useLocale() === "ar";
  if (!rows.length) return <p className="dash-empty">{t("Nothing in this period.")}</p>;
  return (
    <div style={{ width: "100%", height: height || Math.max(160, rows.length * 30 + 30) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 16 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" allowDecimals={false} domain={max ? [0, max] : undefined} tick={{ fill: INK, fontSize: 12 }} reversed={ar} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fill: INK, fontSize: 12 }} orientation={ar ? "right" : "left"} />
          <Tooltip formatter={(v: any) => [formatNumber(ar, Number(v), 1), valueLabel]} cursor={{ fill: "#eef2fb" }} />
          <Bar isAnimationActive={false} dataKey="value" fill={tone} radius={4} barSize={16} onClick={(d: any) => onPick && d?.id && onPick(d.id)} style={{ cursor: onPick ? "pointer" : "default" }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Dashboard() {
  const t = useT();
  const locale = useLocale();
  const ar = locale === "ar";
  const num = (v: number | null | undefined, digits = 0) => formatNumber(ar, v, digits);
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState<Row>({
    range: "30", from: "", to: "", team: "All", supervisor: "All", coordinator: "All", coach: "All", group: "All", track: "All", provider: "All", person: "All",
  });
  const [peopleRole, setPeopleRole] = useState("All");
  const [sortBy, setSortBy] = useState("actions");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || t("Request failed"));
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

  const staff: Row[] = useMemo(() => data?.staff || [], [data]);
  const staffById = useMemo(() => new Map(staff.map((p) => [p.id, p])), [staff]);
  const who = (id: any) => staffById.get(id)?.name || (id ? t("Unassigned") : "—");
  const roleOf = (p: Row) => (p.roles || [])[0] || "";

  // ---- filters ------------------------------------------------------------
  const window = useMemo(() => {
    const now = Date.now();
    if (f.range === "today") return { from: cairoDay(now), to: cairoDay(now) };
    if (f.range === "week") return { from: programmeWeekStart(), to: cairoDay(now) };
    if (f.range === "7") return { from: cairoDay(now - 6 * DAY), to: cairoDay(now) };
    if (f.range === "30") return { from: cairoDay(now - 29 * DAY), to: cairoDay(now) };
    if (f.range === "custom") return { from: f.from || "0000-01-01", to: f.to || "9999-12-31" };
    return { from: "0000-01-01", to: "9999-12-31" };
  }, [f.range, f.from, f.to]);
  const inRange = (v: any) => {
    const d = cairoDay(v);
    return !!d && d >= window.from && d <= window.to;
  };

  const groups: Row[] = useMemo(() => {
    const team = (g: Row) => staffById.get(g.supervisor)?.team || "";
    return (data?.groups || []).filter(
      (g: Row) =>
        (f.team === "All" || team(g) === f.team) &&
        (f.supervisor === "All" || g.supervisor === f.supervisor) &&
        (f.coordinator === "All" || g.coordinator === f.coordinator) &&
        (f.coach === "All" || g.coach === f.coach) &&
        (f.group === "All" || g.id === f.group) &&
        (f.track === "All" || g.track === f.track) &&
        (f.provider === "All" || g.provider === f.provider),
    );
  }, [data, f, staffById]);
  const groupSet = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const groupById = useMemo(() => new Map<string, Row>((data?.groups || []).map((g: Row) => [g.id, g])), [data]);
  const students: Row[] = useMemo(() => (data?.students || []).filter((s: Row) => groupSet.has(s.group_id)), [data, groupSet]);
  const studentSet = useMemo(() => new Set(students.map((s) => s.id)), [students]);
  const allSessions: Row[] = useMemo(() => (data?.sessions || []).filter((s: Row) => groupSet.has(s.group_id)), [data, groupSet]);
  const sessionSet = useMemo(() => new Set(allSessions.map((s) => s.id)), [allSessions]);
  const sessionById = useMemo(() => new Map<string, Row>((data?.sessions || []).map((s: Row) => [s.id, s])), [data]);
  const byStudent = (rows: Row[] = []) => rows.filter((r) => studentSet.has(r.student_id));
  const bySession = (rows: Row[] = []) => rows.filter((r) => sessionSet.has(r.session_id));
  const person = f.person === "All" ? null : f.person;

  const sessions = allSessions.filter((s) => inRange(s.starts_at));
  const now = Date.now();
  const held = sessions.filter((s) => s.status !== "Cancelled" && Date.parse(s.starts_at) + 3 * 3600000 <= now);
  const attendance = bySession(data?.attendance).filter((a) => inRange(sessionById.get(a.session_id)?.starts_at));
  const contacts = byStudent(data?.contacts).filter((c) => inRange(c.occurred_at));
  const tasks = byStudent(data?.tasks);
  const cases: Row[] = (data?.cases || []).filter((c: Row) => !c.group_id || groupSet.has(c.group_id));
  const links = byStudent(data?.links);
  const reviews = byStudent(data?.reviews).filter((r) => inRange(r.reviewed_at));
  const gigs = byStudent(data?.gigs);
  const evidence = byStudent(data?.evidence);
  const feedback = bySession(data?.feedback).filter((x) => inRange(x.created_at));
  const flags = bySession(data?.flags);
  const checks = bySession(data?.checks).filter((c) => inRange(c.done_at));
  const ledger: Row[] = (data?.ledger || []).filter((e: Row) => inRange(e.created_at));
  const requests = byStudent(data?.requests);
  const audit: Row[] = (data?.audit || []).filter((e: Row) => inRange(e.created_at) && (!person || e.actor === person));

  // ---- figures ------------------------------------------------------------
  const active = students.filter((s) => s.lifecycle === "Active");
  const contactedIds = new Set(contacts.map((c) => c.student_id));
  const present = attendance.filter((a) => a.status === "Present").length;
  const upcoming = allSessions.filter((s) => s.status !== "Cancelled" && Date.parse(s.starts_at) > now && Date.parse(s.starts_at) < now + 2 * DAY);
  const bothConfirmed = (s: Row) => !!s.coordinator_confirmed_at && !!s.coach_confirmed_at;
  const marksBySession = new Map<string, number>();
  for (const a of attendance) marksBySession.set(a.session_id, (marksBySession.get(a.session_id) || 0) + 1);
  const rosterOf = (groupId: string) => active.filter((s) => s.group_id === groupId).length;
  const unmarkedRegisters = held.filter((s) => (marksBySession.get(s.id) || 0) < rosterOf(s.group_id));
  const openTasks = tasks.filter((x) => x.status === "Open");
  const overdueTasks = openTasks.filter((x) => Date.parse(x.due) < now);
  const openCases = cases.filter((c) => !["Closed", "Resolved"].includes(c.status));
  const linkCounts = { pending: 0, approved: 0, rejected: 0, failed: 0, late: 0 };
  for (const l of links) {
    if (l.qc_status === "Locked") linkCounts.approved++;
    else if (l.qc_status === "Needs Correction") linkCounts.rejected++;
    else linkCounts.pending++;
    if (l.auto_status === "Failed") linkCounts.failed++;
    if (l.qc_status === "Pending" && now - Date.parse(l.updated_at) > 48 * 3600000) linkCounts.late++;
  }
  const approvedPerStudent = new Map<string, number>();
  for (const l of links) if (l.qc_status === "Locked") approvedPerStudent.set(l.student_id, (approvedPerStudent.get(l.student_id) || 0) + 1);
  const completeStudents = [...approvedPerStudent.values()].filter((n) => n >= 3).length;
  const submittedStudents = new Set(links.map((l) => l.student_id)).size;
  // The same rule as the feedback screens: a session's score is the average of
  // all its ratings; below 3 it is a red flag, open until someone handles it.
  const avgFeedback = scoreOf(feedback as any);
  const sessionRows = new Map<string, Row[]>();
  for (const x of feedback) sessionRows.set(x.session_id, [...(sessionRows.get(x.session_id) || []), x]);
  const sessionScores = new Map([...sessionRows.entries()].map(([id, rows]) => [id, scoreOf(rows as any)]));
  const ratedHeld = held.filter((s) => sessionScores.has(s.id)).length;
  const flagged = [...sessionScores.entries()].filter(([, score]) => score !== null && score < 3).map(([id]) => id);
  const handled = new Set(flags.map((x: Row) => x.session_id));
  const openFlags = flagged.filter((id) => !handled.has(id));
  const accounts: Row[] = data?.accounts || [];
  const topups = ledger.filter((e) => Number(e.delta) > 0 && !/^Opening/.test(e.reason || "")).reduce((n, e) => n + Number(e.delta), 0);
  const charged = ledger.filter((e) => Number(e.delta) < 0).reduce((n, e) => n + Math.abs(Number(e.delta)), 0);

  // Activity per day: contacts, attendance marks and quality decisions.
  const days: string[] = useMemo(() => {
    const out: string[] = [];
    const end = window.to === "9999-12-31" ? cairoDay(now) : window.to;
    let start = window.from === "0000-01-01" ? cairoDay(now - 29 * DAY) : window.from;
    if (Date.parse(end) - Date.parse(start) > 92 * DAY) start = cairoDay(Date.parse(end) - 92 * DAY);
    for (let d = Date.parse(start + "T12:00:00Z"); d <= Date.parse(end + "T12:00:00Z"); d += DAY) out.push(new Date(d).toISOString().slice(0, 10));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window.from, window.to]);
  const perDay = (rows: Row[], key: string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(cairoDay(r[key]), (m.get(cairoDay(r[key])) || 0) + 1);
    return m;
  };
  const cDay = perDay(contacts, "occurred_at");
  const aDay = perDay(attendance, "updated_at");
  const rDay = perDay(reviews, "reviewed_at");
  const activitySeries = days.map((d) => ({ day: d.slice(5), [t("Contacts")]: cDay.get(d) || 0, [t("Attendance marks")]: aDay.get(d) || 0, [t("Quality decisions")]: rDay.get(d) || 0 }));

  // People: what everyone did in the period.
  const people = useMemo(() => {
    const count = (rows: Row[], key: string) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r[key]) m.set(r[key], (m.get(r[key]) || 0) + 1);
      return m;
    };
    const actions = count(audit, "actor");
    const contactsBy = count(contacts, "recorder");
    const marksBy = count(attendance, "recorder");
    const checksBy = count(checks, "done_by");
    const reviewsBy = count(reviews, "reviewed_by");
    const completedBy = count(audit.filter((e) => e.action === "complete_task"), "actor");
    const confirmations = new Map<string, number>();
    for (const s of sessions) {
      if (s.coordinator_confirmed_at && inRange(s.coordinator_confirmed_at)) {
        const id = s.coordinator_id || groupById.get(s.group_id)?.coordinator;
        if (id) confirmations.set(id, (confirmations.get(id) || 0) + 1);
      }
      if (s.coach_confirmed_at && inRange(s.coach_confirmed_at) && s.coach_id) confirmations.set(s.coach_id, (confirmations.get(s.coach_id) || 0) + 1);
    }
    const last = new Map<string, string>();
    for (const e of data?.audit || []) if (e.actor && !last.has(e.actor)) last.set(e.actor, e.created_at);
    return staff
      .filter((p) => p.active !== false && p.active !== 0)
      .filter((p) => peopleRole === "All" || (p.roles || []).includes(peopleRole))
      .filter((p) => !person || p.id === person)
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: roleOf(p),
        team: p.team || "",
        actions: actions.get(p.id) || 0,
        contacts: contactsBy.get(p.id) || 0,
        attendance: marksBy.get(p.id) || 0,
        confirmations: confirmations.get(p.id) || 0,
        checks: checksBy.get(p.id) || 0,
        reviews: reviewsBy.get(p.id) || 0,
        tasks: completedBy.get(p.id) || 0,
        last: last.get(p.id) || "",
      }))
      .sort((a: Row, b: Row) => (sortBy === "name" ? String(a.name).localeCompare(String(b.name)) : Number(b[sortBy]) - Number(a[sortBy])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff, audit, contacts, attendance, checks, reviews, sessions, peopleRole, person, sortBy, data]);

  // ---- options for the filters -------------------------------------------
  const holders = (role: string) => staff.filter((p) => (p.roles || []).includes(role)).sort((a, b) => a.name.localeCompare(b.name));
  const uniq = (xs: any[]) => [...new Set(xs.filter(Boolean))].sort();
  const allGroups: Row[] = data?.groups || [];
  const opt = (label: string, rows: { value: string; label: string }[]) => [{ value: "All", label }, ...rows];
  const set = (key: string, value: string) => setF({ ...f, [key]: value });
  const activeFilters = Object.entries(f).filter(([k, v]) => !["range", "from", "to"].includes(k) && v !== "All");

  if (error) return <div className="dash-error" role="alert">{error}</div>;
  if (!data) return <div className="dash-loading">{t("Loading the dashboard…")}</div>;

  const exportButton = (name: string, rows: Row[]) => (
    <button type="button" className="small-btn" disabled={!rows.length} onClick={() => downloadCsv(name, rows)}>
      <Download size={14} /> {t("Export CSV")}
    </button>
  );
  const top = <T extends Row>(xs: T[], key: string, n = 12) => [...xs].sort((a, b) => Number(b[key]) - Number(a[key])).slice(0, n);

  // Attendance rate per group, lowest first.
  const groupAttendance = groups
    .map((g) => {
      const marks = attendance.filter((a) => sessionById.get(a.session_id)?.group_id === g.id);
      return { id: g.id, name: g.id, value: pct(marks.filter((a) => a.status === "Present").length, marks.length) ?? -1 };
    })
    .filter((x) => x.value >= 0)
    .sort((a, b) => a.value - b.value)
    .slice(0, 15);
  const contactsByCoordinator = holders("Operations Coordinator")
    .map((p) => {
      const mine = active.filter((s) => groupById.get(s.group_id)?.coordinator === p.id);
      return { id: p.id, name: p.name, value: pct(mine.filter((s) => contactedIds.has(s.id)).length, mine.length) ?? -1, students: mine.length };
    })
    .filter((x) => x.students > 0)
    .sort((a, b) => a.value - b.value)
    .slice(0, 15);
  const linksByPlatform = ["Kafiil", "Nafezly", "Khamsat"].map((p) => {
    const mine = links.filter((l) => l.platform === p);
    return {
      name: t(p),
      [t("Approved")]: mine.filter((l) => l.qc_status === "Locked").length,
      [t("Waiting for review")]: mine.filter((l) => l.qc_status === "Pending").length,
      [t("Rejected")]: mine.filter((l) => l.qc_status === "Needs Correction").length,
    };
  });
  const reviewsByReviewer = Object.entries(reviews.reduce((m: Row, r) => ({ ...m, [r.reviewed_by]: (m[r.reviewed_by] || 0) + 1 }), {}))
    .map(([id, value]) => ({ id, name: who(id), value: Number(value) }));
  const feedbackByCoach = Object.entries(
    feedback.reduce((m: Row, x) => {
      const coach = sessionById.get(x.session_id)?.coach_id;
      if (coach) (m[coach] = m[coach] || []).push(x);
      return m;
    }, {}),
  ).map(([id, rows]) => ({ id, name: who(id), value: scoreOf(rows as any) || 0 }));
  const feedbackByWeek = Object.entries(
    feedback.reduce((m: Row, x) => {
      const w = sessionById.get(x.session_id)?.week;
      if (w) (m[w] = m[w] || []).push(x);
      return m;
    }, {}),
  )
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([w, rows]) => ({ week: t("Week {v0}", { v0: w }), [t("Average rating")]: scoreOf(rows as any) }));
  const overdueByOwner = Object.entries(overdueTasks.reduce((m: Row, x) => ({ ...m, [x.owner]: (m[x.owner] || 0) + 1 }), {}))
    .map(([id, value]) => ({ id, name: who(id), value: Number(value) }));
  const accountsByCoordinator = Object.entries(accounts.reduce((m: Row, a) => ({ ...m, [a.coordinator_id || "-"]: (m[a.coordinator_id || "-"] || 0) + 1 }), {}))
    .map(([id, value]) => ({ id, name: id === "-" ? t("Not assigned yet") : who(id), value: Number(value) }));
  const creditByPlatform = ["Kafeel", "Nafezly", "Khamsat"].map((p) => ({
    name: t(p),
    [t("Available credit")]: Math.round(accounts.filter((a) => a.platform === p).reduce((n, a) => n + Number(a.credits || 0), 0)),
    [t("Pending credit")]: Math.round(accounts.filter((a) => a.platform === p).reduce((n, a) => n + Number(a.pending_credits || 0), 0)),
  }));
  const sessionsPerDay = days.map((d) => ({
    day: d.slice(5),
    [t("Held")]: held.filter((s) => cairoDay(s.starts_at) === d).length,
    [t("Upcoming")]: sessions.filter((s) => s.status !== "Cancelled" && Date.parse(s.starts_at) > now && cairoDay(s.starts_at) === d).length,
    [t("Cancelled")]: sessions.filter((s) => s.status === "Cancelled" && cairoDay(s.starts_at) === d).length,
  }));
  const pickPerson = (id: string) => set("person", f.person === id ? "All" : id);
  const pickGroup = (id: string) => set("group", f.group === id ? "All" : id);
  const pickCoordinator = (id: string) => set("coordinator", f.coordinator === id ? "All" : id);

  const timeAxis = (
    <>
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis dataKey="day" tick={{ fill: INK, fontSize: 11 }} reversed={ar} minTickGap={16} />
      <YAxis allowDecimals={false} tick={{ fill: INK, fontSize: 12 }} orientation={ar ? "right" : "left"} width={36} />
      <Tooltip />
      <Legend itemSorter={null} wrapperStyle={{ fontSize: 13 }} />
    </>
  );

  return (
    <div className="dash">
      <div className="dash-slicers">
        <SearchableSelect
          className="dash-slicer"
          label={t("Period")}
          value={f.range}
          onChange={(range) => set("range", range)}
          options={[
            { value: "today", label: t("Today") },
            { value: "week", label: t("This programme week") },
            { value: "7", label: t("Last 7 days") },
            { value: "30", label: t("Last 30 days") },
            { value: "all", label: t("Round to date") },
            { value: "custom", label: t("Custom dates") },
          ]}
        />
        {f.range === "custom" && (
          <>
            <input type="date" aria-label={t("From")} value={f.from} onChange={(e) => set("from", e.target.value)} />
            <input type="date" aria-label={t("To")} value={f.to} onChange={(e) => set("to", e.target.value)} />
          </>
        )}
        <SearchableSelect className="dash-slicer" label={t("Team")} value={f.team} onChange={(v) => set("team", v)} options={opt(t("Every team"), [{ value: "Service Team", label: t("Service Team") }, { value: "Target Team", label: t("Target Team") }])} />
        <SearchableSelect className="dash-slicer" label={t("Supervisor")} value={f.supervisor} onChange={(v) => set("supervisor", v)} options={opt(t("All supervisors"), holders("Team Supervisor").map((p) => ({ value: p.id, label: p.name })))} />
        <SearchableSelect className="dash-slicer" label={t("Coordinator")} value={f.coordinator} onChange={(v) => set("coordinator", v)} options={opt(t("Every coordinator"), holders("Operations Coordinator").map((p) => ({ value: p.id, label: p.name })))} />
        <SearchableSelect className="dash-slicer" label={t("Coach")} value={f.coach} onChange={(v) => set("coach", v)} options={opt(t("All coaches"), holders("Coach").map((p) => ({ value: p.id, label: p.name })))} />
        <SearchableSelect className="dash-slicer" label={t("Group")} value={f.group} onChange={(v) => set("group", v)} options={opt(t("All groups"), allGroups.map((g) => ({ value: g.id, label: g.id })).sort((a, b) => a.label.localeCompare(b.label)))} />
        <SearchableSelect className="dash-slicer" label={t("Track")} value={f.track} onChange={(v) => set("track", v)} options={opt(t("Every track"), uniq(allGroups.map((g) => g.track)).map((v) => ({ value: v, label: t(v) })))} />
        <SearchableSelect className="dash-slicer" label={t("Provider")} value={f.provider} onChange={(v) => set("provider", v)} options={opt(t("All providers"), uniq(allGroups.map((g) => g.provider)).map((v) => ({ value: v, label: v })))} />
        <SearchableSelect className="dash-slicer" label={t("Person")} value={f.person} onChange={(v) => set("person", v)} options={opt(t("Everyone"), staff.filter((p) => p.active !== false && p.active !== 0).sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: `${p.name} · ${t(roleOf(p))}` })))} />
        <button type="button" className="small-btn" onClick={load} disabled={loading} aria-label={t("Refresh")}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> {t("Refresh")}
        </button>
      </div>
      {activeFilters.length > 0 && (
        <div className="dash-chips">
          {activeFilters.map(([k, v]) => (
            <button key={k} type="button" className="dash-chip" onClick={() => set(k, "All")}>
              {t(k === "person" || k === "coordinator" || k === "supervisor" || k === "coach" ? (staffById.get(v)?.name || v) : v)} <X size={12} />
            </button>
          ))}
          <button type="button" className="text-link" onClick={() => setF({ ...f, team: "All", supervisor: "All", coordinator: "All", coach: "All", group: "All", track: "All", provider: "All", person: "All" })}>
            {t("Clear filters")}
          </button>
        </div>
      )}
      <p className="dash-scope">
        {t("{v0} groups · {v1} active students · {v2} to {v3} · updated {v4}", {
          v0: num(groups.length),
          v1: num(active.length),
          v2: window.from === "0000-01-01" ? t("the start") : window.from,
          v3: window.to === "9999-12-31" ? t("today") : window.to,
          v4: new Date(data.generated_at).toLocaleTimeString(ar ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", hour12: true, minute: "2-digit" }),
        })}
      </p>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("Overview")}</TabsTrigger>
          <TabsTrigger value="people">{t("People & activity")}</TabsTrigger>
          <TabsTrigger value="sessions">{t("Sessions & attendance")}</TabsTrigger>
          <TabsTrigger value="followups">{t("Contacts & follow-ups")}</TabsTrigger>
          <TabsTrigger value="services">{t("Services & quality")}</TabsTrigger>
          <TabsTrigger value="accounts">{t("Client accounts")}</TabsTrigger>
          <TabsTrigger value="feedback">{t("Feedback")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="dash-kpis">
            <Kpi label={t("Active students")} value={num(active.length)} sub={t("{v0} groups", { v0: num(groups.length) })} />
            <Kpi label={t("Contacted in the period")} value={rate(contactedIds.size, active.length)} sub={t("{v0} of {v1}", { v0: num(contactedIds.size), v1: num(active.length) })} tone={(pct(contactedIds.size, active.length) ?? 0) >= 80 ? "good" : (pct(contactedIds.size, active.length) ?? 0) >= 50 ? "warn" : "bad"} />
            <Kpi label={t("Sessions held")} value={num(held.length)} sub={t("{v0} scheduled in the period", { v0: num(sessions.length) })} />
            <Kpi label={t("Attendance rate")} value={rate(present, attendance.length)} sub={t("{v0} marks", { v0: num(attendance.length) })} tone={(pct(present, attendance.length) ?? 100) >= 80 ? "good" : (pct(present, attendance.length) ?? 0) >= 60 ? "warn" : "bad"} />
            <Kpi label={t("Next 48 hours confirmed")} value={rate(upcoming.filter(bothConfirmed).length, upcoming.length)} sub={t("{v0} of {v1} sessions", { v0: num(upcoming.filter(bothConfirmed).length), v1: num(upcoming.length) })} tone={(pct(upcoming.filter(bothConfirmed).length, upcoming.length) ?? 100) >= 90 ? "good" : "warn"} />
            <Kpi label={t("Overdue actions")} value={num(overdueTasks.length)} sub={t("{v0} open", { v0: num(openTasks.length) })} tone={overdueTasks.length ? "bad" : "good"} />
            <Kpi label={t("Open cases")} value={num(openCases.length)} />
            <Kpi label={t("Service links approved")} value={num(linkCounts.approved)} sub={t("{v0} waiting · {v1} rejected", { v0: num(linkCounts.pending), v1: num(linkCounts.rejected) })} />
            <Kpi label={t("Students with 3 approved links")} value={num(completeStudents)} sub={t("{v0} have submitted", { v0: num(submittedStudents) })} />
            <Kpi label={t("Paid services")} value={num(gigs.length)} sub={t("{v0} proofs in review", { v0: num(evidence.filter((e) => !["Accepted", "Rejected", "Closed L3"].includes(e.status)).length) })} />
            <Kpi label={t("Average session rating")} value={avgFeedback === null ? "—" : num(avgFeedback, 1) + " / 5"} sub={t("{v0} responses", { v0: num(feedback.length) })} tone={avgFeedback === null ? undefined : avgFeedback >= 4 ? "good" : avgFeedback >= 3 ? "warn" : "bad"} />
            <Kpi label={t("Open red flags")} value={num(openFlags.length)} tone={openFlags.length ? "bad" : "good"} />
          </div>
          <div className="dash-grid">
            <Card title={t("Activity per day")} wide>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={activitySeries} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    {timeAxis}
                    <Line isAnimationActive={false} type="linear" dataKey={t("Contacts")} stroke={SERIES[0]} strokeWidth={2} dot={false} />
                    <Line isAnimationActive={false} type="linear" dataKey={t("Attendance marks")} stroke={SERIES[1]} strokeWidth={2} dot={false} />
                    <Line isAnimationActive={false} type="linear" dataKey={t("Quality decisions")} stroke={SERIES[2]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={t("Contact rate by coordinator, lowest first")}>
              <Ranking rows={contactsByCoordinator} valueLabel="%" max={100} onPick={pickCoordinator} tone={SERIES[0]} />
            </Card>
            <Card title={t("Attendance rate by group, lowest first")}>
              <Ranking rows={groupAttendance} valueLabel="%" max={100} onPick={pickGroup} tone={SERIES[1]} />
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="people">
          <div className="dash-toolbar">
            <SearchableSelect
              className="dash-slicer"
              label={t("Role")}
              value={peopleRole}
              onChange={setPeopleRole}
              options={opt(t("Every role"), ["Operations Coordinator", "Team Supervisor", "Coach", "Coach Operations", "Quality Member", "Quality Lead", "Project Operations", "Higher Board", "Operations Systems / Admin"].map((r) => ({ value: r, label: t(r) })))}
            />
            <SearchableSelect
              className="dash-slicer"
              label={t("Sort by")}
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: "actions", label: t("Actions") },
                { value: "contacts", label: t("Contacts") },
                { value: "attendance", label: t("Attendance marks") },
                { value: "confirmations", label: t("Session confirmations") },
                { value: "reviews", label: t("Quality decisions") },
                { value: "name", label: t("Name") },
              ]}
            />
          </div>
          <div className="dash-grid">
            <Card title={t("Most active in the period")}>
              <Ranking rows={top(people, sortBy === "name" ? "actions" : sortBy, 10).map((p: Row) => ({ id: p.id, name: p.name, value: p[sortBy === "name" ? "actions" : sortBy] }))} valueLabel={t(sortBy === "name" ? "Actions" : ({ actions: "Actions", contacts: "Contacts", attendance: "Attendance marks", confirmations: "Session confirmations", reviews: "Quality decisions" } as Row)[sortBy])} onPick={pickPerson} />
            </Card>
            <Card title={t("Overdue actions by owner")}>
              <Ranking rows={top(overdueByOwner, "value", 10)} valueLabel={t("Overdue actions")} onPick={pickPerson} tone={STATUS.bad} />
            </Card>
            <Card title={t("What everyone did · {v0} people", { v0: num(people.length) })} wide action={exportButton("people", people.map((p: Row) => ({ ...p, role: t(p.role), team: t(p.team) })))}>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>{t("Name")}</th><th>{t("Role")}</th><th>{t("Actions")}</th><th>{t("Contacts")}</th><th>{t("Attendance marks")}</th>
                      <th>{t("Session confirmations")}</th><th>{t("Checklist steps")}</th><th>{t("Quality decisions")}</th><th>{t("Actions completed")}</th><th>{t("Last active")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.slice(0, 300).map((p: Row) => (
                      <tr key={p.id} className={f.person === p.id ? "is-picked" : ""} onClick={() => pickPerson(p.id)}>
                        <td><strong>{p.name}</strong>{p.team ? <small>{t(p.team)}</small> : null}</td>
                        <td>{t(p.role)}</td>
                        <td className={p.actions ? "" : "is-zero"}>{num(p.actions)}</td>
                        <td className={p.contacts ? "" : "is-zero"}>{num(p.contacts)}</td>
                        <td className={p.attendance ? "" : "is-zero"}>{num(p.attendance)}</td>
                        <td className={p.confirmations ? "" : "is-zero"}>{num(p.confirmations)}</td>
                        <td className={p.checks ? "" : "is-zero"}>{num(p.checks)}</td>
                        <td className={p.reviews ? "" : "is-zero"}>{num(p.reviews)}</td>
                        <td className={p.tasks ? "" : "is-zero"}>{num(p.tasks)}</td>
                        <td>{p.last ? new Date(p.last).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", hour: "numeric", hour12: true, minute: "2-digit" }) : t("Never")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title={t("Activity log · {v0}", { v0: num(audit.length) })} wide action={exportButton("activity", audit.map((e) => ({ when: e.created_at, who: who(e.actor), action: t(actionNames[e.action] || e.action), record: e.entity_id })))}>
              <div className="dash-table-wrap is-short">
                <table className="dash-table">
                  <thead><tr><th>{t("When")}</th><th>{t("Who")}</th><th>{t("Action")}</th><th>{t("Record")}</th></tr></thead>
                  <tbody>
                    {audit.slice(0, 200).map((e, i) => (
                      <tr key={i}>
                        <td>{new Date(e.created_at).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", hour: "numeric", hour12: true, minute: "2-digit" })}</td>
                        <td>{who(e.actor)}</td>
                        <td>{t(actionNames[e.action] || e.action)}</td>
                        <td><bdi>{e.entity_id}</bdi></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!audit.length && <p className="dash-empty">{t("Nothing in this period.")}</p>}
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sessions">
          <div className="dash-kpis">
            <Kpi label={t("Sessions in the period")} value={num(sessions.length)} sub={t("{v0} cancelled", { v0: num(sessions.filter((s) => s.status === "Cancelled").length) })} />
            <Kpi label={t("Sessions held")} value={num(held.length)} />
            <Kpi label={t("Registers not complete")} value={num(unmarkedRegisters.length)} tone={unmarkedRegisters.length ? "bad" : "good"} />
            <Kpi label={t("Attendance rate")} value={rate(present, attendance.length)} />
            <Kpi label={t("Coordinator confirmed")} value={rate(sessions.filter((s) => s.coordinator_confirmed_at).length, sessions.length)} />
            <Kpi label={t("Coach confirmed")} value={rate(sessions.filter((s) => s.coach_confirmed_at).length, sessions.length)} />
            <Kpi label={t("Unavailable replies")} value={num(sessions.filter((s) => Number(s.coach_away) || Number(s.coordinator_away)).length)} tone={sessions.some((s) => Number(s.coach_away) || Number(s.coordinator_away)) ? "warn" : undefined} />
          </div>
          <div className="dash-grid">
            <Card title={t("Sessions per day")} wide>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={sessionsPerDay} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    {timeAxis}
                    <Bar isAnimationActive={false} dataKey={t("Held")} stackId="s" stroke="#fff" strokeWidth={2} fill={SERIES[0]} />
                    <Bar isAnimationActive={false} dataKey={t("Upcoming")} stackId="s" stroke="#fff" strokeWidth={2} fill={SERIES[2]} />
                    <Bar isAnimationActive={false} dataKey={t("Cancelled")} stackId="s" stroke="#fff" strokeWidth={2} fill={STATUS.neutral} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={t("Attendance rate by group, lowest first")}>
              <Ranking rows={groupAttendance} valueLabel="%" max={100} onPick={pickGroup} tone={SERIES[1]} />
            </Card>
            <Card title={t("Registers not complete")} action={exportButton("registers", unmarkedRegisters.map((s) => ({ group: s.group_id, week: s.week, starts: s.starts_at, coordinator: who(s.coordinator_id || groupById.get(s.group_id)?.coordinator), marked: marksBySession.get(s.id) || 0, students: rosterOf(s.group_id) })))}>
              <div className="dash-table-wrap is-short">
                <table className="dash-table">
                  <thead><tr><th>{t("Group")}</th><th>{t("Week")}</th><th>{t("Coordinator")}</th><th>{t("Marked")}</th></tr></thead>
                  <tbody>
                    {unmarkedRegisters.slice(0, 100).map((s) => (
                      <tr key={s.id} onClick={() => pickGroup(s.group_id)}>
                        <td><bdi>{s.group_id}</bdi></td>
                        <td>{num(s.week)}</td>
                        <td>{who(s.coordinator_id || groupById.get(s.group_id)?.coordinator)}</td>
                        <td>
                          <bdi dir="ltr">
                            {num(marksBySession.get(s.id) || 0)} / {num(rosterOf(s.group_id))}
                          </bdi>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!unmarkedRegisters.length && <p className="dash-empty">{t("Every register is complete.")}</p>}
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="followups">
          <div className="dash-kpis">
            <Kpi label={t("Contacts logged")} value={num(contacts.length)} sub={t("{v0} students reached", { v0: num(contactedIds.size) })} />
            <Kpi label={t("Not contacted in the period")} value={num(active.length - [...contactedIds].filter((id) => active.some((s) => s.id === id)).length)} tone="warn" />
            <Kpi label={t("Open actions")} value={num(openTasks.length)} />
            <Kpi label={t("Overdue actions")} value={num(overdueTasks.length)} tone={overdueTasks.length ? "bad" : "good"} />
            <Kpi label={t("Open cases")} value={num(openCases.length)} sub={t("{v0} urgent", { v0: num(openCases.filter((c) => /S1|S2/.test(c.severity || "")).length) })} />
            <Kpi label={t("Technical problems reported")} value={num((data.support || []).filter((x: Row) => inRange(x.created_at)).length)} />
          </div>
          <div className="dash-grid">
            <Card title={t("Contact rate by coordinator, lowest first")}>
              <Ranking rows={contactsByCoordinator} valueLabel="%" max={100} onPick={pickCoordinator} />
            </Card>
            <Card title={t("Overdue actions by owner")}>
              <Ranking rows={top(overdueByOwner, "value", 12)} valueLabel={t("Overdue actions")} onPick={pickPerson} tone={STATUS.bad} />
            </Card>
            <Card title={t("Open cases")} wide action={exportButton("cases", openCases.map((c) => ({ id: c.id, type: t(c.type), severity: t(c.severity), status: t(c.status), owner: who(c.owner), due: c.due, group: c.group_id })))}>
              <div className="dash-table-wrap is-short">
                <table className="dash-table">
                  <thead><tr><th>{t("Case")}</th><th>{t("Type")}</th><th>{t("Severity")}</th><th>{t("Status")}</th><th>{t("Owner")}</th><th>{t("Due")}</th></tr></thead>
                  <tbody>
                    {openCases.slice(0, 100).map((c) => (
                      <tr key={c.id} onClick={() => c.owner && pickPerson(c.owner)}>
                        <td><bdi>{c.group_id || c.id}</bdi></td>
                        <td>{t(c.type)}</td>
                        <td>{t(c.severity)}</td>
                        <td>{t(c.status)}</td>
                        <td>{who(c.owner)}</td>
                        <td className={Date.parse(c.due) < now ? "is-late" : ""}>{cairoDay(c.due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!openCases.length && <p className="dash-empty">{t("No open cases.")}</p>}
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="services">
          <div className="dash-kpis">
            <Kpi label={t("Students who submitted links")} value={num(submittedStudents)} sub={t("{v0}% of active", { v0: num(pct(submittedStudents, active.length) ?? 0) })} />
            <Kpi label={t("Waiting for review")} value={num(linkCounts.pending)} />
            <Kpi label={t("Past 48-hour SLA")} value={num(linkCounts.late)} tone={linkCounts.late ? "bad" : "good"} />
            <Kpi label={t("Approved")} value={num(linkCounts.approved)} tone="good" />
            <Kpi label={t("Rejected, waiting on the student")} value={num(linkCounts.rejected)} tone={linkCounts.rejected ? "warn" : undefined} />
            <Kpi label={t("Students with 3 approved links")} value={num(completeStudents)} />
            <Kpi label={t("Paid services")} value={num(gigs.length)} sub={t("{v0} accepted proofs", { v0: num(evidence.filter((e) => e.status === "Accepted").length) })} />
            <Kpi label={t("Client account requests")} value={num(requests.length)} sub={t("{v0} waiting", { v0: num(requests.filter((r) => r.status === "Submitted").length) })} />
          </div>
          <div className="dash-grid">
            <Card title={t("Service links by platform")}>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={linksByPlatform} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="name" tick={{ fill: INK, fontSize: 12 }} reversed={ar} />
                    <YAxis allowDecimals={false} tick={{ fill: INK, fontSize: 12 }} orientation={ar ? "right" : "left"} width={36} />
                    <Tooltip />
                    <Legend itemSorter={null} wrapperStyle={{ fontSize: 13 }} />
                    <Bar isAnimationActive={false} dataKey={t("Approved")} stackId="l" stroke="#fff" strokeWidth={2} fill={STATUS.good} />
                    <Bar isAnimationActive={false} dataKey={t("Waiting for review")} stackId="l" stroke="#fff" strokeWidth={2} fill={STATUS.warn} />
                    <Bar isAnimationActive={false} dataKey={t("Rejected")} stackId="l" stroke="#fff" strokeWidth={2} fill={STATUS.bad} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={t("Quality decisions by reviewer")}>
              <Ranking rows={top(reviewsByReviewer, "value", 12)} valueLabel={t("Quality decisions")} onPick={pickPerson} tone={SERIES[2]} />
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="accounts">
          <div className="dash-kpis">
            <Kpi label={t("Client accounts")} value={num(accounts.length)} sub={t("{v0} available", { v0: num(accounts.filter((a) => a.status === "Available").length) })} />
            <Kpi label={t("Assigned to a coordinator")} value={num(accounts.filter((a) => a.coordinator_id).length)} sub={t("{v0} not assigned yet", { v0: num(accounts.filter((a) => !a.coordinator_id).length) })} />
            <Kpi label={t("Available credit")} value={"$" + num(accounts.reduce((n, a) => n + Number(a.credits || 0), 0), 2)} />
            <Kpi label={t("Pending credit")} value={"$" + num(accounts.reduce((n, a) => n + Number(a.pending_credits || 0), 0), 2)} />
            <Kpi label={t("Topped up in the period")} value={"$" + num(topups, 2)} />
            <Kpi label={t("Charged in the period")} value={"$" + num(charged, 2)} />
            <Kpi label={t("Access issues")} value={num(accounts.filter((a) => ["Access Issue", "Blocked", "Under Review"].includes(a.status)).length)} tone="warn" />
          </div>
          <div className="dash-grid">
            <Card title={t("Credit by platform")}>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={creditByPlatform} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="name" tick={{ fill: INK, fontSize: 12 }} reversed={ar} />
                    <YAxis tick={{ fill: INK, fontSize: 12 }} orientation={ar ? "right" : "left"} width={48} />
                    <Tooltip formatter={(v: any) => "$" + num(Number(v))} />
                    <Legend itemSorter={null} wrapperStyle={{ fontSize: 13 }} />
                    <Bar isAnimationActive={false} dataKey={t("Available credit")} fill={SERIES[0]} radius={[4, 4, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey={t("Pending credit")} fill={SERIES[1]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={t("Accounts per coordinator")}>
              <Ranking rows={top(accountsByCoordinator, "value", 14)} valueLabel={t("Client accounts")} onPick={(id) => id !== "-" && pickCoordinator(id)} />
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="feedback">
          <div className="dash-kpis">
            <Kpi label={t("Responses")} value={num(feedback.length)} />
            <Kpi label={t("Average session rating")} value={avgFeedback === null ? "—" : num(avgFeedback, 1) + " / 5"} tone={avgFeedback === null ? undefined : avgFeedback >= 4 ? "good" : avgFeedback >= 3 ? "warn" : "bad"} />
            <Kpi label={t("Red flags")} value={num(flagged.length)} sub={t("{v0} handled", { v0: num(flagged.length - openFlags.length) })} tone={openFlags.length ? "bad" : "good"} />
            <Kpi label={t("Sessions rated")} value={num(ratedHeld)} sub={t("{v0}% of sessions held", { v0: num(pct(ratedHeld, held.length) ?? 0) })} />
          </div>
          <div className="dash-grid">
            <Card title={t("Average rating by week")}>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={feedbackByWeek} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="week" tick={{ fill: INK, fontSize: 12 }} reversed={ar} />
                    <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: INK, fontSize: 12 }} orientation={ar ? "right" : "left"} width={30} />
                    <Tooltip />
                    <Line isAnimationActive={false} type="linear" dataKey={t("Average rating")} stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={t("Average rating by coach, lowest first")}>
              <Ranking rows={[...feedbackByCoach].sort((a, b) => a.value - b.value).slice(0, 12)} valueLabel={t("Average rating")} max={5} onPick={(id) => set("coach", f.coach === id ? "All" : id)} tone={SERIES[1]} />
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
