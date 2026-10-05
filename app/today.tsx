"use client";

// Each role's "Today": what that person has to do now, and nothing else.
// The coordinator sees today's sessions, students to contact, services to
// review and their own figures; the supervisor their coordinators, worst
// first; Project Operations the graduation funnel, spend and blockers; Coach
// Operations this week's sessions and coverage; a coach their own sessions.

import { AlertTriangle, CalendarDays, Check, Clock3, ExternalLink, MessageCircle, UserCog } from "lucide-react";
import { useT } from "@/lib/i18n/context";

type Row = Record<string, any>;

/** Everything a Today screen needs from the workspace. */
export type TodayContext = {
  user: Row;
  d: Row;
  students: Row[];
  groups: Row[];
  sessions: Row[];
  attendance: Row[];
  evidence: Row[];
  can: (roles: string[], allowed: string[]) => boolean;
  owner: (id: string) => string;
  name: (id: string) => string;
  fmt: (iso: string) => string;
  cairoDay: (iso?: string | Date) => string;
  open: (action: string, row?: Row) => void;
  openStudent: (id: string) => void;
  openAttendance: (session: Row) => void;
  takesAttendance: (session: Row) => boolean;
  canAttend: (session: Row) => boolean;
  canDecline: (session: Row) => boolean;
  confirm: (session: Row) => void;
  checklistOf: (session: Row) => Record<string, { done: boolean; flagged?: string }>;
  whatsapp: (phone: string, template: "reminder" | "absence" | "congratulations", values: Row) => string | null;
  goTo: (module: string) => void;
};

const DAY = 86400000;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" });
const pct = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : null);
const tone = (value: number | null, good = 85, fair = 65) =>
  value === null ? "info" : value >= good ? "ok" : value >= fair ? "warn" : "bad";
/** The word that always goes with a status colour. */
const word = (value: number | null, good = 85, fair = 65) =>
  value === null ? "No data yet" : value >= good ? "On track" : value >= fair ? "At risk" : "Critical";
const ended = (s: Row) => s.status !== "Cancelled" && Date.parse(s.starts_at) + Number(s.duration_minutes || 180) * 60000 <= Date.now();

/** A KPI card: the figure, its word, and what it measures. */
function Kpi({ label, value, unit = "%", note, good, fair }: { label: string; value: number | null; unit?: string; note?: string; good?: number; fair?: number }) {
  const t = useT();
  const level = { ok: "green", warn: "amber", bad: "red", info: "neutral" }[tone(value, good, fair)];
  return (
    <div className={"kpi-card kpi-" + level}>
      <span className="kpi-value">{value === null ? "—" : value + unit}</span>
      <strong>{label}</strong>
      <small>{level === "green" ? t("On track") : level === "amber" ? t("At risk") : level === "red" ? t("Critical") : t("No data yet")}{note ? " · " + note : ""}</small>
    </div>
  );
}

/** Graduation as three dots: one per qualifying service, all three when graduated. */
export function GraduationDots({ graduation }: { graduation?: string }) {
  const done = /Graduat/.test(graduation || "") ? 3 : Number(String(graduation || "0").split("/")[0]) || 0;
  return (
    <span className="grad-dots" title={graduation}>
      {[0, 1, 2].map((i) => (
        <i key={i} className={i < done ? "is-done" : ""} />
      ))}
    </span>
  );
}

