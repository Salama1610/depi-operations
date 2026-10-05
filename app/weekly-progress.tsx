"use client";

import { Fragment, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { can } from "@/lib/domain/rules";
import { SearchableSelect } from "@/components/searchable-select";

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
const ATTENDED = ["Present"];
const roleList = (person: Row): string[] => {
  try {
    return Array.isArray(person.roles) ? person.roles : JSON.parse(person.roles || "[]");
  } catch {
    return [];
  }
};

/**
 * One week of the programme, shown from where the reader sits.
 *
 * A coordinator gets their own students and their own timetable, and nobody
 * else's — their week is a working list, not a league table. A supervisor gets
 * the coordinators they are responsible for. Project Operations gets the
 * supervisors above those coordinators, and Coach Operations gets the coaches.
 * Everything is computed from what the server already decided this person may
 * see, so the scope rules stay the single authority on that.
 */
export function WeeklyProgress({ data, onStudent }: { data: Row; onStudent: (id: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const user = data.user || { roles: [] };
  const operations = can(user.roles, ["Project Operations", "Operations Systems / Admin", "Higher Board"]);
  const coachOperations = can(user.roles, ["Coach Operations"]);
  const supervises = can(user.roles, ["Team Supervisor"]);
  const leader = operations || coachOperations;
  // Coach Operations follows every student, group and coach, but a coordinator
  // or supervisor is a name on a group to them, never a row of performance.
  const coachesOnly = coachOperations && !operations && !supervises;
  // Anyone who is not above a team is reading their own week.
  const ownWeek = !operations && !coachOperations && !supervises;
  // Each group meets on one standing Teams or LMS link, from the calendar.
  const links = new Map<string, string>(
    (data.groups || []).filter((g: Row) => g.session_link).map((g: Row) => [g.id, g.session_link]),
  );
  const [offset, setOffset] = useState(0);
  const [supervisor, setSupervisor] = useState("All");
  const [coordinator, setCoordinator] = useState("All");
  const [track, setTrack] = useState("All");
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
  const clock = (value: string) =>
    new Date(value).toLocaleTimeString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Cairo",
    });

  // Derived on render rather than memoised: the React compiler optimises this
  // for us, and one pass over a few thousand rows costs less than the hooks it
  // would take to cache it.
  const view = (() => {
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
    const coachRows: Row[] = data.groupCoaches || [];
    const now = new Date().toISOString();

    const inScopeGroups = groups.filter(
      (g) =>
        g.status === "Active" &&
        (supervisor === "All" || g.supervisor === supervisor) &&
        (coordinator === "All" || g.coordinator === coordinator) &&
        (track === "All" || g.track === track),
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

    /** One row per person, measured over the groups they are responsible for. */
    const rollUp = (people: Row[], groupsOf: (person: Row) => Row[]) =>
      people
        .map((person) => {
          const theirs = groupsOf(person);
          const gids = new Set(theirs.map((g) => g.id));
          const list = scopedStudents.filter((s) => gids.has(s.group_id));
          return {
            id: person.id,
            name: person.name,
            title: person.title || "",
            groups: theirs.map((g) => g.id),
            list,
            ...measure(list, gids, [person.id]),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    const coordinators = rollUp(
      staff.filter((u) => inScopeGroups.some((g) => g.coordinator === u.id)),
      (person) => inScopeGroups.filter((g) => g.coordinator === person.id),
    );
    const supervisors = rollUp(
      staff.filter((u) => inScopeGroups.some((g) => g.supervisor === u.id)),
      (person) => inScopeGroups.filter((g) => g.supervisor === person.id),
    );
    // A coach reaches a group either as its named coach or through a live
    // functional assignment, and both count as their week.
    const coachGroups = (person: Row) =>
      inScopeGroups.filter(
        (g) =>
          g.coach === person.id ||
          coachRows.some((c) => c.group_id === g.id && c.user_id === person.id && c.status === "Active"),
      );
    const coaches = rollUp(
      staff.filter((u) => roleList(u).includes("Coach") && coachGroups(u).length > 0),
      coachGroups,
    ).map((coach) => ({
      ...coach,
      ownSessions: sessions.filter((s) => s.coach_id === coach.id || coach.groups.includes(s.group_id)),
    }));

    const schedule = sessions
      .filter((s) => groupIds.has(s.group_id))
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    const mine = scopedStudents.filter((s) => s.coordinator === user.id);
    const totals = measure(scopedStudents, groupIds, coordinators.map((c) => c.id));
    return {
      coordinators,
      supervisors,
      coaches,
      schedule,
      mine,
      totals,
      contactedBy,
      attendanceBy,
      linksBy,
      sessionsInWeek: sessions,
      supervisorOptions: staff.filter((u) => groups.some((g) => g.status === "Active" && g.supervisor === u.id)),
      coordinatorOptions: staff.filter((u) => groups.some((g) => g.status === "Active" && g.coordinator === u.id)),
      trackOptions: [...new Set(groups.filter((g) => g.status === "Active").map((g) => g.track).filter(Boolean))].sort(),
    };
  })();

  const { totals } = view;
  const stats = [
    { label: "Students contacted", value: `${totals.contacted} / ${totals.students}`, detail: pct(totals.contacted, totals.students) },
    { label: "Sessions this week", value: `${totals.held} / ${totals.sessions}`, detail: t("held of scheduled") },
    { label: "Attendance", value: totals.attendance, detail: t("of recorded attendance") },
    { label: "Service links", value: String(totals.submitted), detail: t("{v0} links approved", { v0: totals.locked }) },
    { label: "Services recorded", value: String(totals.evidence), detail: t("{v0} overdue actions now", { v0: totals.overdue }) },
  ];
  const filtered = supervisor !== "All" || coordinator !== "All" || track !== "All";

  const peopleTable = (
    heading: string,
    first: string,
    rows: Row[],
    detail: (row: Row) => React.ReactNode,
    empty: [string, string],
  ) => (
    <section className="panel" key={heading}>
      <div className="panel-heading">
        <h2>{t(heading)}</h2>
        <span className="count">{rows.length}</span>
      </div>
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              {[first, "Groups", "Students", "Contacted", "Sessions held", "Attendance", "Links submitted", "Links approved", "Services", "Overdue", "At risk"].map((h) => (
                <TableHead key={h}>{t(h)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
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
                    <TableCell colSpan={11}>{detail(c)}</TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="empty">
          <h3>{t(empty[0])}</h3>
          <p>{t(empty[1])}</p>
        </div>
      )}
    </section>
  );

  const studentsOf = (rows: Row[]) => (
    <StudentWeek
      students={rows}
      contactedBy={view.contactedBy}
      attendanceBy={view.attendanceBy}
      linksBy={view.linksBy}
      sessions={view.sessionsInWeek}
      onStudent={onStudent}
    />
  );

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
          {leader && view.supervisorOptions.length > 0 && (
            <SearchableSelect className="weekly-filter" label={t("Supervisor")} value={supervisor} onChange={setSupervisor} options={[{ value: "All", label: t("All supervisors") }, ...view.supervisorOptions.map((s: Row) => ({ value: s.id, label: s.name }))]} />
          )}
          {!ownWeek && !coachesOnly && view.coordinatorOptions.length > 1 && (
            <SearchableSelect className="weekly-filter" label={t("Coordinator")} value={coordinator} onChange={setCoordinator} options={[{ value: "All", label: t("Every coordinator") }, ...view.coordinatorOptions.map((s: Row) => ({ value: s.id, label: s.name }))]} />
          )}
          {view.trackOptions.length > 1 && (
            <SearchableSelect className="weekly-filter" label={t("Track")} value={track} onChange={setTrack} options={[{ value: "All", label: t("Every track") }, ...view.trackOptions.map((name: string) => ({ value: name, label: name }))]} />
          )}
          {filtered && (
            <button
              className="small-btn"
              onClick={() => {
                setSupervisor("All");
                setCoordinator("All");
                setTrack("All");
              }}
            >
              {t("Clear filters")}
            </button>
          )}
        </div>
      </div>
      <p className="footnote weekly-note">
        {ownWeek
          ? t("The programme week runs Friday to Thursday, Cairo time. This is your own week: your students and your sessions.")
          : t("The programme week runs Friday to Thursday, Cairo time. Figures cover active students in the groups you can see.")}
      </p>

      <div className="stats weekly-stats">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <span>{t(s.label)}</span>
            <strong>{s.value}</strong>
            <small>{s.detail}</small>
          </div>
        ))}
      </div>

      {operations &&
        peopleTable("Supervisors this week", "Supervisor", view.supervisors, (s) => studentsOf(s.list), [
          "No supervisors in this view",
          "Supervisors appear here once they hold an active group.",
        ])}

      {!ownWeek &&
        !coachesOnly &&
        peopleTable("Coordinators this week", "Coordinator", view.coordinators, (c) => studentsOf(c.list), [
          "No coordinators in this view",
          "Coordinators appear here once they are assigned to groups you supervise.",
        ])}

      {(coachOperations || operations) &&
        peopleTable("Coaches this week", "Coach", view.coaches, (c) => <SessionWeek sessions={c.ownSessions} clock={clock} label={label} links={links} />, [
          "No coaches in this view",
          "Coaches appear here once they are assigned to a group.",
        ])}

      {ownWeek && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{t("My students this week")}</h2>
            <span className="count">{view.mine.length || view.totals.students}</span>
          </div>
          {view.totals.students ? (
            studentsOf(view.mine.length ? view.mine : view.coordinators.flatMap((c: Row) => c.list))
          ) : (
            <div className="empty">
              <h3>{t("No active students in this week")}</h3>
              <p>{t("Students appear here once a group you coordinate is active.")}</p>
            </div>
          )}
        </section>
      )}

      {(ownWeek || supervises) && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{t("My schedule this week")}</h2>
            <span className="count">{view.schedule.length}</span>
          </div>
          {view.schedule.length ? (
            <SessionWeek sessions={view.schedule} clock={clock} label={label} links={links} />
          ) : (
            <div className="empty">
              <h3>{t("Nothing scheduled this week")}</h3>
              <p>{t("Sessions appear here as soon as they are on the calendar for your groups.")}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** The week's timetable: what is on, for whom, and whether it happened. */
function SessionWeek({
  sessions,
  clock,
  label,
  links,
}: {
  sessions: Row[];
  clock: (value: string) => string;
  label: (day: string) => string;
  links: Map<string, string>;
}) {
  const t = useT();
  return (
    <div className="weekly-students">
      <Table>
        <TableHeader>
          <TableRow>
            {["Day", "Time", "Group", "Session", "Week", "State", "Link"].map((h) => (
              <TableHead key={h}>{t(h)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{label(s.session_day)}</TableCell>
              <TableCell>{clock(s.starts_at)}</TableCell>
              <TableCell>{s.group_id}</TableCell>
              <TableCell>
                {s.title}
                <small className="table-subline">{t("{v0} minutes", { v0: s.duration_minutes })}</small>
              </TableCell>
              <TableCell>{t("Week {v0}", { v0: s.week })}</TableCell>
              <TableCell>
                <span
                  className={
                    "badge " +
                    (s.status === "Completed" ? "green" : s.status === "Confirmed" ? "neutral" : "amber")
                  }
                >
                  {t(s.status)}
                </span>
              </TableCell>
              <TableCell>
                {links.get(s.group_id) ? (
                  <a className="text-link" href={links.get(s.group_id)} target="_blank" rel="noreferrer">
                    {t("Join")}
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
                  {links.length ? t("{v0} of 3 approved", { v0: locked }) : t("Not submitted")}
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
