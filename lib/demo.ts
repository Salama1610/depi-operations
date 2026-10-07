// The demo workspace: one sign-in per role, two groups of made-up students and
// a session that is always under way, so anyone can try every screen —
// attendance included — without waiting for a real session or touching a real
// record.
//
// Everything demo carries the DEMO- prefix: the people, the groups, the
// students, the sessions, and every row hanging off them is named after its
// parent (DEMO-G1-W1-ATT-1), clear of the pilot seed's own DEMO- rows. A demo
// sign-in sees only demo groups and demo colleagues, and nobody else ever sees
// them. Refreshing puts the demo back to the state below, timed around the
// moment of the refresh.
//
// No imports from the server here: the refresh script runs this file directly.

export const DEMO_PREFIX = "DEMO-";

/** Every demo sign-in uses this password. It is shared on purpose. */
export const DEMO_PASSWORD = "DepiDemo-2026";

export const isDemo = (u: { id?: string } | null | undefined) => String(u?.id || "").startsWith(DEMO_PREFIX);

/** SQL keeping a query on the caller's side of the demo line. */
export const sameSide = (u: { id?: string } | null | undefined, column: string) =>
  isDemo(u) ? `${column} LIKE 'DEMO-%'` : `${column} NOT LIKE 'DEMO-%'`;

export type DemoPerson = { id: string; email: string; name: string; roles: string[]; title: string; team: string | null };

export const demoPeople: DemoPerson[] = [
  { id: "DEMO-PO", email: "demo.projectops@example.com", name: "Demo Project Operations", roles: ["Project Operations"], title: "Project Operations", team: null },
  { id: "DEMO-HB", email: "demo.board@example.com", name: "Demo Higher Board", roles: ["Higher Board"], title: "Higher Board", team: null },
  { id: "DEMO-COACHOPS", email: "demo.coachops@example.com", name: "Demo Coach Operations", roles: ["Coach Operations"], title: "Coach Operations", team: null },
  { id: "DEMO-SUP", email: "demo.supervisor@example.com", name: "Demo Supervisor", roles: ["Team Supervisor"], title: "Team Supervisor · Service Team", team: "Service Team" },
  { id: "DEMO-COORD", email: "demo.coordinator@example.com", name: "Demo Coordinator", roles: ["Operations Coordinator"], title: "Operations Coordinator", team: "Service Team" },
  { id: "DEMO-COACH", email: "demo.coach@example.com", name: "Demo Coach", roles: ["Coach"], title: "Coach", team: null },
  { id: "DEMO-COACH2", email: "demo.coach2@example.com", name: "Demo Second Coach", roles: ["Coach"], title: "Coach", team: null },
  { id: "DEMO-QCL", email: "demo.qclead@example.com", name: "Demo Quality Lead", roles: ["Quality Lead"], title: "Quality Lead", team: null },
  { id: "DEMO-QC", email: "demo.qc@example.com", name: "Demo Quality Reviewer", roles: ["Quality Member"], title: "Quality Member", team: null },
];

/** The demo student who signs in to the student page. */
export const demoStudentEmail = "demo.student@example.com";

type Statement = [string, ...unknown[]];

const names = [
  "Demo Student", "Mariam Adel", "Omar Khaled", "Nour Hassan", "Youssef Samir", "Salma Fathy", "Karim Mostafa", "Hana Tarek",
  "Ahmed Nabil", "Laila Sherif", "Mostafa Ali", "Rana Magdy", "Tamer Wael",
];

/**
 * The statements that put the demo back to its starting state, timed around
 * `nowMs`. They only ever touch DEMO- rows, and each one stands alone, so a
 * statement the database refuses (a reviewed link is kept for the record)
 * does not stop the rest.
 */