/** The KPIs of one coordinator, from the sessions, students and reviews in view. */
export function coordinatorKpis(ctx: TodayContext, coordinatorId: string) {
  const { sessions, attendance, students, groups, evidence, d } = ctx;
  const theirGroups = new Set(groups.filter((g) => g.coordinator === coordinatorId).map((g) => g.id));
  const month = Date.now() - 30 * DAY;
  // Same-day attendance: held sessions whose register was saved the day they were held.
  const held = sessions.filter((s) => (s.coordinator_id || "") === coordinatorId || (!s.coordinator_id && theirGroups.has(s.group_id))).filter(ended).filter((s) => Date.parse(s.starts_at) >= month);
  const sameDay = held.filter((s) => {
    const marks = attendance.filter((a) => a.session_id === s.id);
    return marks.length > 0 && marks.every((a) => ctx.cairoDay(a.updated_at) === ctx.cairoDay(s.starts_at));
  }).length;
  // Reviews within 48 hours: their decisions at the coordinator step, timed from when the service reached it.
  const mine = (d.reviews || []).filter((r: Row) => r.actor === coordinatorId && Date.parse(r.created_at) >= month);
  const quick = mine.filter((r: Row) => {
    const earlier = (d.reviews || [])
      .filter((x: Row) => x.evidence_id === r.evidence_id && x.created_at < r.created_at)
      .sort((a: Row, b: Row) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const since = earlier?.created_at || evidence.find((e) => e.id === r.evidence_id)?.created_at;
    return since ? Date.parse(r.created_at) - Date.parse(since) <= 2 * DAY : true;
  }).length;
  // Data accuracy: active students with an email, a mobile and a 14-digit national ID.
  const theirs = students.filter((s) => theirGroups.has(s.group_id) && s.lifecycle === "Active");
  const complete = theirs.filter((s) => s.email && /^01\d{9}/.test(String(s.phone || "")) && /^\d{14}$/.test(String(s.national_id || s.id || ""))).length;
  const graduated = theirs.filter((s) => /Graduat/.test(s.graduation || "")).length;
  const contacted = theirs.filter((s) => !s.contact_due).length;
  const waiting = evidence.filter((e) => e.status === "Coordinator L1" && theirs.some((s) => s.id === e.student_id));
  return {
    sameDay: pct(sameDay, held.length),
    reviews48: pct(quick, mine.length),
    accuracy: pct(complete, theirs.length),
    graduation: pct(graduated, theirs.length),
    contact: pct(contacted, theirs.length),
    overdueReviews: waiting.filter((e) => Date.now() - Date.parse(e.stage_at) > 2 * DAY).length,
    students: theirs.length,
    graduated,
  };
}

function CoordinatorToday({ ctx }: { ctx: TodayContext }) {
  const t = useT();
  const { user, sessions, students, groups, evidence } = ctx;
  const mine = new Set(groups.filter((g) => g.coordinator === user.id).map((g) => g.id));
  const today = ctx.cairoDay(new Date());
  const todays = sessions
    .filter((s) => s.status !== "Cancelled" && ctx.cairoDay(s.starts_at) === today && ((s.coordinator_id || "") === user.id || mine.has(s.group_id)))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const silent = students
    .filter((s) => mine.has(s.group_id) && s.lifecycle === "Active")
    .filter((s) => !s.last_contact || Date.now() - Date.parse(s.last_contact) > 7 * DAY)
    .sort((a, b) => String(a.last_contact || "").localeCompare(String(b.last_contact || "")));
  const toReview = evidence
    .filter((e) => e.status === "Coordinator L1" && e.recorder !== user.id && students.some((s) => s.id === e.student_id && mine.has(s.group_id)))
    .sort((a, b) => String(a.stage_at).localeCompare(String(b.stage_at)));
  const k = coordinatorKpis(ctx, user.id);
  return (
    <div className="today">
      <div className="kpi-grid">
        <Kpi label={t("Same-day attendance")} value={k.sameDay} />
        <Kpi label={t("Reviews within 48 hours")} value={k.reviews48} />
        <Kpi label={t("Data accuracy")} value={k.accuracy} good={95} fair={85} />
        <Kpi label={t("Graduation progress")} value={k.graduation} good={60} fair={30} note={t("{v0} of {v1}", { v0: k.graduated, v1: k.students })} />
      </div>

      <section className="panel today-panel">
        <h3><CalendarDays size={17} /> {t("Today's sessions")}</h3>
        {todays.length ? (
          <div className="today-list">
            {todays.map((s) => {
              const link = groups.find((g) => g.id === s.group_id)?.session_link;
              const marked = ctx.attendance.filter((a) => a.session_id === s.id).length;
              return (
                <article key={s.id} className="today-row">
                  <div>
                    <strong>{time(s.starts_at)} · {s.group_id}</strong>
                    <small>{s.title} · {ctx.owner(s.coach_id)} · {t("Week {v0}", { v0: s.week })}</small>
                  </div>
                  <div className="today-actions">
                    {link && <a className="small-btn" href={link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {t("Join")}</a>}
                    {ctx.takesAttendance(s) ? (
                      <button className={marked ? "small-btn" : "small-btn is-strong"} onClick={() => ctx.openAttendance(s)}>
                        {marked ? t("Attendance taken") : t("Take attendance")}
                      </button>
                    ) : (
                      <small className="muted">{t("Starts at {v0}", { v0: time(s.starts_at) })}</small>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="footnote">{t("No sessions today.")}</p>
        )}
      </section>

      <section className="panel today-panel">
        <h3><MessageCircle size={17} /> {t("No contact in 7 days")} <span className="count">{silent.length}</span></h3>
        {silent.length ? (
          <div className="today-list">
            {silent.slice(0, 15).map((s) => {
              const wa = ctx.whatsapp(s.phone, "absence", { name: s.name });
              return (
                <article key={s.id} className="today-row">
                  <button className="text-link" onClick={() => ctx.openStudent(s.id)}>
                    <strong>{s.name}</strong>
                    <small>{s.group_id} · {s.last_contact ? t("last contact {v0}", { v0: ctx.fmt(s.last_contact) }) : t("never contacted")}</small>
                  </button>
                  <div className="today-actions">
                    {wa && <a className="small-btn wa-btn" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
                    <button className="small-btn" onClick={() => ctx.open("contact", { student_id: s.id })}>{t("Log contact")}</button>
                  </div>
                </article>
              );
            })}
            {silent.length > 15 && <button className="text-link" onClick={() => ctx.goTo("students")}>{t("Show all ({v0})", { v0: silent.length })}</button>}
          </div>
        ) : (
          <p className="footnote">{t("Everyone has been contacted this week.")}</p>
        )}
      </section>

      <section className="panel today-panel">
        <h3><Clock3 size={17} /> {t("Services waiting for your review")} <span className="count">{toReview.length}</span></h3>
        {toReview.length ? (
          <div className="today-list">
            {toReview.map((e) => {
              const left = Math.round((Date.parse(e.stage_at) + 2 * DAY - Date.now()) / 3600000);
              return (
                <article key={e.id} className="today-row">
                  <div>
                    <strong>{ctx.name(e.student_id)}</strong>
                    <small>{e.gig_title || e.gig_id}</small>
                  </div>
                  <div className="today-actions">
                    <span className={"badge " + (left < 0 ? "red" : left < 12 ? "amber" : "green")}>
                      {left < 0 ? t("{v0}h overdue", { v0: -left }) : t("{v0}h left", { v0: left })}
                    </span>
                    <button className="small-btn is-strong" onClick={() => ctx.open("review", e)}>{t("Review")}</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="footnote">{t("Nothing waiting for you.")}</p>
        )}
      </section>
    </div>
  );
}

function SupervisorToday({ ctx }: { ctx: TodayContext }) {
  const t = useT();
  const { user, groups } = ctx;
  const coordinators = Array.from(new Set(groups.filter((g) => g.supervisor === user.id).map((g) => g.coordinator)));
  const ranked = coordinators
    .map((id) => {
      const k = coordinatorKpis(ctx, id);
      const parts = [k.sameDay, k.reviews48, k.accuracy, k.contact].filter((v): v is number => v !== null);
      return { id, k, score: parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null };
    })
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return (
    <div className="today">
      <section className="panel today-panel">
        <h3><UserCog size={17} /> {t("Your coordinators, weakest first")}</h3>
        <div className="table-wrap">
          <table className="today-table">
            <thead>
              <tr>
                <th>{t("Coordinator")}</th><th>{t("Score")}</th><th>{t("Same-day attendance")}</th><th>{t("Reviews within 48 hours")}</th>
                <th>{t("Contact")}</th><th>{t("Data accuracy")}</th><th>{t("Reviews overdue")}</th><th />
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ id, k, score }) => (
                <tr key={id}>
                  <td><strong>{ctx.owner(id)}</strong><small className="table-subline">{t("{v0} students", { v0: k.students })}</small></td>
                  <td><span className={"badge " + tone(score)}>{score === null ? t("No data yet") : `${score}% · ${t(word(score))}`}</span></td>
                  {[k.sameDay, k.reviews48, k.contact, k.accuracy].map((v, i) => (
                    <td key={i}><span className={"badge " + tone(v)}>{v === null ? "—" : `${v}% · ${t(word(v))}`}</span></td>
                  ))}
                  <td>{k.overdueReviews ? <strong className="credit-out">{k.overdueReviews}</strong> : 0}</td>
                  <td>
                    <button className="small-btn" onClick={() => ctx.open("case", { title: t("Intervention: {v0}", { v0: ctx.owner(id) }), severity: "S2 High", type: "Quality" })}>
                      {t("Intervene")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ranked.length && <p className="footnote">{t("No coordinators are assigned to your groups yet.")}</p>}
      </section>
    </div>
  );
}

function OperationsToday({ ctx }: { ctx: TodayContext }) {
  const t = useT();
  const { students, groups, d, sessions } = ctx;
  const teamOf = (groupId: string) => groups.find((g) => g.id === groupId)?.supervisor_team || "No team";
  const teams = ["Target Team", "Service Team", "No team"];
  const stage = (s: Row) => (/Graduat/.test(s.graduation || "") ? 3 : Number(String(s.graduation || "0").split("/")[0]) || 0);
  const funnel = teams
    .map((team) => {
      const mine = students.filter((s) => teamOf(s.group_id) === team);
      const active = mine.filter((s) => s.lifecycle === "Active");
      return {
        team,
        enrolled: mine.length,
        active: active.length,
        one: active.filter((s) => stage(s) >= 1).length,
        two: active.filter((s) => stage(s) >= 2).length,
        graduated: mine.filter((s) => stage(s) === 3).length,
      };
    })
    .filter((f) => f.enrolled);
  const ledger: Row[] = d.creditLedger || [];
  const budget = ledger.filter((e) => Number(e.delta) > 0 && !e.gig_id).reduce((n, e) => n + Number(e.delta), 0);
  const spent = -ledger.filter((e) => Number(e.delta) < 0).reduce((n, e) => n + Number(e.delta), 0) - ledger.filter((e) => Number(e.delta) > 0 && e.gig_id).reduce((n, e) => n + Number(e.delta), 0);
  const blockers = (d.cases || []).filter((c: Row) => c.status !== "Closed" && c.status !== "Resolved" && /S1|S2/.test(c.severity || ""));
  const soon = sessions.filter((s) => s.status === "Scheduled" && Date.parse(s.starts_at) > Date.now() && Date.parse(s.starts_at) - Date.now() < 2 * DAY);
  const uncoached = groups.filter((g) => g.status === "Active" && !(d.groupCoaches || []).some((c: Row) => c.group_id === g.id && c.status === "Active" && ["Outcome Coach", "Support Coach"].includes(c.coach_type)));
  return (
    <div className="today">
      <section className="panel today-panel">
        <h3>{t("Graduation funnel by team")}</h3>
        <div className="funnel">
          {funnel.map((f) => (
            <div key={f.team} className="funnel-team">
              <strong>{t(f.team)}</strong>
              {[
                [t("Enrolled"), f.enrolled],
                [t("Active"), f.active],
                ["1/3", f.one],
                ["2/3", f.two],
                [t("Graduated"), f.graduated],
              ].map(([label, n]) => (
                <div key={String(label)} className="funnel-step">
                  <span className="funnel-bar" style={{ width: `${f.enrolled ? Math.max(4, (100 * Number(n)) / f.enrolled) : 0}%` }} />
                  <small>{label}</small>
                  <b className="num">{n}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
      <div className="kpi-grid">
        <div className={"kpi-card " + (budget && spent / budget > 0.9 ? "kpi-red" : "kpi-neutral")}>
          <span className="kpi-value money">${spent.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          <strong>{t("Purchase spend")}</strong>
          <small>{budget ? t("of ${v0} loaded ({v1}%)", { v0: budget.toLocaleString("en-US", { maximumFractionDigits: 0 }), v1: Math.round((100 * spent) / budget) }) : t("No account credit loaded yet")}</small>
          {budget > 0 && <div className="student-progress-bar"><span style={{ width: `${Math.min(100, (100 * spent) / budget)}%` }} /></div>}
        </div>
        <div className={"kpi-card " + (uncoached.length ? "kpi-red" : "kpi-green")}>
          <span className="kpi-value">{uncoached.length}</span>
          <strong>{t("Active groups without a coach")}</strong>
          <small>{uncoached.length ? t("Critical") : t("On track")}</small>
        </div>
        <div className={"kpi-card " + (soon.length ? "kpi-amber" : "kpi-green")}>
          <span className="kpi-value">{soon.length}</span>
          <strong>{t("Sessions in 48 hours not confirmed")}</strong>
          <small>{soon.length ? t("At risk") : t("On track")}</small>
        </div>
      </div>
      <section className="panel today-panel">
        <h3><AlertTriangle size={17} /> {t("Open blockers")} <span className="count">{blockers.length}</span></h3>
        {blockers.length ? (
          <div className="today-list">
            {blockers.slice(0, 10).map((c: Row) => (
              <article key={c.id} className="today-row">
                <div>
                  <strong>{c.title}</strong>
                  <small>{c.severity} · {ctx.owner(c.owner)} · {t("due {v0}", { v0: ctx.fmt(c.due) })}</small>
                </div>
                <button className="small-btn" onClick={() => ctx.open("case_transition", c)}>{t("Update")}</button>
              </article>
            ))}
          </div>
        ) : (
          <p className="footnote">{t("No open critical or high cases.")}</p>
        )}
      </section>
    </div>
  );
}

/** The programme week: Friday to Thursday, in Cairo. */
function programWeek(ctx: TodayContext) {
  const today = new Date(ctx.cairoDay(new Date()) + "T12:00:00Z");
  const back = (today.getUTCDay() - 5 + 7) % 7;
  const friday = new Date(today.getTime() - back * DAY);
  return Array.from({ length: 7 }, (_, i) => ctx.cairoDay(new Date(friday.getTime() + i * DAY)));
}

function CoachOperationsToday({ ctx }: { ctx: TodayContext }) {
  const t = useT();
  const week = programWeek(ctx);
  const inWeek = ctx.sessions.filter((s) => s.status !== "Cancelled" && week.includes(ctx.cairoDay(s.starts_at)));
  const days = week.map((day) => {
    const list = inWeek.filter((s) => ctx.cairoDay(s.starts_at) === day);
    return {
      day,
      list,
      coached: list.filter((s) => s.coach_id && !/unassigned/i.test(ctx.owner(s.coach_id))).length,
      confirmed: list.filter((s) => s.status === "Confirmed").length,
    };
  });
  const thursday = days[6];
  const others = days.slice(0, 6).map((x) => x.list.length);
  const average = others.reduce((a, b) => a + b, 0) / Math.max(1, others.filter((n) => n).length || 1);
  const heavy = thursday.list.length > 0 && thursday.list.length > average * 1.5;
  const late = ctx.sessions
    .filter((s) => s.status === "Scheduled" && Date.parse(s.starts_at) > Date.now() && Date.parse(s.starts_at) - Date.now() <= DAY)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <div className="today">
      {heavy && (
        <div className="info-box warning-box">
          <AlertTriangle size={16} />
          {t("Thursday is heavy: {v0} sessions, against about {v1} on other days.", { v0: thursday.list.length, v1: Math.round(average) })}
        </div>
      )}
      <section className="panel today-panel">
        <h3><CalendarDays size={17} /> {t("This week's sessions")}</h3>
        <div className="week-grid">
          {days.map((x) => (
            <div key={x.day} className={"week-day" + (x.day === ctx.cairoDay(new Date()) ? " is-today" : "")}>
              <strong>{t(new Date(x.day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }))}</strong>
              <small>{x.day.slice(5)}</small>
              <span className="num">{x.list.length}</span>
              <small>{t("{v0} with a coach", { v0: x.coached })}</small>
              <small>{t("{v0} confirmed", { v0: x.confirmed })}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="panel today-panel">
        <h3><Clock3 size={17} /> {t("Not confirmed, starting within 24 hours")} <span className="count">{late.length}</span></h3>
        {late.length ? (
          <div className="today-list">
            {late.map((s) => (
              <article key={s.id} className="today-row">
                <div>
                  <strong>{time(s.starts_at)} · {s.group_id}</strong>
                  <small>{ctx.owner(s.coach_id)} · {s.coach_confirmed_at ? t("coach confirmed") : t("coach not confirmed")} · {s.coordinator_confirmed_at ? t("coordinator confirmed") : t("coordinator not confirmed")}</small>
                </div>
                <button className="small-btn" onClick={() => ctx.open("session_coach", { ...s, mode: "existing", coach_id: "" })}>{t("Change coach")}</button>
              </article>
            ))}
          </div>
        ) : (
          <p className="footnote">{t("Every session in the next 24 hours is confirmed.")}</p>
        )}
      </section>
    </div>
  );
}

function CoachToday({ ctx }: { ctx: TodayContext }) {
  const t = useT();
  const { user, groups, sessions } = ctx;
  const coached = new Set((ctx.d.groupCoaches || []).filter((c: Row) => c.user_id === user.id && c.status === "Active").map((c: Row) => c.group_id));
  const mine = sessions
    .filter((s) => s.status !== "Cancelled" && (s.coach_id ? s.coach_id === user.id : coached.has(s.group_id)))
    .filter((s) => {
      const startsIn = Date.parse(s.starts_at) - Date.now();
      return startsIn < 7 * DAY && (startsIn > -DAY || (ctx.takesAttendance(s) && !ctx.attendance.some((a) => a.session_id === s.id)));
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <div className="today coach-today">
      <h3 className="today-title">{t("My sessions")}</h3>
      {mine.length ? (
        mine.map((s) => {
          const link = groups.find((g) => g.id === s.group_id)?.session_link;
          return (
            <article key={s.id} className="coach-card">
              <div className="coach-card-head">
                <strong>{ctx.fmt(s.starts_at)} · {time(s.starts_at)}</strong>
                <span className={"badge " + (s.status === "Confirmed" ? "green" : "amber")}>{t(s.status)}</span>
              </div>
              <small>{s.group_id} · {s.title} · {t("Week {v0}", { v0: s.week })}</small>
              <div className="coach-card-actions">
                {link && <a className="small-btn" href={link} target="_blank" rel="noreferrer"><ExternalLink size={15} /> {t("Join")}</a>}
                {ctx.canAttend(s) && <button className="small-btn is-strong" onClick={() => ctx.confirm(s)}><Check size={15} /> {t("Confirm")}</button>}
                {ctx.canDecline(s) && <button className="small-btn" onClick={() => ctx.open("session_unavailable", s)}>{t("Unavailable")}</button>}
                {ctx.takesAttendance(s) && <button className="small-btn is-strong" onClick={() => ctx.openAttendance(s)}>{t("Take attendance")}</button>}
                <button className="small-btn" onClick={() => ctx.open("milestone", { group_id: s.group_id })}>{t("Update milestone")}</button>
              </div>
            </article>
          );
        })
      ) : (
        <p className="footnote">{t("No sessions in the next 7 days.")}</p>
      )}
    </div>
  );
}

/** The Today screen for whoever is signed in. */
export function TodayView({ ctx }: { ctx: TodayContext }) {
  const r = ctx.user.roles || [];
  const has = (roles: string[]) => ctx.can(r, roles);
  if (has(["Project Operations", "Operations Systems / Admin", "Higher Board"])) return <OperationsToday ctx={ctx} />;
  if (has(["Coach Operations"])) return <CoachOperationsToday ctx={ctx} />;
  if (has(["Team Supervisor"])) return <SupervisorToday ctx={ctx} />;
  if (has(["Operations Coordinator"])) return <CoordinatorToday ctx={ctx} />;
  if (has(["Coach"])) return <CoachToday ctx={ctx} />;
  return <OperationsToday ctx={ctx} />;
}
