"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { can } from "@/lib/domain/rules";

type Row = Record<string, any>;

/**
 * The programme week runs Friday to Thursday, in Cairo. Every record is placed
 * in a week by its Cairo calendar day, so a contact logged at 1 a.m. on Friday
 * belongs to the new week however the browser's clock is set.
 */
const cairoDay = (value: string | Date) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const addDays = (day: string, n: number) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The Friday that opens the week containing `day`. */
export function weekStart(day: string) {
  const weekday = new Date(day + "T12:00:00Z").getUTCDay(); // Friday is 5
  return addDays(day, -((weekday - 5 + 7) % 7));
}
const within = (value: string | null | undefined, from: string, to: string) => {
  if (!value) return false;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : cairoDay(value);
  return day >= from && day <= to;
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) + "%" : "—");
const ATTENDED = ["Present", "Late"];

export function WeeklyProgress({ data, onStudent }: { data: Row; onStudent: (id: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const user = data.user || { roles: [] };
  const leader = can(user.roles, ["Project Operations", "Coach Operations", "Operations Systems / Admin", "Higher Board"]);
  const [offset, setOffset] = useState(0);
  const [supervisor, setSupervisor] = useState("All");
  const [open, setOpen] = useState<string | null>(null);

  const today = cairoDay(new Date());
  const from = addDays(weekStart(today), offset * 7);
  const to = addDays(from, 6);
  const label = (day: string) =>
    new Date(day + "T12:00:00Z").toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  const view = useMemo(() => {
    const staff: Row[] = data.staff || [];
    const groups: Row[] = data.groups || [];
    const students: Row[] = (data.students || []).filter((s: Row) => s.lifecycle === "Active");
    const sessions: Row[] = (data.sessions || []).filter((s: Row) => s.status !== "Cancelled" && within(s.session_day, from, to));
    const sessionIds = new Set(sessions.map((s) => s.id));
    const attendance: Row[] = (data.attendance || []).filter((a: Row) => sessionIds.has(a.session_id));
    const contacts: Row[] = (data.contacts || []).filter((c: Row) => within(c.occurred_at, from, to));
    const links: Row[] = data.serviceLinks || [];
    const evidence: Row[] = (data.evidence || []).filter((e: Row) => within(e.created_at, from, to));
    const tasks: Row[] = data.tasks || [];
    const now = new Date().toISOString();

    const inScopeGroups = groups.filter(
      (g) => g.status === "Active" && (supervisor === "All" || g.supervisor === supervisor),
    );
    const groupIds = new Set(inScopeGroups.map((g) => g.id));
    const scopedStudents = students.filter((s) => groupIds.has(s.group_id));
    const contactedBy = new Map<string, string>();
    for (const c of contacts) {
      const day = cairoDay(c.occurred_at);
      if (!contactedBy.has(c.student_id) || day > contactedBy.get(c.student_id)!) contactedBy.set(c.student_id, day);
    }
    const attendanceBy = new Map<string, string>();
    for (const a of attendance) attendanceBy.set(a.student_id, a.status);
    const linksBy = new Map<string, Row[]>();
    for (const l of links) linksBy.set(l.student_id, [...(linksBy.get(l.student_id) || []), l]);

    const measure = (list: Row[], gids: Set<string>, ownerIds: string[]) => {
      const ids = new Set(list.map((s) => s.id));
      const weekSessions = sessions.filter((s) => gids.has(s.group_id));
      const held = weekSessions.filter((s) => s.status === "Completed").length;
      const marks = attendance.filter((a) => ids.has(a.student_id));
      return {
        students: list.length,
        contacted: list.filter((s) => contactedBy.has(s.id)).length,
        sessions: weekSessions.length,
        held,
        attendance: pct(marks.filter((a) => ATTENDED.includes(a.status)).length, marks.length),
        submitted: new Set(links.filter((l) => ids.has(l.student_id) && within(l.submitted_at, from, to)).map((l) => l.student_id)).size,
        locked: links.filter((l) => ids.has(l.student_id) && l.qc_status === "Locked" && within(l.qc_at, from, to)).length,
        evidence: evidence.filter((e) => ids.has(e.student_id)).length,
        overdue: tasks.filter((k) => k.status === "Open" && k.due < now && ownerIds.includes(k.owner)).length,
        atRisk: list.filter((s) => ["At Risk", "Critical"].includes(s.risk?.status)).length,
      };
    };

    const coordinators = staff
      .filter((u) => inScopeGroups.some((g) => g.coordinator === u.id))
      .map((u) => {
        const gids = new Set(inScopeGroups.filter((g) => g.coordinator === u.id).map((g) => g.id));
        const list = scopedStudents.filter((s) => gids.has(s.group_id));
        return { id: u.id, name: u.name, title: u.title || "", groups: [...gids], list, ...measure(list, gids, [u.id]) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const supervisors = staff.filter((u) => groups.some((g) => g.status === "Active" && g.supervisor === u.id));
    const totals = measure(scopedStudents, groupIds, coordinators.map((c) => c.id));
    return { coordinators, supervisors, totals, contactedBy, attendanceBy, linksBy, sessionsInWeek: sessions };
  }, [data, from, to, supervisor]);

  const { totals } = view;
  const stats = [
    { label: "Students contacted", value: `${totals.contacted} / ${totals.students}`, detail: pct(totals.contacted, totals.students) },
    { label: "Sessions this week", value: `${totals.held} / ${totals.sessions}`, detail: t("held of scheduled") },
    { label: "Attendance", value: totals.attendance, detail: t("of recorded attendance") },
    { label: "Service links", value: String(totals.submitted), detail: t("{v0} links locked", { v0: totals.locked }) },
    { label: "Evidence submitted", value: String(totals.evidence), detail: t("{v0} overdue actions now", { v0: totals.overdue }) },
  ];

  return (
    <div className="weekly">
      <div className="weekly-bar">
        <div className="weekly-range">
          <CalendarRange size={18} aria-hidden="true" />
          <strong>{label(from)} – {label(to)}</strong>
          {offset === 0 && <span className="badge green">{t("This week")}</span>}
        </div>
        <div className="weekly-nav">
          <button className="small-btn" onClick={() => setOffset(offset - 1)} aria-label={t("Previous week")}>
            <ChevronLeft size={16} className="flip-rtl" /> {t("Previous week")}
          </button>
          {offset !== 0 && (
            <button className="small-btn" onClick={() => setOffset(0)}>{t("This week")}</button>
          )}
          <button className="small-btn" onClick={() => setOffset(offset + 1)} aria-label={t("Next week")}>
            {t("Next week")} <ChevronRight size={16} className="flip-rtl" />
          </button>
          {leader && view.supervisors.length > 0 && (
            <select className="weekly-filter" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} aria-label={t("Supervisor")}>
              <option value="All">{t("All supervisors")}</option>
              {view.supervisors.map((s: Row) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <p className="footnote weekly-note">{t("The programme week runs Friday to Thursday, Cairo time. Figures cover active students in the groups you can see.")}</p>

      <div className="stats weekly-stats">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <span>{t(s.label)}</span>
            <strong>{s.value}</strong>
            <small>{s.detail}</small>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>{t("Coordinators this week")}</h2>
          <span className="count">{view.coordinators.length}</span>
        </div>
        {view.coordinators.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {["Coordinator", "Groups", "Students", "Contacted", "Sessions held", "Attendance", "Links submitted", "Links locked", "Evidence", "Overdue", "At risk"].map((h) => (
                  <TableHead key={h}>{t(h)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.coordinators.map((c) => (
                <Fragment key={c.id}>
                  <TableRow className="weekly-row" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                    <TableCell>
                      <span className="table-name">
                        {c.name}
                        {c.title && <small>{t(c.title)}</small>}
                      </span>
                    </TableCell>
                    <TableCell>{c.groups.length}</TableCell>
                    <TableCell>{c.students}</TableCell>
                    <TableCell>
                      {c.contacted} <small className="table-subline">{pct(c.contacted, c.students)}</small>
                    </TableCell>
                    <TableCell>{c.held} / {c.sessions}</TableCell>
                    <TableCell>{c.attendance}</TableCell>
                    <TableCell>{c.submitted}</TableCell>
                    <TableCell>{c.locked}</TableCell>
                    <TableCell>{c.evidence}</TableCell>
                    <TableCell>{c.overdue ? <span className="badge red">{c.overdue}</span> : 0}</TableCell>
                    <TableCell>{c.atRisk ? <span className="badge amber">{c.atRisk}</span> : 0}</TableCell>
                  </TableRow>
                  {open === c.id && (
                    <TableRow className="weekly-detail">
                      <TableCell colSpan={11}>
                        <StudentWeek
                          students={c.list}
                          contactedBy={view.contactedBy}
                          attendanceBy={view.attendanceBy}
                          linksBy={view.linksBy}
                          sessions={view.sessionsInWeek}
                          onStudent={onStudent}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="empty">
            <h3>{t("No coordinators in this view")}</h3>
            <p>{t("Coordinators appear here once they are assigned to groups you supervise.")}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function StudentWeek({
  students,
  contactedBy,
  attendanceBy,
  linksBy,
  sessions,
  onStudent,
}: {
  students: Row[];
  contactedBy: Map<string, string>;
  attendanceBy: Map<string, string>;
  linksBy: Map<string, Row[]>;
  sessions: Row[];
  onStudent: (id: string) => void;
}) {
  const t = useT();
  const withSession = new Set(sessions.map((s) => s.group_id));
  const rows = [...students].sort(
    (a, b) => Number(contactedBy.has(a.id)) - Number(contactedBy.has(b.id)) || a.name.localeCompare(b.name),
  );
  return (
    <div className="weekly-students">
      <Table>
        <TableHeader>
          <TableRow>
            {["Student", "Group", "Contacted", "Session attendance", "Service links", "Next action", "Risk"].map((h) => (
              <TableHead key={h}>{t(h)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => {
            const links = linksBy.get(s.id) || [];
            const locked = links.filter((l) => l.qc_status === "Locked").length;
            const attended = attendanceBy.get(s.id);
            return (
              <TableRow key={s.id}>
                <TableCell>
                  <button className="text-link" onClick={() => onStudent(s.id)}>
                    {s.name}
                  </button>
                  <small className="table-subline">{s.id}</small>
                </TableCell>
                <TableCell>{s.group_id}</TableCell>
                <TableCell>
                  {contactedBy.has(s.id) ? (
                    <span className="badge green">{contactedBy.get(s.id)}</span>
                  ) : (
                    <span className="badge red">{t("Not contacted")}</span>
                  )}
                </TableCell>
                <TableCell>
                  {!withSession.has(s.group_id) ? (
                    <span className="badge neutral">{t("No session this week")}</span>
                  ) : attended ? (
                    <span className={"badge " + (ATTENDED.includes(attended) ? "green" : "amber")}>{t(attended)}</span>
                  ) : (
                    <span className="badge amber">{t("Not recorded")}</span>
                  )}
                </TableCell>
                <TableCell>
                  {links.length ? t("{v0} of 3 locked", { v0: locked }) : t("Not submitted")}
                </TableCell>
                <TableCell>
                  {s.next_task ? (
                    <>
                      {s.next_task.title}
                      <small className="table-subline">{String(s.next_task.due || "").slice(0, 10)}</small>
                    </>
                  ) : (
                    <span className="badge amber">{t("No next action")}</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className={"badge " + (s.risk?.status === "Critical" ? "red" : s.risk?.status === "At Risk" ? "amber" : "green")}>
                    {t(s.risk?.status || "On Track")}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