export function demoPlan(nowMs: number): Statement[] {
  const iso = (ms: number) => new Date(ms).toISOString();
  const day = 86400000;
  const hour = 3600000;
  const fiveMinutes = 300000;
  const now = Math.floor(nowMs / fiveMinutes) * fiveMinutes;
  const plan: Statement[] = [];

  // Start clean: what the demo users did since the last refresh.
  for (const table of ["attendance", "session_checks", "session_feedback"])
    plan.push([`DELETE FROM ${table} WHERE session_id LIKE 'DEMO-%'`]);
  plan.push(["DELETE FROM sessions WHERE group_id LIKE 'DEMO-%'"]);
  plan.push(["DELETE FROM tasks WHERE student_id LIKE 'DEMO-%'"]);
  plan.push(["DELETE FROM case_events WHERE case_id IN (SELECT id FROM cases WHERE student_id LIKE 'DEMO-%' OR group_id LIKE 'DEMO-%')"]);
  plan.push(["DELETE FROM cases WHERE student_id LIKE 'DEMO-%' OR group_id LIKE 'DEMO-%'"]);
  plan.push(["DELETE FROM notifications WHERE recipient LIKE 'DEMO-%'"]);
  plan.push(["DELETE FROM service_links WHERE student_id LIKE 'DEMO-%' AND id NOT IN (SELECT service_link_id FROM service_link_reviews)"]);

  for (const p of demoPeople)
    plan.push([
      "INSERT INTO users(id,email,name,roles,scopes,active,title,team) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,roles=excluded.roles,scopes=excluded.scopes,active=excluded.active,title=excluded.title,team=excluded.team",
      p.id, p.email, p.name, JSON.stringify(p.roles), JSON.stringify(["demo"]), 1, p.title, p.team,
    ]);

  const groups = [
    { id: "DEMO-G1", track: "Software Development", coach: "DEMO-COACH", start: iso(now - 10 * day).slice(0, 10), students: [1, 2, 3, 4, 5, 6, 7, 8] },
    { id: "DEMO-G2", track: "Data Analytics", coach: "DEMO-COACH2", start: iso(now + 3 * day).slice(0, 10), students: [9, 10, 11, 12, 13] },
  ];
  for (const g of groups) {
    plan.push([
      "INSERT INTO groups(id,name,track,provider,coordinator,supervisor,coach,pathway,delivery_model,start_date,status,policy_id,session_link) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET track=excluded.track,coordinator=excluded.coordinator,supervisor=excluded.supervisor,coach=excluded.coach,start_date=excluded.start_date,status=excluded.status,policy_id=excluded.policy_id,session_link=excluded.session_link",
      g.id, g.id.replace("DEMO-", "Demo group "), g.track, "YAT", "DEMO-COORD", "DEMO-SUP", g.coach, "Outcome", "Regular", g.start, "Active", "R5-v1", "https://teams.microsoft.com/",
    ]);
    for (const n of g.students) {
      const id = `DEMO-S${String(n).padStart(2, "0")}`;
      plan.push([
        "INSERT INTO students(id,tp_id,name,group_id,email,phone,student_type,source_status,lifecycle,engagement,coaching,milestone,last_contact,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,group_id=excluded.group_id,email=excluded.email,lifecycle=excluded.lifecycle,engagement=excluded.engagement,coaching=excluded.coaching,milestone=excluded.milestone,last_contact=excluded.last_contact,created_at=excluded.created_at",
        id, id, names[n - 1], g.id, n === 1 ? demoStudentEmail : null, `0100000${String(n).padStart(4, "0")}`, "Student", "ACTIVE", "Active", "Active", "In Progress", 0,
        n % 3 === 0 ? null : iso(now - 2 * day), iso(now - 12 * day),
      ]);
    }
  }

  // Group 1: last week's session is over and recorded; this week's started
  // half an hour ago and is waiting for its attendance; the rest are ahead.
  // Group 2 starts later today, not yet confirmed. A coach takes one session
  // a day, so each group has its own.
  const sessionRows = [
    ...Array.from({ length: 8 }, (_, i) => ({ group: "DEMO-G1", week: i + 1, at: now - 30 * 60000 + (i - 1) * 7 * day, confirmed: i <= 1 })),
    ...Array.from({ length: 8 }, (_, i) => ({ group: "DEMO-G2", week: i + 1, at: now + 3 * hour + i * 7 * day, confirmed: false })),
  ];
  for (const s of sessionRows)
    plan.push([
      "INSERT INTO sessions(id,group_id,coach_id,coordinator_id,title,starts_at,session_day,duration_minutes,status,week,confirmed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      `${s.group}-W${s.week}`, s.group, s.group === "DEMO-G1" ? "DEMO-COACH" : "DEMO-COACH2", "DEMO-COORD", `Session ${s.week} of 8`, iso(s.at), iso(s.at).slice(0, 10), 180, "Scheduled", s.week,
      s.confirmed ? iso(s.at - 2 * day) : null, iso(now),
    ]);

  // Last week's register, checklist and feedback.
  const lastWeek = "DEMO-G1-W1";
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8])
    plan.push([
      "INSERT INTO attendance(id,session_id,student_id,status,recorder,source,updated_at) VALUES(?,?,?,?,?,?,?)",
      `${lastWeek}-ATT-${n}`, lastWeek, `DEMO-S0${n}`, n >= 7 ? "Absent" : "Present", "DEMO-COORD", "Session register", iso(now - 7 * day + 3 * hour),
    ]);
  for (const [session, item, at] of [
    [lastWeek, "instructor_confirmed", now - 8 * day],
    [lastWeek, "instructor_entered", now - 7 * day],
    ["DEMO-G1-W2", "instructor_confirmed", now - day],
  ] as [string, string, number][])
    plan.push([
      "INSERT INTO session_checks(id,session_id,item,done_by,done_at) VALUES(?,?,?,?,?)",
      `${session}-CHK-${item}`, session, item, "DEMO-COORD", iso(at),
    ]);
  for (const [n, satisfaction, clarity, usefulness, searched, liked, comments] of [
    [1, 5, 5, 4, 1, "The live examples", "More practice time please"],
    [2, 4, 3, 4, 0, "Clear steps", "The pace was fast"],
    [3, 3, 4, 3, 1, null, "Audio cut out twice"],
  ] as [number, number, number, number, number, string | null, string][])
    plan.push([
      "INSERT INTO session_feedback(id,session_id,student_id,satisfaction,clarity,searched_gig,usefulness,liked,comments,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      `${lastWeek}-SFB-${n}`, lastWeek, `DEMO-S0${n}`, satisfaction, clarity, searched, usefulness, liked, comments, iso(now - 7 * day + 4 * hour),
    ]);

  // Services in every state the quality team meets.
  const links: [string, number, string, string, string | null][] = [
    ["DEMO-S01", 1, "Kafiil", "Pending", null],
    ["DEMO-S01", 2, "Nafezly", "Pending", null],
    ["DEMO-S01", 3, "Kafiil", "Pending", null],
    ["DEMO-S02", 1, "Kafiil", "Locked", null],
    ["DEMO-S02", 2, "Nafezly", "Needs Correction", "The service title does not match the track. Rename it and resubmit."],
    ["DEMO-S03", 1, "Kafiil", "Locked", null],
    ["DEMO-S03", 2, "Nafezly", "Locked", null],
    ["DEMO-S03", 3, "Kafiil", "Locked", null],
    ["DEMO-S04", 1, "Nafezly", "Pending", null],
  ];
  for (const [studentId, slot, platform, status, comment] of links) {
    const number = 900000 + Number(studentId.slice(-2)) * 10 + slot;
    const url = platform === "Kafiil" ? `https://kafiil.com/service/${number}-demo-service` : `https://nafezly.com/services/${number}-demo-service`;
    const decided = status !== "Pending";
    plan.push([
      "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,account_id,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,normalized_url=excluded.normalized_url,platform=excluded.platform,qc_status=excluded.qc_status,qc_comment=excluded.qc_comment,qc_actor=excluded.qc_actor,qc_at=excluded.qc_at,revision=excluded.revision,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at",
      `${studentId}-LNK-${slot}`, studentId, slot, url, url, platform, "Needs Review",
      JSON.stringify({ status: "Needs Review", platform, message: "Demo link. Format verified.", checks: ["Secure HTTPS link", `${platform} is accepted`] }),
      iso(now - 2 * day), status, comment, "DEMO-QC", decided ? iso(now - day) : null, 1, null, iso(now - 2 * day), iso(now - (decided ? day : 2 * day)),
    ]);
  }
  for (const [studentId, status] of [["DEMO-S01", "Pending QC"], ["DEMO-S02", "Needs Correction"], ["DEMO-S03", "Complete"], ["DEMO-S04", "In Progress"]])
    plan.push([
      "INSERT INTO service_submissions(id,student_id,status,submitted_at,updated_at,qc_completed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET status=excluded.status,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,qc_completed_at=excluded.qc_completed_at",
      `${studentId}-SUB`, studentId, status, iso(now - 2 * day), iso(now - day), status === "Complete" ? iso(now - day) : null,
    ]);

  // Follow-ups waiting for the coordinator.
  for (const [n, title, due] of [
    [5, "Call about last week's absence", now + 4 * hour],
    [7, "Welcome call: first contact", now - hour],
  ] as [number, string, number][])
    plan.push([
      "INSERT INTO tasks(id,student_id,title,owner,due,category,priority,status,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      `DEMO-S0${n}-TSK`, `DEMO-S0${n}`, title, "DEMO-COORD", iso(due), "Contact", "High", "Open", `demo:${n}`, iso(now - day),
    ]);

  return plan;
}
