import { env } from "cloudflare:workers";
import { getSupabaseUser } from "./supabase/server";
import {
  ensure,
  can,
  roles,
  policy,
  graduation,
  risk,
  expectedMilestone,
} from "./domain/rules";
export function db() {
  ensure(env.DB, "The database is unavailable. Please try again shortly.");
  return env.DB;
}
export function bucket() {
  ensure(
    env.BUCKET,
    "File storage is unavailable. Your changes have not been saved.",
  );
  return env.BUCKET;
}
export const now = () => new Date().toISOString();
export const uid = (p = "EV") => p + "-" + crypto.randomUUID();
export const stmt = (sql: string, ...args: any[]) =>
  db()
    .prepare(sql)
    .bind(...args);
export async function all(sql: string, ...args: any[]) {
  return (await stmt(sql, ...args).all()).results as any[];
}
export async function rateLimit(
  subject: string,
  limit = 120,
  windowSeconds = 60,
) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000)),
    id = `${subject}:${bucket}`,
    expires = new Date((bucket + 2) * windowSeconds * 1000).toISOString();
  await stmt(
    "INSERT INTO rate_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1",
    id,
    expires,
  ).run();
  const row: any = await stmt(
    "SELECT count FROM rate_limits WHERE id=?",
    id,
  ).first();
  ensure(
    row && row.count <= limit,
    "Too many requests. Wait a moment and try again.",
  );
  if (Math.random() < 0.02)
    await stmt("DELETE FROM rate_limits WHERE expires_at<?", now()).run();
}
export async function identity() {
  const user = await getSupabaseUser();
  ensure(user?.id && user.email, "Sign in with your DEPI account to continue.");
  const email = user.email.trim().toLowerCase();
  const name =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim()) ||
    email;
  return { id: user.id, email, name };
}
export async function actor() {
  const i = await identity();
  const u: any = await stmt(
    "SELECT * FROM users WHERE (id=? OR email=?) AND active=1",
    i.id,
    i.email,
  ).first();
  ensure(
    u,
    "Your account has not been added to this staff workspace. Ask an administrator for access.",
  );
  return { ...u, roles: JSON.parse(u.roles), scopes: JSON.parse(u.scopes) };
}
export async function studentByIdentity(i: { id: string; email: string }) {
  const byId = i.id
    ? await stmt("SELECT s.*,g.track,g.provider,g.pathway,g.status group_status FROM students s JOIN groups g ON g.id=s.group_id WHERE s.id=?", i.id).first()
    : null;
  if (byId || !i.email) return byId as any;
  return (await stmt(
    "SELECT s.*,g.track,g.provider,g.pathway,g.status group_status FROM students s JOIN groups g ON g.id=s.group_id WHERE s.email IS NOT NULL AND trim(s.email)<>'' AND lower(s.email)=?",
    i.email,
  ).first()) as any;
}
export async function currentStudent() {
  const i = await identity();
  const s: any = await studentByIdentity(i);
  ensure(
    s,
    "Your account has not been linked to a student record yet. Ask the program team to verify your email.",
  );
  ensure(
    !["Removed", "Withdrawn", "Graduate Closed", "Non-Graduate Closed"].includes(
      s.lifecycle,
    ),
    "This student record is closed and can no longer be updated.",
  );
  return { ...s, identity: i };
}
export function permit(u: any, allowed: string[]) {
  ensure(can(u.roles, allowed), "Your staff role does not permit this action.");
}
export function scopeSql(u: any, alias = "g") {
  if (
    can(u.roles, [
      "Project Operations",
      "Operations Systems / Admin",
      "Quality Member",
      "Quality Lead",
      "Higher Board",
      "Coach Operations",
    ])
  )
    return { sql: "1=1", args: [] };
  return {
    sql: `(${alias}.coordinator=? OR ${alias}.supervisor=? OR ${alias}.coach=? OR EXISTS (SELECT 1 FROM group_coaches gc WHERE gc.group_id=${alias}.id AND gc.user_id=? AND gc.status='Active'))`,
    args: [u.id, u.id, u.id, u.id],
  };
}
export async function student(u: any, id: string) {
  const q = scopeSql(u);
  const s: any = await stmt(
    `SELECT s.*,g.track,g.coordinator,g.supervisor,g.coach,g.policy_id,g.status group_status FROM students s JOIN groups g ON g.id=s.group_id WHERE s.id=? AND ${q.sql}`,
    id,
    ...q.args,
  ).first();
  ensure(s, "Student not found within your assigned scope.");
  return s;
}
export async function proof(u: any, id: string, sid: string) {
  const a: any = await stmt(
    "SELECT * FROM attachments WHERE id=? AND student_id=?",
    id,
    sid,
  ).first();
  ensure(a, "Upload proof linked to this student first.");
  await student(u, sid);
  return a;
}
export function auditStmt(
  u: any,
  action: string,
  entity: string,
  value: any,
  previous: any = null,
  requestId = uid("REQ"),
  reason: string | null = null,
) {
  return stmt(
    "INSERT INTO audit_events(id,actor,action,entity_id,previous,value,reason,request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    uid(),
    u.id,
    action,
    entity,
    previous ? JSON.stringify(previous) : null,
    JSON.stringify(value),
    reason,
    requestId,
    now(),
  );
}
export async function recalc(sid: string) {
  const s: any = await stmt(
    "SELECT g.policy_id,p.config FROM students s JOIN groups g ON g.id=s.group_id JOIN policies p ON p.id=g.policy_id WHERE s.id=?",
    sid,
  ).first();
  const e = await all(
    "SELECT e.id,e.status,g.status gig_status,g.value,g.currency,x.usd_value FROM evidence e JOIN gigs g ON g.id=e.gig_id LEFT JOIN gig_fx_applications x ON x.gig_id=g.id WHERE e.student_id=?",
    sid,
  );
  const result = graduation(e, JSON.parse(s.config));
  await stmt(
    "INSERT INTO graduation_ledger VALUES(?,?,?,?,?,?)",
    uid("GR"),
    sid,
    s.policy_id,
    result,
    JSON.stringify(e.filter((x) => x.status === "Accepted").map((x) => x.id)),
    now(),
  ).run();
  return result;
}
export async function loadData(u: any) {
  const q = scopeSql(u);
  const groups = await all(
    `SELECT g.*,c.name coordinator_name,s.name supervisor_name,h.name coach_name FROM groups g JOIN users c ON c.id=g.coordinator JOIN users s ON s.id=g.supervisor JOIN users h ON h.id=g.coach WHERE ${q.sql}`,
    ...q.args,
  );
  const students = await all(
    `SELECT s.*,g.track,g.provider,g.pathway,g.start_date,g.policy_id,g.coordinator,g.supervisor,g.coach,c.name coordinator_name FROM students s JOIN groups g ON g.id=s.group_id JOIN users c ON c.id=g.coordinator WHERE ${q.sql}`,
    ...q.args,
  );
  const scoped = (table: string) =>
    all(
      `SELECT t.* FROM ${table} t JOIN students s ON s.id=t.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql}`,
      ...q.args,
    );
  const [
    tasks,
    contacts,
    gigs,
    evidence,
    attachments,
    requests,
    attendance,
    cases,
  ] = await Promise.all(
    [
      "tasks",
      "contacts",
      "gigs",
      "evidence",
      "attachments",
      "account_requests",
      "attendance",
    ]
      .map(scoped)
      .concat([
        all(
          `SELECT t.* FROM cases t LEFT JOIN students s ON s.id=t.student_id LEFT JOIN groups g ON g.id=s.group_id WHERE t.student_id IS NULL OR ${q.sql}`,
          ...q.args,
        ),
      ]),
  );
  const [reviews, sessions, groupCoaches, p, fxApplications] = await Promise.all([
    all(
      `SELECT r.* FROM evidence_reviews r JOIN evidence e ON e.id=r.evidence_id JOIN students s ON s.id=e.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql}`,
      ...q.args,
    ),
    all(
      `SELECT t.* FROM sessions t JOIN groups g ON g.id=t.group_id WHERE ${q.sql}`,
      ...q.args,
    ),
    all(
      `SELECT x.*,u.name coach_name FROM group_coaches x JOIN users u ON u.id=x.user_id JOIN groups g ON g.id=x.group_id WHERE ${q.sql} ORDER BY x.assigned_at DESC`,
      ...q.args,
    ),
    all("SELECT * FROM policies"),
    all(
      `SELECT x.* FROM gig_fx_applications x JOIN gigs z ON z.id=x.gig_id JOIN students s ON s.id=z.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql}`,
      ...q.args,
    ),
  ]);
  const serviceLinks = can(u.roles, [
    "Quality Member",
    "Quality Lead",
    "Project Operations",
  ])
    ? await all(
        `SELECT l.*,s.name student_name,s.email student_email,s.group_id,g.track,g.coordinator,
                ss.status submission_status,ss.submitted_at submission_submitted_at,
                ss.qc_completed_at,u.name reviewer_name,
                (SELECT count(*) FROM service_link_reviews r WHERE r.service_link_id=l.id) correction_count
         FROM service_links l
         JOIN students s ON s.id=l.student_id
         JOIN groups g ON g.id=s.group_id
         LEFT JOIN service_submissions ss ON ss.student_id=l.student_id
         LEFT JOIN users u ON u.id=l.qc_actor
         WHERE ${q.sql}
         ORDER BY CASE WHEN l.qc_status='Needs Correction' THEN 0 WHEN l.qc_status='Pending' THEN 1 ELSE 2 END,l.updated_at ASC`,
        ...q.args,
      )
    : [];
  const serviceLinkReviews = serviceLinks.length
    ? await all(
        `SELECT r.*,l.student_id,l.slot,u.name reviewer_name
         FROM service_link_reviews r
         JOIN service_links l ON l.id=r.service_link_id
         JOIN students s ON s.id=l.student_id
         JOIN groups g ON g.id=s.group_id
         JOIN users u ON u.id=r.reviewed_by
         WHERE ${q.sql}
         ORDER BY r.reviewed_at DESC LIMIT 2000`,
        ...q.args,
      )
    : [];
  const policyMap = Object.fromEntries(
    p.map((p) => [p.id, JSON.parse(p.config)]),
  );
  for (const e of evidence) e.applied_policy = policyMap[e.policy_id];
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const gigMap = new Map(gigs.map((g) => [g.id, g]));
  const fxMap = new Map(fxApplications.map((x) => [x.gig_id, x]));
  const bucket = (rows: any[], key: string) => {
    const out = new Map<string, any[]>();
    for (const row of rows) {
      const id = row[key];
      if (!id) continue;
      const values = out.get(id) || [];
      values.push(row);
      out.set(id, values);
    }
    return out;
  };
  const attendanceByStudent = bucket(attendance, "student_id");
  const evidenceByStudent = bucket(evidence, "student_id");
  const contactsByStudent = bucket(contacts, "student_id");
  const openTasksByStudent = bucket(
    tasks
      .filter((task) => task.status === "Open")
      .sort((a, b) => a.due.localeCompare(b.due)),
    "student_id",
  );
  const studentsByGroup = bucket(students, "group_id");
  for (const s of students) {
    const group = groupMap.get(s.group_id);
    s.policy = policyMap[group.policy_id];
    s.contact_due =
      s.lifecycle === "Active" &&
      (!s.last_contact ||
        Date.now() - Date.parse(s.last_contact) >
          s.policy.contactDays * 86400000);
    s.week = Math.max(
      0,
      Math.min(
        8,
        Math.floor((Date.now() - Date.parse(s.start_date)) / 604800000) + 1,
      ),
    );
    const a = (attendanceByStudent.get(s.id) || []).filter(
      (record) => record.status !== "Excused",
    );
    s.attendance = a.length
      ? Math.round(
          (100 *
            a.filter((a) => ["Present", "Late"].includes(a.status)).length) /
            a.length,
        )
      : null;
    const studentEvidence = evidenceByStudent.get(s.id) || [];
    s.graduation = graduation(
      studentEvidence.map((e) => {
        const gig = gigMap.get(e.gig_id);
        return {
          ...e,
          gig_status: gig?.status,
          value: gig?.value,
          currency: gig?.currency,
          usd_value: fxMap.get(e.gig_id)?.usd_value,
        };
      }),
      policyMap[group.policy_id],
    );
    const failed = (contactsByStudent.get(s.id) || []).filter(
      (c) =>
        c.outcome === "No Response" &&
        Date.now() - Date.parse(c.occurred_at) <=
          s.policy.failedWindowDays * 86400000,
    ).length;
    s.risk = risk(
      s,
      s.week,
      s.attendance,
      failed,
      Math.max(0, ...studentEvidence.map((e) => e.rejections)),
      policyMap[group.policy_id],
    );
    s.next_task = openTasksByStudent.get(s.id)?.[0] || null;
  }
  for (const g of groups) {
    const ss = studentsByGroup.get(g.id) || [],
      cfg = policyMap[g.policy_id] || policy;
    g.week =
      ss[0]?.week ??
      Math.max(
        0,
        Math.min(
          8,
          Math.floor((Date.now() - Date.parse(g.start_date)) / 604800000) + 1,
        ),
      );
    g.expected_milestone = expectedMilestone(g.week, cfg);
    g.average_milestone = ss.length
      ? Math.round((ss.reduce((n, s) => n + s.milestone, 0) / ss.length) * 10) /
        10
      : 0;
    const lag = g.expected_milestone - g.average_milestone;
    g.trajectory =
      lag >= cfg.journeyCriticalLag
        ? "Critical"
        : lag >= cfg.journeyDelayedLag
          ? "Delayed"
          : lag < 0
            ? "Ahead"
            : "On Track";
    g.trajectory_reason =
      lag > 0
        ? `${lag.toFixed(1)} milestones behind the Week ${g.week} expectation`
        : lag < 0
          ? `${Math.abs(lag).toFixed(1)} milestones ahead of expectation`
          : `At the Week ${g.week} expected milestone`;
  }
  const broad = can(u.roles, [
    "Project Operations",
    "Operations Systems / Admin",
  ]);
  const logs = broad
    ? await all("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 200")
    : await all(
        "SELECT * FROM audit_events WHERE actor=? ORDER BY created_at DESC LIMIT 100",
        u.id,
      );
  const initialized: any = await stmt(
    "SELECT value FROM audit_events WHERE action IN ('Workspace initialized with 1,000 synthetic students','Blank production workspace initialized') ORDER BY CASE WHEN action='Workspace initialized with 1,000 synthetic students' THEN 0 ELSE 1 END,created_at DESC LIMIT 1",
  ).first();
  let workspaceMode = "production";
  try {
    workspaceMode = JSON.parse(initialized?.value || "{}").synthetic
      ? "demo"
      : "production";
  } catch {}
  const [
    tracks,
    taskBank,
    savedViews,
    gates,
    statusEvents,
    caseEvents,
    attachmentContexts,
    fxRates,
    reservations,
    creditLedger,
    evidencePackages,
    evidencePackageItems,
  ] = await Promise.all([
    all("SELECT * FROM tracks WHERE active=1 ORDER BY name"),
    all("SELECT * FROM task_bank WHERE active=1 ORDER BY track,title"),
    all(
      "SELECT * FROM saved_views WHERE user_id=? ORDER BY created_at DESC",
      u.id,
    ),
    all(
      `SELECT x.* FROM group_gate_checks x JOIN groups g ON g.id=x.group_id WHERE ${q.sql}`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM student_status_events x JOIN students s ON s.id=x.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} ORDER BY x.created_at DESC LIMIT 500`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM case_events x JOIN cases c ON c.id=x.case_id LEFT JOIN students s ON s.id=c.student_id LEFT JOIN groups g ON g.id=s.group_id WHERE c.student_id IS NULL OR ${q.sql} ORDER BY x.created_at DESC LIMIT 500`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM attachment_context x JOIN groups g ON g.id=x.group_id WHERE ${q.sql}`,
      ...q.args,
    ),
    can(u.roles, [
      "Project Operations",
      "Operations Systems / Admin",
      "Quality Lead",
    ])
      ? all("SELECT * FROM fx_rates ORDER BY effective_date DESC")
      : Promise.resolve([]),
    can(u.roles, [
      "Higher Board",
      "Project Operations",
      "Operations Systems / Admin",
    ])
      ? all("SELECT * FROM account_reservations ORDER BY created_at DESC")
      : Promise.resolve([]),
    can(u.roles, [
      "Higher Board",
      "Project Operations",
      "Operations Systems / Admin",
    ])
      ? all(
          "SELECT * FROM account_credit_ledger ORDER BY created_at DESC LIMIT 1000",
        )
      : Promise.resolve([]),
    all(
      `SELECT x.* FROM evidence_packages x JOIN evidence e ON e.id=x.evidence_id JOIN students s ON s.id=e.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} ORDER BY x.created_at DESC`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM evidence_package_items x JOIN evidence_packages p ON p.id=x.package_id JOIN evidence e ON e.id=p.evidence_id JOIN students s ON s.id=e.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} ORDER BY x.created_at`,
      ...q.args,
    ),
  ]);
  return {
    user: u,
    workspaceMode,
    students,
    groups,
    tracks,
    tasks,
    contacts,
    gigs,
    evidence,
    cases,
    attachments: attachments.map(({ key, hash, ...a }) => a),
    attachmentContexts,
    requests,
    attendance,
    reviews,
    sessions,
    groupCoaches,
    taskBank,
    savedViews,
    gates,
    statusEvents,
    caseEvents,
    fxRates,
    fxApplications,
    reservations,
    creditLedger,
    evidencePackages,
    evidencePackageItems,
    serviceLinks,
    serviceLinkReviews,
    accounts: can(u.roles, [
      "Higher Board",
      "Project Operations",
      "Operations Systems / Admin",
    ])
      ? await all("SELECT id,label,platform,status,credits FROM accounts")
      : [],
    staff: await all("SELECT id,name,email,roles,scopes,active FROM users"),
    policies: p,
    audit: logs,
    roles,
    serverTime: now(),
  };
}
export function graduationStmt(sid: string) {
  return stmt(
    `INSERT INTO graduation_ledger(id,student_id,policy_id,result,evidence_ids,calculated_at)
SELECT ?,s.id,g.policy_id,
CASE WHEN (SELECT count(*) FROM evidence e JOIN gigs z ON z.id=e.gig_id LEFT JOIN gig_fx_applications x ON x.gig_id=z.id WHERE e.student_id=s.id AND e.status='Accepted' AND z.status='Paid' AND (CASE WHEN z.currency='USD' THEN z.value ELSE coalesce(x.usd_value,0) END)>=json_extract(p.config,'$.largeGig'))>0 THEN '$300 Graduate'
WHEN (SELECT count(*) FROM evidence e JOIN gigs z ON z.id=e.gig_id LEFT JOIN gig_fx_applications x ON x.gig_id=z.id WHERE e.student_id=s.id AND e.status='Accepted' AND z.status='Paid' AND (CASE WHEN z.currency='USD' THEN z.value ELSE coalesce(x.usd_value,0) END)>=json_extract(p.config,'$.minGig'))>=json_extract(p.config,'$.gigCount') AND (SELECT coalesce(sum(CASE WHEN z.currency='USD' THEN z.value ELSE coalesce(x.usd_value,0) END),0) FROM evidence e JOIN gigs z ON z.id=e.gig_id LEFT JOIN gig_fx_applications x ON x.gig_id=z.id WHERE e.student_id=s.id AND e.status='Accepted' AND z.status='Paid' AND (CASE WHEN z.currency='USD' THEN z.value ELSE coalesce(x.usd_value,0) END)>=json_extract(p.config,'$.minGig'))>=json_extract(p.config,'$.minTotal') THEN 'Graduated'
ELSE CAST(min(2,(SELECT count(*) FROM evidence e JOIN gigs z ON z.id=e.gig_id LEFT JOIN gig_fx_applications x ON x.gig_id=z.id WHERE e.student_id=s.id AND e.status='Accepted' AND z.status='Paid' AND (CASE WHEN z.currency='USD' THEN z.value ELSE coalesce(x.usd_value,0) END)>=json_extract(p.config,'$.minGig'))) AS TEXT)||'/3' END,
(SELECT json_group_array(e.id) FROM evidence e WHERE e.student_id=s.id AND e.status='Accepted'),?
FROM students s JOIN groups g ON g.id=s.group_id JOIN policies p ON p.id=g.policy_id WHERE s.id=?`,
    uid("GR"),
    now(),
    sid,
  );
}

export async function appliedPolicy(id: string) {
  const row: any = await stmt(
    "SELECT config FROM policies WHERE id=?",
    id,
  ).first();
  ensure(row, "Applied policy not found.");
  return JSON.parse(row.config);
}
