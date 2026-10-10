import { notify, policyChecks } from "@/lib/automation";
import { distributeEvenly, spread } from "@/lib/domain/qc-assignment";
import {
  loadTimings,
  actor,
  identity,
  stmt,
  all,
  db,
  now,
  uid,
  student,
  proof,
  permit,
  scopeSql,
  keepsAccounts,
  auditStmt,
  loadData,
  graduationStmt,
  appliedPolicy,
  rateLimit,
  provisionStaffLogin,
  provisionDemoLogin,
  teamCoordinators,
} from "@/lib/server";
import { demoPeople, demoPlan, demoStudentEmail, isDemo, sameSide } from "@/lib/demo";
import {
  ensure,
  roles,
  policy,
  validateContact,
  nextGig,
  rejectionCodes,
  can,
  validatePolicy,
  controlledPlatforms,
} from "@/lib/domain/rules";
import { isNationalId, nationalIdProblem, normalizeNationalId, normalizePhone } from "@/lib/domain/sheet-mapping";
import { seed } from "@/lib/seed";
import { appliesTo, beforeSessionKeys, checklistItem } from "@/lib/domain/session-checklist";
import { cairoDay } from "@/lib/domain/programme-week";
export const dynamic = "force-dynamic";
const ops = ["Project Operations", "Operations Coordinator"];
// Gig evidence passes three different people: a first check (the group's coach,
// its supervisor, Project Operations or Coach Operations), a second check (the
// group's supervisor or Project Operations), then the QC team's decision.
// Published student services are reviewed by the quality team: a member holds
// the student, and the team leader hands the work out.
const quality = ["Quality Member", "Quality Lead"];
const admin = ["Operations Systems / Admin"];

function programDay(value: string) {
  const date = new Date(value);
  ensure(!Number.isNaN(date.getTime()), "Choose a valid session date and time.");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * A screenshot proves one gig. The same image, judged by its content so a
 * second upload of the same file counts, may not back a different evidence
 * record, and the delivery and payment screenshots may not be one image.
 */
async function ensureUnusedProof(attachmentIds: string[], ownEvidence: string | null) {
  const hashes: string[] = [];
  for (const attachmentId of attachmentIds) {
    const a: any = await stmt("SELECT hash FROM attachments WHERE id=?", attachmentId).first();
    ensure(a, "Upload the screenshot first.");
    hashes.push(a.hash);
  }
  ensure(new Set(hashes).size === hashes.length, "The delivery and payment screenshots are the same image.");
  for (const hash of hashes) {
    const used: any = await stmt(
      `SELECT e.id FROM evidence e WHERE e.id<>? AND (
         EXISTS (SELECT 1 FROM attachments a WHERE a.id=e.proof_id AND a.hash=?)
         OR EXISTS (SELECT 1 FROM evidence_packages p JOIN evidence_package_items i ON i.package_id=p.id JOIN attachments a ON a.id=i.attachment_id WHERE p.evidence_id=e.id AND a.hash=?))`,
      ownEvidence || "",
      hash,
      hash,
    ).first();
    ensure(!used, "This screenshot is already proof for another gig. Upload the screenshot for this gig.");
  }
}

/** What a demo sign-in may try. Everything else changes real records. */
const demoActions = new Set([
  "case", "case_transition", "complete_task", "contact", "engagement", "milestone", "lifecycle", "task", "saved_view",
  "service_qc_assign", "service_qc_review", "group_contact", "account_topup",
  "gig", "gig_transition", "evidence", "review", "transfer", "account_request", "student",
  "account_coordinator",
  "session", "session_attendance", "session_cancel", "session_check", "session_coach", "session_confirm",
  "session_reschedule", "session_unavailable",
]);

/**
 * A demo sign-in works on the demo groups, with the demo team, and nowhere
 * else: every record the request names must lead back to a DEMO- group.
 */
async function demoGuard(x: any) {
  const elsewhere = "This is not available in the demo. Demo accounts work on the demo groups only.";
  ensure(demoActions.has(x.action), elsewhere);
  ensure(!x.new_email, "Adding a new coach is not available in the demo. Choose the demo coach.");
  for (const person of [x.coach_id, x.reviewer_id, x.coordinator_id])
    if (person) ensure(String(person).startsWith("DEMO-"), "Choose someone from the demo team.");
  // Several accounts at once: every one of them must be a demo account.
  if (Array.isArray(x.account_ids))
    ensure(x.account_ids.length > 0 && x.account_ids.every((a: any) => String(a).startsWith("DEMO-")), elsewhere);
  const touched: string[] = Array.isArray(x.account_ids) ? x.account_ids.map(String) : [];
  if (x.group_id) touched.push(String(x.group_id));
  if (x.student_id) {
    const row: any = await stmt("SELECT group_id FROM students WHERE id=?", x.student_id).first();
    touched.push(String(row?.group_id || ""));
  }
  if (x.gig_id) {
    const row: any = await stmt("SELECT s.group_id FROM gigs z JOIN students s ON s.id=z.student_id WHERE z.id=?", x.gig_id).first();
    touched.push(String(row?.group_id || ""));
  }
  if (x.service_id) {
    const row: any = await stmt("SELECT s.group_id FROM service_links l JOIN students s ON s.id=l.student_id WHERE l.id=?", x.service_id).first();
    touched.push(String(row?.group_id || ""));
  }
  if (x.id) {
    const row: any = await stmt(
      `SELECT group_id FROM sessions WHERE id=?
       UNION ALL SELECT COALESCE(s.group_id,c.group_id) FROM cases c LEFT JOIN students s ON s.id=c.student_id WHERE c.id=?
       UNION ALL SELECT s.group_id FROM tasks k JOIN students s ON s.id=k.student_id WHERE k.id=?
       UNION ALL SELECT id FROM accounts WHERE id=?
       UNION ALL SELECT s.group_id FROM gigs z JOIN students s ON s.id=z.student_id WHERE z.id=?
       UNION ALL SELECT s.group_id FROM evidence e JOIN students s ON s.id=e.student_id WHERE e.id=?`,
      x.id, x.id, x.id, x.id, x.id, x.id,
    ).first();
    if (row) touched.push(String(row.group_id || ""));
  }
  ensure(x.action === "saved_view" || touched.length > 0, elsewhere);
  ensure(touched.every((g) => g.startsWith("DEMO-")), elsewhere);
}

/** Puts the demo back to its starting state and its sign-ins to the demo password. */
async function refreshDemo() {
  let kept = 0;
  const reasons: string[] = [];
  // One at a time: a reviewed link cannot be removed, and that must not stop the rest.
  for (const [sql, ...params] of demoPlan(Date.now())) {
    try {
      await stmt(sql, ...params).run();
    } catch (error: any) {
      kept++;
      if (reasons.length < 5) reasons.push(`${sql.slice(0, 40)}… ${error?.message || error}`);
    }
  }
  for (const p of demoPeople) await provisionDemoLogin(p.email, p.name);
  await provisionDemoLogin(demoStudentEmail, "Demo Student");
  return { kept, reasons };
}

/** The active Quality Member holding the fewest gig reviews; the lead carries none. */
async function leastLoadedEvidenceReviewer(): Promise<string | null> {
  const members = (await all(
    "SELECT id FROM users WHERE active=1 AND roles LIKE '%Quality Member%' AND roles NOT LIKE '%Quality Lead%' AND id NOT LIKE 'DEMO-%' ORDER BY id",
  )) as any[];
  let best: { id: string; n: number } | null = null;
  for (const m of members) {
    const load: any = await stmt("SELECT count(*) n FROM evidence WHERE qc_actor=? AND status='Quality Review'", m.id).first();
    const n = Number(load?.n || 0);
    if (!best || n < best.n) best = { id: m.id, n };
  }
  return best?.id || null;
}

/**
 * Everything that puts a paid gig's proof into review: the evidence record at
 * the coordinator check, its first package holding the delivery and the payment proof
 * (Quality acceptance requires both in the latest package), and the context of
 * both screenshots. The caller has already checked the gig is paid and that
 * both proofs are separate uploads belonging to the student.
 */
function evidenceIntake(u: any, g: any, policyId: string, x: any, t: string, evidenceId: string) {
  const evidencePackage = uid("EPK");
  const source = x.source || g.platform;
  return [
    stmt(
      "INSERT INTO evidence(id,student_id,gig_id,proof_id,source,status,recorder,stage_at,created_at,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
      evidenceId, g.student_id, g.id, x.proof_id, source, "Coordinator L1", u.id, t, t, policyId,
    ),
    stmt(
      "INSERT INTO evidence_packages(id,evidence_id,revision,status,created_by,created_at) VALUES(?,?,1,'Submitted',?,?)",
      evidencePackage, evidenceId, u.id, t,
    ),
    stmt("INSERT INTO evidence_package_items VALUES(?,?,?,?,?)", uid("EPI"), evidencePackage, "Delivery", x.proof_id, t),
    stmt("INSERT INTO evidence_package_items VALUES(?,?,?,?,?)", uid("EPI"), evidencePackage, "Payment", x.payment_proof_id, t),
    stmt(
      "UPDATE attachment_context SET gig_id=?,account_id=?,activity_type='Evidence submission',platform=?,source=?,performed_by_type='STUDENT',performed_by_student_id=? WHERE attachment_id=?",
      g.id, g.account_id || null, g.platform, source, g.student_id, x.proof_id,
    ),
    stmt(
      "UPDATE attachment_context SET gig_id=?,account_id=?,activity_type='Payment evidence',platform=?,source=?,performed_by_type='STUDENT',performed_by_student_id=? WHERE attachment_id=?",
      g.id, g.account_id || null, g.platform, source, g.student_id, x.payment_proof_id,
    ),
  ];
}

const sessionLeaders = ["Coach Operations", "Project Operations", "Operations Systems / Admin"];

/** The group a session belongs to, if this person may plan its sessions. */
async function sessionGroup(u: any, groupId: string) {
  const group: any = await stmt("SELECT * FROM groups WHERE id=?", groupId).first();
  ensure(group, "Group not found.");
  if (!can(u.roles, sessionLeaders))
    ensure(
      can(u.roles, ["Operations Coordinator"]) && group.coordinator === u.id,
      "You can plan sessions only for your own groups.",
    );
  return group;
}

/**
 * A session's schedule is followed as a case until the group's coordinator and
 * the coach have both confirmed it. The case is keyed by the session, so it is
 * reopened on a reschedule rather than duplicated.
 */
async function sessionCase(session: any, group: any, status: string, note: string, actor: string, t: string) {
  const source = "session-" + session.id;
  const existing: any = await stmt("SELECT id FROM cases WHERE source=?", source).first();
  const caseId = existing?.id || uid("CASE");
  const resolution = ["Resolved", "Closed"].includes(status) ? note : null;
  return [
    existing
      ? stmt("UPDATE cases SET status=?,due=?,resolution=? WHERE id=?", status, session.starts_at, resolution, caseId)
      : stmt(
          "INSERT INTO cases(id,student_id,title,type,severity,status,owner,due,resolution,source,created_at,group_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          caseId, null, `Confirm session · ${group.id} · Week ${session.week}`, "Session", "S3 Standard",
          status, actor, session.starts_at, resolution, source, t, group.id,
        ),
    stmt("INSERT INTO case_events VALUES(?,?,?,?,?,?)", uid("CASEEV"), caseId, status, actor, note, t),
  ];
}

async function validateSessionSlot(x: any, excludeId?: string) {
  // The coach may be named later: a session without one is confirmed by the
  // group's active coach, who is then attached to it.
  ensure(
    x.group_id && x.title?.trim() && x.starts_at,
    "Group, title and date are required.",
  );
  const group: any = await stmt(
    "SELECT g.*,p.config policy_config FROM groups g JOIN policies p ON p.id=g.policy_id WHERE g.id=? AND g.status='Active'",
    x.group_id,
  ).first();
  ensure(group, "Choose an active group.");
  const assigned = !x.coach_id || await stmt(
    "SELECT gc.id FROM group_coaches gc JOIN users u ON u.id=gc.user_id WHERE gc.group_id=? AND gc.user_id=? AND gc.status='Active' AND gc.onboarding_status='Complete' AND u.active=1",
    group.id,
    x.coach_id,
  ).first();
  ensure(
    assigned,
    "Choose an active, fully onboarded coach assigned to this group.",
  );
  const config = { ...policy, ...JSON.parse(group.policy_config || "{}") };
  const deliveryModel = group.delivery_model || "Regular";
  ensure(
    ["Regular", "Industry"].includes(deliveryModel),
    "The group delivery model is invalid.",
  );
  const limit =
    deliveryModel === "Industry"
      ? config.industrySessionCount
      : config.regularSessionCount;
  const week = Number(x.week);
  ensure(
    Number.isInteger(week) && week >= 1 && week <= limit,
    `${deliveryModel} groups support session weeks 1–${limit}.`,
  );
  const duration = Number(x.duration_minutes || config.sessionMinutes);
  ensure(
    Number.isInteger(duration) && duration === config.sessionMinutes,
    `Session duration must match the approved policy: ${config.sessionMinutes} minutes.`,
  );
  const startsAt = new Date(x.starts_at).toISOString();
  const day = programDay(startsAt);
  const groupConflict = await stmt(
    `SELECT id FROM sessions WHERE group_id=? AND week=? AND status<>'Cancelled'${excludeId ? " AND id<>?" : ""}`,
    group.id,
    week,
    ...(excludeId ? [excludeId] : []),
  ).first();
  ensure(
    !groupConflict,
    `This group already has an active session for Week ${week}. Reschedule the existing session instead.`,
  );
  const coachConflict = x.coach_id && await stmt(
    `SELECT id FROM sessions WHERE coach_id=? AND session_day=? AND status<>'Cancelled'${excludeId ? " AND id<>?" : ""}`,
    x.coach_id,
    day,
    ...(excludeId ? [excludeId] : []),
  ).first();
  ensure(
    !coachConflict,
    "This coach already has a group session on that day.",
  );
  return { startsAt, day, week, duration };
}
/**
 * The workspace payload is a few megabytes of JSON that shrinks more than ten
 * times under gzip. Cloudflare compresses at the edge in production, but the
 * development server does not, and the difference between 4 MB and 0.3 MB on
 * the wire is the difference between a page that feels broken and one that
 * feels quick. Server-Timing reports where the time went so the next slowness
 * can be measured rather than guessed.
 */
async function jsonResponse(data: unknown, req: Request | undefined, timings: Record<string, number>) {
  const started = Date.now();
  const text = JSON.stringify(data);
  timings.serialize = Date.now() - started;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    "Server-Timing": Object.entries(timings)
      .map(([name, ms]) => `${name};dur=${ms}`)
      .join(", "),
  };
  const accepts = req?.headers.get("accept-encoding") ?? "";
  if (/gzip/.test(accepts) && typeof CompressionStream === "function") {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
    return new Response(stream, { headers });
  }
  return new Response(text, { headers });
}

export async function GET(req?: Request) {
  try {
    const timings: Record<string, number> = {};
    let mark = Date.now();
    const lap = (name: string) => {
      timings[name] = Date.now() - mark;
      mark = Date.now();
    };
    const i = await identity();
    lap("identity");
    // A signed-in staff record proves the workspace is initialized, so the
    // setup check only runs when no such record exists. That removes one
    // database round trip from every ordinary request.
    let u: any;
    try {
      u = await actor();
    } catch (error) {
      if (
        !(await stmt(
          "SELECT count(*) n FROM users WHERE id NOT LIKE 'system-unassigned-%'",
        ).first<any>())?.n
      ) {
        const roster: any = await stmt("SELECT count(*) n FROM roster_imports").first();
        return Response.json({ setup: true, importedRoster: Boolean(roster?.n) });
      }
      throw error;
    }
    void i;
    lap("actor");
    const data: any = await loadData(u);
    lap("load");
    timings.db = loadTimings.db;
    timings.enrich = loadTimings.enrich;
    // Server-side callers (reports, policy checks) use the per-student policy
    // copy; the browser never does. 2,887 copies of it were 1.6 MB of the
    // response, so it is stripped at the boundary along with the evidence copy.
    for (const s of data.students) delete s.policy;
    for (const e of data.evidence) delete e.applied_policy;
    return jsonResponse(data, req, timings);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 403 });
  }
}
export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    ensure(
      !origin || origin === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();
    if (x.action === "setup") {
      const i = await identity();
      ensure(
        ["demo", "production"].includes(x.mode),
        "Choose a demo or production workspace.",
      );
      ensure(
        !(await stmt(
          "SELECT count(*) n FROM users WHERE id NOT LIKE 'system-unassigned-%'",
        ).first<any>())?.n,
        "Workspace is already initialized.",
      );
      const roster: any = await stmt(
        "SELECT count(*) n FROM roster_imports",
      ).first();
      if (roster?.n) {
        ensure(
          x.mode === "production",
          "An imported roster can only initialize a production workspace.",
        );
        await seed(i, "production", true, undefined, true);
      } else {
        await seed(i, x.mode);
      }
      return Response.json({ ok: true });
    }
    const u = await actor();
    await rateLimit("operations:" + u.id, 180, 60);
    ensure(typeof x.action === "string", "Choose an operation.");
    if (x.action === "demo_refresh") {
      ensure(isDemo(u) || can(u.roles, ["Operations Systems / Admin"]), "Only a demo account or an administrator can refresh the demo.");
      return Response.json({ ok: true, ...(await refreshDemo()) });
    }
    if (isDemo(u)) await demoGuard(x);
    const key = x.request_id || uid("REQ");
    ensure(typeof key === "string" && key.length < 150, "Invalid request key.");
    const prior: any = await stmt(
      "SELECT actor FROM audit_events WHERE request_id=?",
      key,
    ).first();
    if (prior) {
      ensure(
        prior.actor === u.id,
        "Request key belongs to a different staff action.",
      );
      return Response.json({ ok: true, replayed: true });
    }
    let sid = x.student_id;
    let s: any;
    if (sid) {
      s = await student(u, sid);
      ensure(s.group_status !== "Archived", "Archived groups are read-only.");
    }
    const id = x.id || uid();
    const t = now();
    const jobs: any[] = [];
    let auditPrevious: any = null;
    // Set by the staff action: the person who should be able to sign in once
    // the record is written.
    let signIn: { email: string; nationalId: string; name: string; active: boolean; reset: boolean } | null = null;
    let auditValue: any = { ...x };
    delete auditValue.request_id;
    // The person who records an action owns it. Nobody hands their follow-up
    // to someone else by picking a name, so whatever the form sent is ignored.
    if (["contact", "task", "case", "group_gate"].includes(x.action)) {
      x.owner = u.id;
      auditValue.owner = u.id;
    }
    switch (x.action) {
      case "contact": {
        permit(u, ops);
        validateContact(x);
        // A screenshot is optional now; when one is attached it must be this student's.
        if (x.proof_id) await proof(u, x.proof_id, sid);
        ensure(
          await stmt(
            "SELECT id FROM users WHERE id=? AND active=1",
            x.owner,
          ).first(),
          "Choose an active next-action owner.",
        );
        jobs.push(
          stmt(
            "INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            id,
            sid,
            x.channel,
            x.outcome,
            x.occurred_at,
            x.proof_id || null,
            x.next_action,
            x.owner,
            x.due,
            String(x.notes).trim(),
            u.id,
            t,
          ),
          stmt(
            "UPDATE students SET last_contact=CASE WHEN last_contact IS NULL OR last_contact<? THEN ? ELSE last_contact END WHERE id=?",
            x.occurred_at,
            x.occurred_at,
            sid,
          ),
          stmt(
            "UPDATE attachment_context SET activity_type='Student contact',occurred_at=?,source=?,performed_by_type='STAFF' WHERE attachment_id=?",
            x.occurred_at,
            x.channel,
            x.proof_id || "",
          ),
          stmt(
            "INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)",
            uid("TSK"),
            sid,
            x.next_action,
            x.owner,
            x.due,
            "Follow-up",
            "Normal",
            "Open",
            "contact-" + id,
            t,
          ),
        );
        break;
      }
      case "group_contact": {
        // One message to the whole group: a contact is logged for every active
        // student in it, with the coordinator's comment. A screenshot is
        // optional. No follow-up action is opened for each; the coordinator's
        // own tasks stay their list.
        permit(u, ops);
        ensure(x.group_id && x.channel && x.outcome && x.occurred_at, "Group, channel, outcome and time are required.");
        ensure(String(x.notes || "").trim().length >= 3, "Write a short comment on the message.");
        const group: any = await stmt("SELECT * FROM groups WHERE id=?", x.group_id).first();
        ensure(group, "Group not found.");
        if (!can(u.roles, ["Project Operations", ...admin]))
          ensure(group.coordinator === u.id, "You can message only your own groups.");
        const shot: any = x.proof_id
          ? await stmt(
              "SELECT a.* FROM attachments a JOIN students s ON s.id=a.student_id WHERE a.id=? AND s.group_id=?",
              x.proof_id,
              x.group_id,
            ).first()
          : null;
        ensure(!x.proof_id || shot, "The screenshot does not belong to this group.");
        const members = await all("SELECT id FROM students WHERE group_id=? AND lifecycle='Active'", x.group_id);
        ensure(members.length > 0, "The group has no active students.");
        const due = new Date(Date.parse(x.occurred_at) + 7 * 86400000).toISOString();
        for (const m of members) {
          // Each student's contact keeps a screenshot of its own, as every
          // contact must; they all point at the one image that was uploaded.
          let proofId = x.proof_id || null;
          if (shot && m.id !== shot.student_id) {
            proofId = uid("FILE");
            jobs.push(
              stmt(
                "INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)",
                proofId,
                m.id,
                `${shot.key}#${m.id}`,
                shot.name,
                shot.mime,
                shot.size,
                shot.hash,
                u.id,
                t,
              ),
              stmt(
                "INSERT INTO attachment_context VALUES(?,?,?,?,?,?,?,?,?,?)",
                proofId,
                x.group_id,
                null,
                null,
                "Group message",
                null,
                x.occurred_at,
                x.channel,
                "STAFF",
                null,
              ),
            );
          }
          jobs.push(
            stmt(
              "INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
              uid("CON"),
              m.id,
              x.channel,
              x.outcome,
              x.occurred_at,
              proofId,
              x.next_action?.trim() || "Group message",
              u.id,
              due,
              (x.notes || "") + " (group message)",
              u.id,
              t,
            ),
            stmt(
              "UPDATE students SET last_contact=CASE WHEN last_contact IS NULL OR last_contact<? THEN ? ELSE last_contact END WHERE id=?",
              x.occurred_at,
              x.occurred_at,
              m.id,
            ),
          );
        }
        if (x.proof_id)
          jobs.push(
            stmt(
              "UPDATE attachment_context SET activity_type='Group message',occurred_at=?,source=?,performed_by_type='STAFF' WHERE attachment_id=?",
              x.occurred_at,
              x.channel,
              x.proof_id,
            ),
          );
        auditValue = { group_id: x.group_id, students: members.length, channel: x.channel };
        break;
      }
      case "task": {
        permit(u, [...ops, "Team Supervisor", "Coach", "Coach Operations"]);
        ensure(
          x.title?.trim() && x.owner && Date.parse(x.due),
          "Title, owner, and due date are required.",
        );
        jobs.push(
          stmt(
            "INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)",
            id,
            sid || null,
            x.title,
            x.owner,
            x.due,
            x.category || "Follow-up",
            x.priority || "Normal",
            "Open",
            key,
            t,
          ),
        );
        break;
      }
      case "complete_task": {
        const task: any = await stmt(
          "SELECT * FROM tasks WHERE id=?",
          id,
        ).first();
        ensure(task, "Task not found.");
        if (task.student_id) await student(u, task.student_id);
        ensure(
          task.owner === u.id ||
            can(u.roles, ["Project Operations", "Team Supervisor"]),
          "Only the owner or supervisor can complete this task.",
        );
        ensure(
          task.category !== "Correction",
          "Correction closes only after accepted evidence or final Quality Lead resolution.",
        );
        if (task.category === "Contact")
          ensure(
            await stmt(
              "SELECT id FROM contacts WHERE student_id=? AND created_at>=?",
              task.student_id,
              task.created_at,
            ).first(),
            "Log a complete contact with proof before closing this contact task.",
          );
        auditPrevious = task;
        jobs.push(stmt("UPDATE tasks SET status='Completed' WHERE id=?", id));
        break;
      }
      case "engagement": {
        permit(u, ["Team Supervisor", "Project Operations"]);
        ensure(
          s && x.reason?.trim(),
          "Student and override reason are required.",
        );
        ensure(
          ["Active", "At Risk", "Critical", "Unresponsive"].includes(x.status),
          "Invalid engagement status.",
        );
        if (x.status === "Unresponsive") {
          const p = await appliedPolicy(s.policy_id);
          const f: any = await stmt(
            "SELECT count(*) n FROM contacts WHERE student_id=? AND outcome='No Response' AND occurred_at>=?",
            sid,
            new Date(Date.now() - p.failedWindowDays * 86400000).toISOString(),
          ).first();
          ensure(
            f.n >= p.failedAttempts,
            `Unresponsive requires ${p.failedAttempts} recorded failed attempts in ${p.failedWindowDays} days.`,
          );
        }
        auditPrevious = s;
        jobs.push(
          stmt("UPDATE students SET engagement=? WHERE id=?", x.status, sid),
          stmt(
            "INSERT INTO student_status_events VALUES(?,?,?,?,?,?,?,?)",
            uid("STATUS"),
            sid,
            "Engagement",
            s.engagement,
            x.status,
            u.id,
            x.reason,
            t,
          ),
        );
        if (x.status === "Critical")
          jobs.push(
            stmt(
              "INSERT OR IGNORE INTO cases(id,student_id,title,type,severity,status,owner,due,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
              uid("CASE"),
              sid,
              "Supervisor intervention",
              "Student",
              "S2 High",
              "Open",
              s.supervisor,
              new Date(Date.now() + 86400000).toISOString(),
              "critical-" + sid,
              t,
            ),
          );
        break;
      }
      case "lifecycle": {
        permit(u, ["Project Operations"]);
        ensure(
          s && x.reason?.trim(),
          "Student and lifecycle reason are required.",
        );
        ensure(
          [
            "Active",
            "Paused",
            "Transferred",
            "Withdrawn",
            "Removed",
            "Graduate Closed",
            "Non-Graduate Closed",
          ].includes(x.status),
          "Invalid lifecycle status.",
        );
        if (x.status === "Graduate Closed") {
          const result: any = await stmt(
            "SELECT result FROM graduation_ledger WHERE student_id=? ORDER BY calculated_at DESC LIMIT 1",
            sid,
          ).first();
          ensure(
            result && ["Graduated", "$300 Graduate"].includes(result.result),
            "Graduate closure requires a calculated qualifying graduation result.",
          );
        }
        if (x.status === "Withdrawn") {
          const decision: any = await stmt(
            "SELECT decision FROM withdrawal_decisions WHERE student_id=? ORDER BY decided_at DESC LIMIT 1",
            sid,
          ).first();
          ensure(
            decision?.decision === "Approved",
            "Withdrawal requires a recorded approved Ministry decision.",
          );
        }
        if (x.status.endsWith("Closed")) {
          ensure(
            !(await stmt(
              "SELECT id FROM tasks WHERE student_id=? AND status='Open'",
              sid,
            ).first()),
            "Resolve every open action before closure.",
          );
          ensure(
            !(await stmt(
              "SELECT id FROM cases WHERE student_id=? AND status<>'Closed'",
              sid,
            ).first()),
            "Close or explicitly resolve every case before closure.",
          );
        }
        auditPrevious = s;
        jobs.push(
          stmt("UPDATE students SET lifecycle=? WHERE id=?", x.status, sid),
          stmt(
            "INSERT INTO student_status_events VALUES(?,?,?,?,?,?,?,?)",
            uid("STATUS"),
            sid,
            "Lifecycle",
            s.lifecycle,
            x.status,
            u.id,
            x.reason,
            t,
          ),
        );
        break;
      }
      case "student": {
        permit(u, [...ops, ...admin]);
        ensure(
          x.name?.trim() && x.group_id && /^S[\w-]{1,60}$/.test(id),
          "Student ID, name and group are required.",
        );
        const destination: any = await stmt(
          "SELECT * FROM groups WHERE id=? AND status='Active'",
          x.group_id,
        ).first();
        ensure(destination, "Choose an active group.");
        // A student joins one of the groups this person runs.
        if (!can(u.roles, ["Project Operations", ...admin])) {
          const scope = scopeSql(u, "g", null);
          ensure(
            await stmt(`SELECT g.id FROM groups g WHERE g.id=? AND ${scope.sql}`, x.group_id, ...scope.args).first(),
            "Choose one of your own groups.",
          );
        }
        const trackCapacity: any = await stmt(
          "SELECT capacity FROM tracks WHERE name=? AND active=1",
          destination.track,
        ).first();
        ensure(trackCapacity, "The destination group track is not active.");
        const trackEnrollment: any = await stmt(
          "SELECT count(*) n FROM students s JOIN groups g ON g.id=s.group_id WHERE g.track=? AND s.lifecycle NOT IN ('Transferred','Withdrawn','Removed')",
          destination.track,
        ).first();
        ensure(
          trackCapacity.capacity == null || Number(trackEnrollment.n) < Number(trackCapacity.capacity),
          "The approved track capacity has been reached.",
        );
        if (!can(u.roles, ["Project Operations", ...admin])) {
          ensure(
            await stmt(
              "SELECT id FROM groups WHERE id=? AND coordinator=?",
              x.group_id,
              u.id,
            ).first(),
            "Group is outside your scope.",
          );
        }
        const email = String(x.email || "").trim().toLowerCase();
        ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "A valid student email is required for Supabase sign-in.");
        ensure(
          !(await stmt("SELECT id FROM students WHERE email IS NOT NULL AND trim(email)<>'' AND lower(email)=?", email).first()),
          "This student email is already linked to another record.",
        );
        const lifecycle = x.lifecycle || "Active";
        const engagement = x.engagement || "Active";
        const coaching = x.coaching || "In Progress";
        ensure(["Active", "Paused", "Transferred", "Withdrawn", "Removed", "Graduate Closed", "Non-Graduate Closed"].includes(lifecycle), "Invalid lifecycle status.");
        ensure(["Active", "At Risk", "Critical", "Unresponsive"].includes(engagement), "Invalid engagement status.");
        ensure(String(coaching).length <= 80, "Coaching status is too long.");
        jobs.push(
          stmt(
            "INSERT INTO students(id,name,group_id,email,phone,lifecycle,engagement,coaching,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            id,
            x.name,
            x.group_id,
            email,
            x.phone || "",
            lifecycle,
            engagement,
            coaching,
            t,
          ),
        );
        break;
      }
      case "transfer": {
        permit(u, ["Project Operations", "Team Supervisor"]);
        ensure(
          s && x.group_id && x.reason?.trim(),
          "New group and transfer reason are required.",
        );
        const g: any = await stmt(
          "SELECT * FROM groups WHERE id=? AND status='Active'",
          x.group_id,
        ).first();
        ensure(g, "Choose an active destination group.");
        if (!can(u.roles, ["Project Operations"]))
          ensure(
            g.supervisor === u.id,
            "Destination group is outside your scope.",
          );
        if (g.track !== s.track) {
          const trackCapacity: any = await stmt("SELECT capacity FROM tracks WHERE name=? AND active=1", g.track).first();
          const trackEnrollment: any = await stmt(
            "SELECT count(*) n FROM students z JOIN groups y ON y.id=z.group_id WHERE y.track=? AND z.lifecycle NOT IN ('Transferred','Withdrawn','Removed')",
            g.track,
          ).first();
          ensure(
            trackCapacity && (trackCapacity.capacity == null || Number(trackEnrollment.n) < Number(trackCapacity.capacity)),
            "The destination track capacity has been reached.",
          );
        }
        auditPrevious = s;
        jobs.push(
          stmt("UPDATE students SET group_id=? WHERE id=?", x.group_id, sid),
          stmt(
            "UPDATE tasks SET owner=? WHERE student_id=? AND status='Open'",
            g.coordinator,
            sid,
          ),
        );
        break;
      }
      case "group": {
        // Groups are created by the administrators only.
        permit(u, admin);
        for (const k of [
          "name",
          "track",
          "provider",
          "coordinator",
          "supervisor",
          "coach",
          "start_date",
          "pathway",
        ])
          ensure(x[k], `${k} is required.`);
        ensure(["Outcome", "Support"].includes(x.pathway), "Invalid pathway.");
        const deliveryModel = x.delivery_model || "Regular";
        ensure(
          deliveryModel === "Regular",
          "New groups use the Regular delivery model.",
        );
        const approvedTrack: any = await stmt(
          "SELECT * FROM tracks WHERE name=? AND active=1",
          x.track,
        ).first();
        ensure(approvedTrack, "Choose an active approved technical track.");
        ensure(
          !approvedTrack.provider || approvedTrack.provider === x.provider,
          "The group provider must match the approved track setup.",
        );
        const selectedPolicy: any = await stmt(
          x.policy_id
            ? "SELECT id FROM policies WHERE id=? AND status='Effective'"
            : "SELECT id FROM policies WHERE status='Effective' ORDER BY created_at DESC LIMIT 1",
          ...(x.policy_id ? [x.policy_id] : []),
        ).first();
        ensure(selectedPolicy, "Choose an effective approved policy.");
        jobs.push(
          stmt(
            "INSERT INTO groups(id,name,track,provider,coordinator,supervisor,coach,pathway,delivery_model,start_date,status,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            id,
            x.name,
            x.track,
            x.provider,
            x.coordinator,
            x.supervisor,
            x.coach,
            x.pathway,
            deliveryModel,
            x.start_date,
            "Active",
            selectedPolicy.id,
          ),
        );
        break;
      }
      case "session": {
        // The schedule is the leaders' to set: Project Operations and Coach
        // Operations. Coordinators and coaches confirm and record attendance.
        permit(u, sessionLeaders);
        const group = await sessionGroup(u, x.group_id);
        const session = await validateSessionSlot(x);
        jobs.push(
          ...(await sessionCase(
            { id, starts_at: session.startsAt, week: session.week },
            group, "Open", "Scheduled. Waiting for the coordinator and the coach to confirm.", u.id, t,
          )),
          stmt(
            "INSERT INTO sessions(id,group_id,coach_id,title,starts_at,session_day,duration_minutes,status,week,updated_at,coordinator_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            id,
            x.group_id,
            x.coach_id || null,
            x.title.trim(),
            session.startsAt,
            session.day,
            session.duration,
            "Scheduled",
            session.week,
            t,
            group.coordinator,
          ),
        );
        break;
      }
      case "session_confirm":
      case "session_unavailable": {
        // The group's coordinator and the coach each answer for a session:
        // attending, or unavailable with a reason. It reads Confirmed only once
        // both attend. Someone unavailable puts it back to Scheduled and the
        // leaders are told, so they can cover or reschedule it.
        permit(u, ["Coach", "Operations Coordinator"]);
        const attending = x.action === "session_confirm";
        const session: any = await stmt(
          "SELECT * FROM sessions WHERE id=?",
          id,
        ).first();
        ensure(session, "Session not found.");
        ensure(
          attending ? session.status === "Scheduled" : ["Scheduled", "Confirmed"].includes(session.status),
          attending ? "Only a scheduled session can be confirmed." : "Only an upcoming session can be answered.",
        );
        const group: any = await stmt("SELECT * FROM groups WHERE id=?", session.group_id).first();
        const asCoach =
          can(u.roles, ["Coach"]) &&
          (session.coach_id
            ? session.coach_id === u.id
            : Boolean(
                await stmt(
                  "SELECT id FROM group_coaches WHERE group_id=? AND user_id=? AND status='Active'",
                  session.group_id,
                  u.id,
                ).first(),
              ));
        const asCoordinator = group?.coordinator === u.id && can(u.roles, ["Operations Coordinator"]);
        ensure(
          asCoach || asCoordinator,
          "Only the group's coordinator or the session's coach can answer for it.",
        );
        const reason = String(x.reason || "").trim();
        if (!attending) ensure(reason.length >= 5, "Say why you cannot attend.");
        // Each side's answer: a confirmation time when attending, a reason when not.
        const coachAt = asCoach ? (attending ? session.coach_confirmed_at || t : null) : session.coach_confirmed_at;
        const coordinatorAt = asCoordinator ? (attending ? session.coordinator_confirmed_at || t : null) : session.coordinator_confirmed_at;
        const coachAway = asCoach ? (attending ? null : reason) : session.coach_unavailable;
        const coordinatorAway = asCoordinator ? (attending ? null : reason) : session.coordinator_unavailable;
        if (attending)
          ensure(
            coachAt !== session.coach_confirmed_at || coordinatorAt !== session.coordinator_confirmed_at,
            "You have already confirmed this session.",
          );
        const both = Boolean(coachAt && coordinatorAt);
        const who = asCoach && asCoordinator ? "The coordinator and coach" : asCoach ? "The coach" : "The coordinator";
        auditPrevious = session;
        jobs.push(
          stmt(
            "UPDATE sessions SET coach_id=?,coach_confirmed_at=?,coordinator_confirmed_at=?,coach_unavailable=?,coordinator_unavailable=?,status=?,confirmed_at=?,updated_at=? WHERE id=?",
            session.coach_id || (asCoach ? u.id : null),
            coachAt,
            coordinatorAt,
            coachAway,
            coordinatorAway,
            both ? "Confirmed" : "Scheduled",
            both ? session.confirmed_at || t : null,
            t,
            id,
          ),
          ...(await sessionCase(
            session, group,
            !attending ? "Waiting" : both ? "Resolved" : "In Progress",
            !attending
              ? `${who} cannot attend: ${reason}`
              : both
                ? "Confirmed by the coordinator and the coach."
                : asCoach
                  ? "The coach confirmed. Waiting for the coordinator."
                  : "The coordinator confirmed. Waiting for the coach.",
            u.id, t,
          )),
        );
        if (!attending) {
          jobs.push(stmt("UPDATE cases SET severity='S2 High' WHERE source=?", "session-" + session.id));
          // The leaders, and the group's own supervisor, hear about it at once.
          const people = await all(`SELECT id,roles FROM users WHERE active=1 AND ${sameSide(u, "id")}`);
          const leaders = new Set<string>(
            people
              .filter((p: any) => {
                const held = typeof p.roles === "string" ? JSON.parse(p.roles || "[]") : p.roles || [];
                return held.includes("Project Operations") || held.includes("Coach Operations");
              })
              .map((p: any) => p.id),
          );
          if (group?.supervisor) leaders.add(group.supervisor);
          leaders.delete(u.id);
          const when = new Date(session.starts_at).toLocaleString("en-GB", {
            timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "numeric", hour12: true, minute: "2-digit",
          });
          const title = `${u.name || who} cannot attend ${group?.id || session.group_id} Week ${session.week} (${when}): ${reason}`;
          for (const recipient of leaders)
            jobs.push(notify(recipient, title, "session", session.id, "Urgent", `session-unavailable:${session.id}:${u.id}:${t}:${recipient}`));
        }
        break;
      }
      case "session_reschedule": {
        // Rescheduling moves the group, not one date: the session chosen and
        // every later scheduled session of the group shift by the same amount
        // (5pm to 7pm moves them all to 7pm), and sessions before it stay as
        // they were. It is Coach Operations' decision.
        permit(u, ["Coach Operations"]);
        const current: any = await stmt(
          "SELECT * FROM sessions WHERE id=?",
          id,
        ).first();
        ensure(
          current && ["Scheduled", "Confirmed"].includes(current.status),
          "Only a scheduled or confirmed session can be rescheduled.",
        );
        const group = await sessionGroup(u, current.group_id);
        ensure(
          x.reason?.trim().length >= 5,
          "Record a rescheduling reason.",
        );
        // The chosen session is checked as before: its group, its slot, and a
        // new coach if one is named. The coach already on it stays as assigned.
        const session = await validateSessionSlot(
          {
            ...x,
            group_id: current.group_id,
            title: current.title,
            coach_id: x.coach_id || null,
            week: current.week,
            duration_minutes: current.duration_minutes,
          },
          id,
        );
        const shift = Date.parse(session.startsAt) - Date.parse(current.starts_at);
        const moving: any[] = await all(
          "SELECT * FROM sessions WHERE group_id=? AND starts_at>=? AND status IN ('Scheduled','Confirmed') ORDER BY starts_at",
          current.group_id,
          current.starts_at,
        );
        const movingIds = new Set(moving.map((m) => m.id));
        const plan = moving.map((m) => {
          const startsAt = new Date(Date.parse(m.starts_at) + shift).toISOString();
          return { row: m, startsAt, day: programDay(startsAt), coach: x.coach_id || m.coach_id };
        });
        // No coach may end up with two sessions on one day.
        for (const step of plan) {
          if (!step.coach) continue;
          const clash: any = await stmt(
            "SELECT id,group_id FROM sessions WHERE coach_id=? AND session_day=? AND status<>'Cancelled'",
            step.coach,
            step.day,
          ).first();
          ensure(
            !clash || movingIds.has(clash.id),
            `Week ${step.row.week} would move to ${step.day}, when its coach already has a session (${clash?.group_id}). Choose another time.`,
          );
        }
        auditPrevious = current;
        auditValue = { ...auditValue, moved: plan.map((p) => ({ id: p.row.id, from: p.row.starts_at, to: p.startsAt })) };
        // Later sessions first when moving forward, earlier first when moving
        // back, so no two of the group's sessions share a coach and a day mid-way.
        const ordered = shift >= 0 ? [...plan].reverse() : plan;
        for (const step of ordered)
          jobs.push(
            stmt(
              "UPDATE sessions SET coach_id=?,starts_at=?,session_day=?,status='Scheduled',confirmed_at=NULL,coach_confirmed_at=NULL,coordinator_confirmed_at=NULL,coach_unavailable=NULL,coordinator_unavailable=NULL,cancel_reason=NULL,updated_at=? WHERE id=?",
              step.coach || null,
              step.startsAt,
              step.day,
              t,
              step.row.id,
            ),
          );
        for (const step of plan)
          jobs.push(
            // The before-session steps were done for the old time.
            stmt(
              `DELETE FROM session_checks WHERE session_id=? AND item IN (${beforeSessionKeys.map(() => "?").join(",")})`,
              step.row.id,
              ...beforeSessionKeys,
            ),
            // A new time needs both confirmations again.
            ...(await sessionCase(
              { ...step.row, starts_at: step.startsAt },
              group, "Open", "Rescheduled with the group: " + x.reason.trim() + ". Both confirm again.", u.id, t,
            )),
          );
        break;
      }
      case "session_cancel": {
        permit(u, sessionLeaders);
        const current: any = await stmt(
          "SELECT * FROM sessions WHERE id=?",
          id,
        ).first();
        ensure(
          current && ["Scheduled", "Confirmed"].includes(current.status),
          "Only a scheduled or confirmed session can be cancelled.",
        );
        const group = await sessionGroup(u, current.group_id);
        ensure(
          x.reason?.trim().length >= 5,
          "Record a cancellation reason.",
        );
        ensure(
          !(await stmt(
            "SELECT session_id FROM session_reports WHERE session_id=?",
            id,
          ).first()),
          "A completed session report prevents cancellation.",
        );
        auditPrevious = current;
        jobs.push(
          stmt(
            "UPDATE sessions SET status='Cancelled',cancel_reason=?,updated_at=? WHERE id=?",
            x.reason.trim(),
            t,
            id,
          ),
          ...(await sessionCase(current, group, "Closed", "Session cancelled: " + x.reason.trim(), u.id, t)),
        );
        break;
      }
      case "session_check": {
        // One step of the per-session checklist, ticked or unticked. The
        // coordinator's steps belong to the group's coordinator, the trainer
        // joining to the session's coach; the leaders can tick either. Steps
        // the app works out for itself are not ticked by hand.
        permit(u, ["Coach", "Operations Coordinator", ...sessionLeaders]);
        const item = checklistItem(String(x.item || ""));
        ensure(item, "Unknown checklist step.");
        ensure(item!.owner !== "auto", "This step is filled in by the app.");
        const session: any = await stmt("SELECT * FROM sessions WHERE id=?", id).first();
        ensure(session, "Session not found.");
        ensure(session.status !== "Cancelled", "A cancelled session has no checklist.");
        ensure(appliesTo(item!, session), "This step starts from the second session.");
        const group: any = await stmt("SELECT * FROM groups WHERE id=?", session.group_id).first();
        if (!can(u.roles, sessionLeaders)) {
          ensure(item!.owner !== "coach_ops", "Coach Operations ticks this step on the morning of the session.");
          if (item!.owner === "coordinator")
            ensure(
              can(u.roles, ["Operations Coordinator"]) && group?.coordinator === u.id,
              "Only the group's coordinator ticks this step.",
            );
          else
            ensure(
              can(u.roles, ["Coach"]) &&
                (session.coach_id
                  ? session.coach_id === u.id
                  : Boolean(
                      await stmt(
                        "SELECT id FROM group_coaches WHERE group_id=? AND user_id=? AND status='Active'",
                        session.group_id,
                        u.id,
                      ).first(),
                    )),
              "Only the session's coach ticks this step.",
            );
        }
        const existing: any = await stmt(
          "SELECT * FROM session_checks WHERE session_id=? AND item=?",
          id,
          item!.key,
        ).first();
        const done = x.done !== false;
        auditPrevious = existing;
        if (done && !existing)
          jobs.push(
            stmt(
              "INSERT INTO session_checks(id,session_id,item,done_by,done_at) VALUES(?,?,?,?,?)",
              uid("SCK"),
              id,
              item!.key,
              u.id,
              t,
            ),
          );
        else if (!done && existing)
          jobs.push(stmt("DELETE FROM session_checks WHERE id=?", existing.id));
        break;
      }
      case "session_coach": {
        // A different coach for one session only, such as a backup when the
        // group's coach cannot come. It is Coach Operations' decision; they can
        // name a coach already in the system or add a new one here. The other
        // sessions, before and after, keep their coach, so payment follows
        // who actually held each session.
        permit(u, ["Coach Operations"]);
        const session: any = await stmt("SELECT * FROM sessions WHERE id=?", id).first();
        ensure(session && ["Scheduled", "Confirmed"].includes(session.status), "Only a session still to come can change its coach.");
        ensure(Date.parse(session.starts_at) > Date.now(), "A session that has started keeps the coach who held it.");
        ensure(x.reason?.trim().length >= 5, "Say why this session needs another coach.");
        let coachId = String(x.coach_id || "").trim();
        if (!coachId) {
          // A new coach: their sign-in is their email and national ID, as for all staff.
          const email = String(x.new_email || "").trim().toLowerCase();
          const name = String(x.new_name || "").trim();
          ensure(name && email.includes("@"), "Enter the new coach's name and email.");
          const nationalId = normalizeNationalId(x.new_national_id);
          ensure(isNationalId(nationalId), nationalIdProblem(x.new_national_id) || "Enter the new coach's 14-digit national ID; it is their first password.");
          const existing: any = await stmt("SELECT * FROM users WHERE lower(email)=?", email).first();
          ensure(!existing, "Someone with this email is already in the system; choose them from the list instead.");
          ensure(!(await stmt("SELECT id FROM users WHERE trim(national_id)=?", nationalId).first()), "Another member of staff is recorded with this national ID.");
          coachId = uid("USR");
          jobs.push(
            stmt(
              "INSERT INTO users(id,email,name,roles,scopes,active,national_id,phone,title) VALUES(?,?,?,?,?,?,?,?,?)",
              coachId,
              email,
              name,
              JSON.stringify(["Coach"]),
              "[]",
              1,
              nationalId,
              normalizePhone(x.new_phone) || null,
              "Backup Coach",
            ),
          );
          signIn = { email, nationalId, name, active: true, reset: false };
        } else {
          const coach: any = await stmt("SELECT * FROM users WHERE id=? AND active=1", coachId).first();
          ensure(coach && JSON.parse(coach.roles || "[]").includes("Coach"), "Choose an active coach.");
        }
        ensure(coachId !== session.coach_id, "This coach is already on the session.");
        const clash: any = await stmt(
          "SELECT group_id FROM sessions WHERE coach_id=? AND session_day=? AND status<>'Cancelled' AND id<>?",
          coachId,
          session.session_day,
          id,
        ).first();
        ensure(!clash, `This coach already has a session that day (${clash?.group_id}).`);
        auditPrevious = session;
        jobs.push(
          stmt(
            "UPDATE sessions SET coach_id=?,coach_confirmed_at=NULL,coach_unavailable=NULL,status='Scheduled',confirmed_at=NULL,updated_at=? WHERE id=?",
            coachId,
            t,
            id,
          ),
          // The backup coach can see the group's students, to take the session's attendance.
          stmt(
            `INSERT INTO group_coaches(id,group_id,user_id,coach_type,status,onboarding_status,checklist,assigned_by,assigned_at,onboarded_at)
             VALUES(?,?,?,?,?,?,?,?,?,NULL)
             ON CONFLICT(group_id,user_id,coach_type) DO UPDATE SET status='Active',assigned_by=excluded.assigned_by`,
            uid("GC"),
            session.group_id,
            coachId,
            "Backup Coach",
            "Active",
            "Pending",
            "[]",
            u.id,
            t,
          ),
        );
        auditValue = { session_id: id, from: session.coach_id, to: coachId, reason: x.reason.trim(), new_coach: !x.coach_id };
        break;
      }
      case "session_attendance": {
        // Attendance for a whole session at once: the coordinator, the coach
        // or a leader opens the session and marks each student attended or absent.
        permit(u, ["Coach", "Operations Coordinator", ...sessionLeaders]);
        const session: any = await stmt("SELECT * FROM sessions WHERE id=?", id).first();
        ensure(session, "Session not found.");
        ensure(
          session.status !== "Cancelled" && session.starts_at <= t,
          "Attendance can only be taken once a session has started.",
        );
        const group: any = await stmt("SELECT * FROM groups WHERE id=?", session.group_id).first();
        if (!can(u.roles, sessionLeaders))
          ensure(
            (can(u.roles, ["Operations Coordinator"]) && group?.coordinator === u.id) ||
              (can(u.roles, ["Coach"]) &&
                (session.coach_id
                  ? session.coach_id === u.id
                  : Boolean(
                      await stmt(
                        "SELECT id FROM group_coaches WHERE group_id=? AND user_id=? AND status='Active'",
                        session.group_id,
                        u.id,
                      ).first(),
                    ))),
            "Only the group's coordinator or the session's coach takes its attendance.",
          );
        // The coordinator and the coach have until the end of the session's
        // day (Cairo); after that only the session leaders correct it.
        if (!can(u.roles, sessionLeaders))
          ensure(
            cairoDay(t) <= cairoDay(session.starts_at),
            "Attendance closes at the end of the session's day. Ask Coach Operations to correct it.",
          );
        let marks = Object.entries((x.marks || {}) as Record<string, string>);
        ensure(marks.length > 0, "Mark at least one student.");
        ensure(marks.every(([, v]) => ["Present", "Absent"].includes(v)), "Mark each student attended or absent.");
        const members = new Set(
          (await all("SELECT id FROM students WHERE group_id=?", session.group_id)).map((r: any) => r.id),
        );
        ensure(marks.every(([studentId]) => members.has(studentId)), "Every student must belong to the session's group.");
        // The group's coordinator is the source of truth: a coach does not
        // overwrite a mark the coordinator saved, and sees which were kept.
        const coordinatorId = session.coordinator_id || group?.coordinator;
        const fromCoordinator = can(u.roles, sessionLeaders) || u.id === coordinatorId;
        let kept = 0;
        if (!fromCoordinator) {
          const theirs = new Set(
            (await all("SELECT student_id FROM attendance WHERE session_id=? AND recorder=?", id, coordinatorId)).map((r: any) => r.student_id),
          );
          kept = marks.filter(([studentId]) => theirs.has(studentId)).length;
          marks = marks.filter(([studentId]) => !theirs.has(studentId));
        }
        for (const [studentId, status] of marks)
          jobs.push(
            stmt(
              "INSERT INTO attendance VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status,recorder=excluded.recorder,source=excluded.source,updated_at=excluded.updated_at",
              uid("ATT"),
              id,
              studentId,
              status,
              u.id,
              "Session register",
              t,
            ),
          );
        auditValue = { session_id: id, present: marks.filter(([, v]) => v === "Present").length, absent: marks.filter(([, v]) => v === "Absent").length, kept_coordinator_marks: kept };
        break;
      }
      case "milestone": {
        permit(u, ["Coach"]);
        ensure(
          s &&
            Number.isInteger(+x.milestone) &&
            +x.milestone >= 0 &&
            +x.milestone <= 8,
          "Milestone must be between 0 and 8.",
        );
        const coaching =
          +x.milestone === 8
            ? "Coaching Complete"
            : +x.milestone === 0
              ? "Not Started"
              : "In Progress";
        jobs.push(
          stmt(
            "UPDATE students SET milestone=?,coaching=? WHERE id=?",
            +x.milestone,
            coaching,
            sid,
          ),
          stmt(
            "INSERT INTO student_status_events VALUES(?,?,?,?,?,?,?,?)",
            uid("STATUS"),
            sid,
            "Coaching milestone",
            String(s.milestone),
            String(+x.milestone),
            u.id,
            x.reason || "Coach milestone update",
            t,
          ),
        );
        break;
      }
      case "task_bank": {
        permit(u, ["Project Operations", "Operations Systems / Admin"]);
        ensure(
          x.track?.trim() &&
            x.title?.trim() &&
            controlledPlatforms.includes(x.platform) &&
            Number(x.value) > 0,
          "Track, task, controlled platform and positive value are required.",
        );
        jobs.push(
          stmt(
            "INSERT INTO task_bank(id,track,title,platform,value,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
            id,
            x.track,
            x.title,
            x.platform,
            Number(x.value),
            u.id,
            t,
          ),
        );
        break;
      }
      case "account": {
        // A new client account with its opening credit, added by the people
        // who keep the accounts (one at a time or from the import template).
        permit(u, ["Team Supervisor", "Higher Board", "Project Operations", "Operations Systems / Admin"]);
        ensure(keepsAccounts(u), "Accounts are added by the Service Team's supervisor, Project Operations or Higher Board.");
        ensure(
          x.label &&
            controlledPlatforms.includes(x.platform) &&
            Number(x.credits) >= 0,
          "Account label, approved controlled platform and nonnegative credits are required.",
        );
        jobs.push(
          stmt(
            "INSERT INTO accounts(id,platform,label,status,credits) VALUES(?,?,?,?,?)",
            id,
            x.platform,
            x.label,
            "Available",
            Number(x.credits),
          ),
          stmt(
            "INSERT INTO account_credit_ledger(id,account_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?)",
            uid("CR"),
            id,
            Number(x.credits),
            Number(x.credits),
            "Opening approved balance",
            u.id,
            t,
          ),
        );
        break;
      }
      case "account_request": {
        // A request for one of the programme's client accounts on a
        // marketplace: the account acts as the client that orders the
        // student's gig. An approved task, when there is one, fills it in.
        permit(u, ops);
        ensure(s, "Choose the student.");
        const task: any = x.task_bank_id
          ? await stmt("SELECT * FROM task_bank WHERE id=? AND active=1", x.task_bank_id).first()
          : null;
        ensure(!x.task_bank_id || task, "That approved task is not active.");
        const platform = task?.platform || x.platform;
        const title = String(task?.title || x.title || "").trim();
        const value = Number(task?.value ?? x.value);
        ensure(
          controlledPlatforms.includes(platform),
          `Choose the marketplace: ${controlledPlatforms.join(", ")}.`,
        );
        ensure(title, "Describe the gig the client account will order.");
        ensure(
          Number.isFinite(value) && value > 0,
          "Enter the credit the client account needs, in USD.",
        );
        const open: any = await stmt(
          "SELECT count(*) n FROM account_requests WHERE student_id=? AND status NOT IN ('Rejected','Cancelled')",
          sid,
        ).first();
        ensure(
          Number(open.n) < 3,
          "This student already has three client-account requests.",
        );
        jobs.push(
          stmt(
            "INSERT INTO account_requests VALUES(?,?,?,?,?,?,?,?,?)",
            id,
            sid,
            title,
            platform,
            value,
            "Submitted",
            0,
            u.id,
            t,
          ),
          stmt(
            "INSERT INTO account_request_details VALUES(?,?,?,?,?)",
            id,
            task?.id || null,
            String(x.job_profile || "").trim(),
            Number(open.n) + 1,
            x.notes || "",
          ),
        );
        break;
      }
      case "reserve_account": {
        permit(u, ["Higher Board"]);
        const r: any = await stmt(
          "SELECT r.*,s.group_id FROM account_requests r JOIN students s ON s.id=r.student_id WHERE r.id=?",
          x.request,
        ).first();
        ensure(
          r && r.status === "Submitted",
          "Request is not awaiting reservation.",
        );
        await student(u, r.student_id);
        const a: any = await stmt(
          "SELECT * FROM accounts WHERE id=?",
          x.account,
        ).first();
        ensure(
          a && a.status === "Available" && !a.active_assignment,
          "Account is unavailable or already assigned.",
        );
        ensure(
          a.platform === r.platform,
          "Account platform does not match this request.",
        );
        ensure(a.credits >= r.value, "Account has insufficient credits.");
        ensure(
          !(await stmt(
            "SELECT id FROM account_assignments WHERE account_id=? AND (student_id=? OR group_id=?)",
            a.id,
            r.student_id,
            r.group_id,
          ).first()),
          "This account has already been used by this student or group.",
        );
        ensure(
          !(await stmt(
            "SELECT id FROM account_reservations WHERE account_id=? AND status='Active' AND expires_at>?",
            a.id,
            t,
          ).first()),
          "Another allocation is holding this account. Choose a different account or wait for the reservation to expire.",
        );
        const reservation = uid("RSV");
        const expires = new Date(Date.now() + 15 * 60000).toISOString();
        jobs.push(
          stmt(
            "DELETE FROM account_reservations WHERE account_id=? AND (status<>'Active' OR expires_at<=?)",
            a.id,
            t,
          ),
          stmt(
            "INSERT INTO account_reservations(account_id,id,request_id,reserved_by,expires_at,status,created_at) VALUES(?,?,?,?,?,'Active',?)",
            a.id,
            reservation,
            r.id,
            u.id,
            expires,
            t,
          ),
        );
        auditValue = {
          ...auditValue,
          reservation_id: reservation,
          expires_at: expires,
        };
        break;
      }
      case "allocate": {
        permit(u, ["Higher Board"]);
        const r: any = await stmt(
          "SELECT r.*,s.group_id FROM account_requests r JOIN students s ON s.id=r.student_id WHERE r.id=?",
          x.request,
        ).first();
        ensure(
          r && r.status === "Submitted",
          "Request is not awaiting allocation.",
        );
        await student(u, r.student_id);
        ensure(x.task_fit === true, "Approve task fit before assignment.");
        const reservation: any = await stmt(
          "SELECT z.id reservation_id,z.account_id,z.request_id,z.expires_at,a.platform,a.status account_status,a.credits,a.active_assignment FROM account_reservations z JOIN accounts a ON a.id=z.account_id WHERE z.request_id=? AND z.status='Active' AND z.expires_at>?",
          r.id,
          t,
        ).first();
        ensure(
          reservation,
          "The account reservation expired. Reserve an account again.",
        );
        const a = reservation;
        ensure(
          a.account_status === "Available" && !a.active_assignment,
          "Account is unavailable or already assigned.",
        );
        ensure(
          a.platform === r.platform && a.credits >= r.value,
          "Reserved account eligibility changed; reserve another account.",
        );
        const assignment = uid("ASN");
        const gig = uid("GIG");
        const balance = Number(a.credits) - Number(r.value);
        jobs.push(
          stmt(
            "INSERT INTO account_assignments VALUES(?,?,?,?,?,?)",
            assignment,
            a.account_id,
            r.student_id,
            r.group_id,
            r.id,
            t,
          ),
          stmt(
            "UPDATE accounts SET status='Assigned',active_assignment=?,credits=credits-? WHERE id=?",
            assignment,
            r.value,
            a.account_id,
          ),
          stmt(
            "UPDATE account_requests SET status='Assigned',task_fit=1 WHERE id=?",
            r.id,
          ),
          stmt(
            "UPDATE account_reservations SET status='Allocated' WHERE account_id=? AND request_id=?",
            a.account_id,
            r.id,
          ),
          stmt(
            "INSERT INTO gigs(id,student_id,account_id,platform,title,value,currency,status,due,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            gig,
            r.student_id,
            a.account_id,
            a.platform,
            r.task,
            r.value,
            "USD",
            "Account Assigned",
            new Date(Date.now() + 7 * 86400000).toISOString(),
            t,
          ),
          stmt(
            "INSERT INTO account_credit_ledger(id,account_id,assignment_id,gig_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            uid("CR"),
            a.account_id,
            assignment,
            gig,
            -Number(r.value),
            balance,
            `Service charged · ${r.task}`,
            u.id,
            t,
          ),
        );
        // What happens next: the group's coordinator places the order from
        // the account within two days, so they get the task and a notice; a
        // coordinator the account is assigned to hears about it too. The
        // student's page shows that a client will order their service.
        {
          const group: any = await stmt("SELECT coordinator FROM groups WHERE id=?", r.group_id).first();
          const account: any = await stmt("SELECT label,coordinator_id,coordinator_2_id FROM accounts WHERE id=?", a.account_id).first();
          const title = `Order "${r.task}" on ${a.platform} from client account ${account?.label || a.account_id}`;
          if (group?.coordinator)
            jobs.push(
              stmt(
                "INSERT OR IGNORE INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)",
                uid("TSK"),
                r.student_id,
                title,
                group.coordinator,
                new Date(Date.now() + 2 * 86400000).toISOString(),
                "Account",
                "High",
                "Open",
                "account-assigned:" + r.id,
                t,
              ),
            );
          for (const person of new Set([group?.coordinator, account?.coordinator_id, account?.coordinator_2_id].filter(Boolean)))
            if (person !== u.id)
              jobs.push(notify(String(person), `Client account assigned: ${title}`, "student", r.student_id, "Action Required", `account-assigned:${r.id}:${person}`));
        }
        break;
      }
      case "group_whatsapp": {
        // The link to the group's WhatsApp chat, so its coordinator opens it
        // in one tap. Set by the group's coordinator or supervisor, Project
        // Operations or an administrator; an empty link clears it.
        permit(u, ["Operations Coordinator", "Team Supervisor", "Project Operations", "Operations Systems / Admin"]);
        const group: any = await stmt(`SELECT * FROM groups WHERE id=? AND ${sameSide(u, "id")}`, id).first();
        ensure(group, "Group not found.");
        ensure(
          can(u.roles, ["Project Operations", "Operations Systems / Admin"]) || group.coordinator === u.id || group.supervisor === u.id,
          "Only the group's coordinator or supervisor, or Project Operations, sets its WhatsApp link.",
        );
        const link = String(x.whatsapp_link || "").trim();
        ensure(
          !link || (link.length <= 300 && /^https:\/\/(chat\.whatsapp\.com\/[A-Za-z0-9]{10,}|wa\.me\/[\w/?=&%+-]+)$/.test(link)),
          "Paste the group's invite link, starting with https://chat.whatsapp.com/",
        );
        auditPrevious = { whatsapp_link: group.whatsapp_link };
        auditValue = { group_id: id, whatsapp_link: link || null };
        jobs.push(stmt("UPDATE groups SET whatsapp_link=? WHERE id=?", link || null, id));
        break;
      }
      case "account_coordinator": {
        // Supervisors (and Taha, who is one) assign client accounts to the
        // coordinators who work them; a supervisor only to their own team.
        permit(u, ["Team Supervisor"]);
        const accountIds: string[] = Array.isArray(x.account_ids) ? x.account_ids.map(String) : [String(id)];
        ensure(accountIds.length > 0 && accountIds.length <= 600, "Choose between 1 and 600 accounts.");
        const marks = accountIds.map(() => "?").join(",");
        const found = await all(`SELECT id,coordinator_id,coordinator_2_id FROM accounts WHERE id IN (${marks})`, ...accountIds);
        ensure(found.length === accountIds.length, "One or more accounts were not found.");
        // An account can be shared by two coordinators: "second" sets the one
        // working it alongside the first.
        const second = x.slot === "second";
        const coordinatorId = x.coordinator_id ? String(x.coordinator_id) : null;
        if (coordinatorId) {
          const person: any = await stmt("SELECT id,roles FROM users WHERE id=? AND active=1", coordinatorId).first();
          ensure(person && JSON.parse(person.roles).includes("Operations Coordinator"), "Choose an active coordinator.");
          const team = await teamCoordinators(u);
          ensure(!team || team.includes(coordinatorId), "Choose a coordinator from your own team.");
          ensure(
            found.every((a: any) => (second ? a.coordinator_id : a.coordinator_2_id) !== coordinatorId),
            "That coordinator already works this account. Choose a different one.",
          );
          if (second) ensure(found.every((a: any) => a.coordinator_id), "Assign the first coordinator before a second one.");
        }
        const column = second ? "coordinator_2_id" : "coordinator_id";
        auditPrevious = Object.fromEntries(found.map((a: any) => [a.id, { coordinator_id: a.coordinator_id, coordinator_2_id: a.coordinator_2_id }]));
        auditValue = { account_ids: accountIds, [column]: coordinatorId };
        // Removing the first coordinator moves the second one up, so an
        // account is never shared by a second coordinator alone.
        jobs.push(
          !second && !coordinatorId
            ? stmt(`UPDATE accounts SET coordinator_id=coordinator_2_id,coordinator_2_id=NULL WHERE id IN (${marks})`, ...accountIds)
            : stmt(`UPDATE accounts SET ${column}=? WHERE id IN (${marks})`, coordinatorId, ...accountIds),
        );
        break;
      }
      case "account_topup": {
        // A top-up adds credit to a client account. The Service Team's
        // supervisor records it (Higher Board and administrators can too),
        // with the receipt or transfer reference. Each one is a new row in
        // the credit history; nothing earlier is edited.
        permit(u, ["Team Supervisor", "Higher Board", "Project Operations", "Operations Systems / Admin"]);
        ensure(keepsAccounts(u), "Top-ups are recorded by the Service Team's supervisor, Project Operations or Higher Board.");
        const a: any = await stmt("SELECT * FROM accounts WHERE id=?", id).first();
        ensure(a && a.status !== "Retired", "Choose an active client account.");
        const amount = Math.round(Number(x.amount) * 100) / 100;
        ensure(Number.isFinite(amount) && amount > 0 && amount <= 100000, "Enter the top-up amount in USD.");
        const reference = String(x.reference || "").trim();
        ensure(reference.length >= 3, "Record the receipt or transfer reference.");
        const note = String(x.note || "").trim().slice(0, 300);
        const balance = Math.round((Number(a.credits) + amount) * 100) / 100;
        auditPrevious = a;
        jobs.push(
          stmt("UPDATE accounts SET credits=credits+? WHERE id=?", amount, id),
          stmt(
            "INSERT INTO account_credit_ledger(id,account_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?)",
            uid("CR"),
            id,
            amount,
            balance,
            `Top-up · ${reference}${note ? " · " + note : ""}`,
            u.id,
            t,
          ),
        );
        break;
      }
      case "account_status": {
        // The people who keep the accounts change their status, unblocking
        // included; every change needs a reason and is audited.
        permit(u, ["Team Supervisor", "Higher Board", "Project Operations", "Operations Systems / Admin"]);
        ensure(keepsAccounts(u), "Account status is changed by the Service Team's supervisor, Project Operations or Higher Board.");
        const a: any = await stmt(
          "SELECT * FROM accounts WHERE id=?",
          id,
        ).first();
        ensure(
          a && a.status !== "Retired",
          "Account is retired or unavailable.",
        );
        const flow: Record<string, string[]> = {
          Available: [
            "Blocked",
            "Access Issue",
            "Funding Block",
            "Under Review",
            "Retired",
          ],
          Assigned: ["Cooldown", "Blocked", "Access Issue", "Under Review"],
          Cooldown: ["Available", "Blocked", "Retired"],
          // Unblocking: straight back to Available once the problem is fixed.
          Blocked: ["Available", "Under Review", "Retired"],
          "Access Issue": ["Available", "Under Review", "Retired"],
          "Funding Block": ["Available", "Under Review", "Retired"],
          "Under Review": ["Available", "Blocked", "Retired"],
        };
        ensure(
          flow[a.status]?.includes(x.status) && x.reason?.trim(),
          "Choose an allowed account transition and record a reason.",
        );
        if (x.status === "Available")
          ensure(
            !(await stmt(
              "SELECT id FROM gigs WHERE account_id=? AND status NOT IN ('Paid','Cancelled','Failed')",
              id,
            ).first()),
            "Close every active gig before returning this account to availability.",
          );
        jobs.push(
          stmt(
            "UPDATE accounts SET status=?,active_assignment=CASE WHEN ?='Available' THEN NULL ELSE active_assignment END WHERE id=?",
            x.status,
            x.status,
            id,
          ),
        );
        auditPrevious = a;
        break;
      }
      case "gig": {
        // A gig is recorded once it is paid, together with its proof: the
        // delivery screenshot and the payment screenshot. It enters review at
        // once, so there is no separate evidence step to forget.
        permit(u, ops);
        // The account the client paid from stands in for the gig's name.
        const paidBy = String(x.paid_by_account ?? x.title ?? "").trim().slice(0, 200);
        ensure(
          s && paidBy && x.platform && Number(x.value) > 0 && x.order_ref?.trim(),
          "Student, the account used to pay, platform, order number and value are required.",
        );
        // Services are recorded by the coordinators of the Service Team's
        // groups; Project Operations and administrators can record any.
        if (!can(u.roles, ["Project Operations", ...admin])) {
          const team: any = await stmt(
            "SELECT u.team FROM groups g JOIN users u ON u.id=g.supervisor WHERE g.id=?",
            s.group_id,
          ).first();
          ensure(team?.team === "Service Team", "Services are recorded by the coordinators of Service Team groups only.");
        }
        ensure(x.proof_id && x.payment_proof_id, "Upload the delivery proof and the payment proof.");
        ensure(x.payment_proof_id !== x.proof_id, "Delivery and payment proof must be separate uploaded records.");
        await proof(u, x.proof_id, sid);
        await proof(u, x.payment_proof_id, sid);
        await ensureUnusedProof([x.proof_id, x.payment_proof_id], null);
        // When the client paid: a real day, not in the future, and not before
        // the group began, so work from before the round does not count.
        const paidOn = String(x.paid_on || "").slice(0, 10);
        ensure(/^\d{4}-\d{2}-\d{2}$/.test(paidOn) && !Number.isNaN(Date.parse(paidOn)), "Enter the date the client paid.");
        ensure(paidOn <= programDay(t), "The payment date cannot be in the future.");
        const groupStart: any = await stmt("SELECT start_date FROM groups WHERE id=?", s.group_id).first();
        const started = String(groupStart?.start_date || "").slice(0, 10);
        ensure(!started || paidOn >= started, `The payment date must be on or after the day the group started (${started}).`);
        const orderRef = String(x.order_ref).trim();
        ensure(
          !(await stmt("SELECT id FROM gigs WHERE platform=? AND trim(order_ref)=?", x.platform, orderRef).first()),
          `Order ${orderRef} is already recorded on ${x.platform}.`,
        );
        const gig = { id, student_id: sid, account_id: null, platform: x.platform };
        jobs.push(
          stmt(
            "INSERT INTO gigs(id,student_id,platform,title,value,currency,order_ref,status,due,created_at,paid_on,paid_by_account) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            id,
            sid,
            x.platform,
            paidBy,
            Number(x.value),
            x.currency || "USD",
            orderRef,
            "Paid",
            paidOn,
            t,
            paidOn,
            paidBy,
          ),
          stmt(
            "INSERT INTO gig_events VALUES(?,?,?,?,?,?,?,?)",
            uid("GE"),
            id,
            "Paid",
            x.payment_proof_id,
            "STUDENT",
            u.id,
            paidOn,
            t,
          ),
          ...evidenceIntake(u, gig, s.policy_id, x, t, uid("EV")),
        );
        break;
      }
      case "fx_rate": {
        permit(u, ["Operations Systems / Admin"]);
        ensure(
          /^[A-Z]{3}$/.test(x.currency) &&
            x.currency !== "USD" &&
            Number(x.usd_rate) > 0 &&
            Date.parse(x.effective_date) &&
            x.source?.trim(),
          "Currency, positive USD rate, effective date and approved source are required.",
        );
        jobs.push(
          stmt(
            "INSERT INTO fx_rates(id,currency,usd_rate,effective_date,source,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
            id,
            x.currency,
            Number(x.usd_rate),
            x.effective_date,
            x.source,
            "Draft",
            u.id,
            t,
          ),
        );
        break;
      }
      case "fx_rate_approve": {
        permit(u, ["Project Operations"]);
        const rate: any = await stmt(
          "SELECT * FROM fx_rates WHERE id=?",
          id,
        ).first();
        ensure(
          rate && rate.status === "Draft",
          "Only a draft FX rate can be approved.",
        );
        ensure(
          rate.created_by !== u.id,
          "FX approval requires a different authorized staff member.",
        );
        ensure(x.reason?.trim(), "Record the FX approval reason.");
        auditPrevious = rate;
        jobs.push(
          stmt(
            "UPDATE fx_rates SET status='Approved',approved_by=? WHERE id=? AND status='Draft'",
            u.id,
            id,
          ),
        );
        break;
      }
      case "fx_apply": {
        permit(u, ["Project Operations"]);
        const gig: any = await stmt(
          "SELECT * FROM gigs WHERE id=?",
          x.gig_id,
        ).first();
        ensure(gig && gig.currency !== "USD", "Choose a non-USD gig.");
        await student(u, gig.student_id);
        const rate: any = await stmt(
          "SELECT * FROM fx_rates WHERE id=? AND currency=? AND status='Approved'",
          x.fx_rate_id,
          gig.currency,
        ).first();
        ensure(rate, "Choose an approved rate for the gig currency.");
        ensure(
          rate.effective_date <= gig.created_at.slice(0, 10),
          "The FX rate must be effective on or before the gig record date.",
        );
        const usd =
          Math.round(Number(gig.value) * Number(rate.usd_rate) * 100) / 100;
        ensure(usd > 0, "The converted USD value must be positive.");
        jobs.push(
          stmt(
            "INSERT INTO gig_fx_applications(gig_id,fx_rate_id,usd_value,applied_by,applied_at) VALUES(?,?,?,?,?) ON CONFLICT(gig_id) DO UPDATE SET fx_rate_id=excluded.fx_rate_id,usd_value=excluded.usd_value,applied_by=excluded.applied_by,applied_at=excluded.applied_at",
            gig.id,
            rate.id,
            usd,
            u.id,
            t,
          ),
        );
        sid = gig.student_id;
        break;
      }
      case "gig_transition": {
        permit(u, ops);
        const g: any = await stmt("SELECT * FROM gigs WHERE id=?", id).first();
        ensure(g, "Gig not found.");
        await student(u, g.student_id);
        await proof(u, x.proof_id, g.student_id);
        nextGig(g.status, x.status, true);
        ensure(
          x.occurred_at && Date.parse(x.occurred_at) <= Date.now() + 60000,
          "Record a valid activity timestamp.",
        );
        ensure(
          ["STUDENT", "CLIENT", "STAFF"].includes(x.performed_by || "STUDENT"),
          "Choose who performed the external activity.",
        );
        auditPrevious = g;
        jobs.push(
          stmt("UPDATE gigs SET status=? WHERE id=?", x.status, id),
          stmt(
            "INSERT INTO gig_events VALUES(?,?,?,?,?,?,?,?)",
            uid("GE"),
            id,
            x.status,
            x.proof_id,
            x.performed_by || "STUDENT",
            u.id,
            x.occurred_at,
            t,
          ),
          stmt(
            "UPDATE attachment_context SET gig_id=?,account_id=?,activity_type=?,platform=?,occurred_at=?,source=?,performed_by_type=?,performed_by_student_id=? WHERE attachment_id=?",
            id,
            g.account_id || null,
            x.status,
            g.platform,
            x.occurred_at,
            g.platform,
            x.performed_by || "STUDENT",
            (x.performed_by || "STUDENT") === "STUDENT" ? g.student_id : null,
            x.proof_id,
          ),
        );
        break;
      }
      case "refund_credit": {
        permit(u, ["Higher Board"]);
        const gig: any = await stmt(
          "SELECT * FROM gigs WHERE id=?",
          id,
        ).first();
        ensure(
          gig && ["Cancelled", "Failed"].includes(gig.status) && gig.account_id,
          "Only a cancelled or failed controlled-account gig can be refunded.",
        );
        await student(u, gig.student_id);
        ensure(x.reason?.trim(), "Record the approved refund reason.");
        const debit: any = await stmt(
          "SELECT * FROM account_credit_ledger WHERE gig_id=? AND delta<0 ORDER BY created_at LIMIT 1",
          gig.id,
        ).first();
        ensure(debit, "No account credit charge is linked to this gig.");
        ensure(
          !(await stmt(
            "SELECT id FROM account_credit_ledger WHERE gig_id=? AND delta>0",
            gig.id,
          ).first()),
          "This gig credit has already been refunded.",
        );
        const account: any = await stmt(
          "SELECT credits FROM accounts WHERE id=?",
          gig.account_id,
        ).first();
        const amount = Math.abs(Number(debit.delta));
        const balance = Number(account.credits) + amount;
        jobs.push(
          stmt(
            "UPDATE accounts SET credits=?,status=CASE WHEN status='Assigned' THEN 'Cooldown' ELSE status END WHERE id=?",
            balance,
            gig.account_id,
          ),
          stmt(
            "INSERT INTO account_credit_ledger(id,account_id,assignment_id,gig_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            uid("CR"),
            gig.account_id,
            debit.assignment_id,
            gig.id,
            amount,
            balance,
            x.reason.trim(),
            u.id,
            t,
          ),
        );
        sid = gig.student_id;
        auditValue = { ...auditValue, amount, balance_after: balance };
        break;
      }
      case "evidence": {
        permit(u, ops);
        const g: any = await stmt(
          "SELECT * FROM gigs WHERE id=?",
          x.gig_id,
        ).first();
        ensure(
          g && g.status === "Paid",
          "Evidence intake requires a completed, paid gig.",
        );
        // A recorded gig brings its evidence with it; this path is for a gig
        // that reached Paid step by step, and it takes one evidence record.
        ensure(
          !(await stmt("SELECT id FROM evidence WHERE gig_id=?", g.id).first()),
          "This gig already has its evidence in review.",
        );
        const st = await student(u, g.student_id);
        await proof(u, x.proof_id, g.student_id);
        await proof(u, x.payment_proof_id, g.student_id);
        await ensureUnusedProof([x.proof_id, x.payment_proof_id], null);
        ensure(x.source, "External source is required.");
        ensure(
          x.payment_proof_id !== x.proof_id,
          "Delivery and payment proof must be separate uploaded records.",
        );
        jobs.push(...evidenceIntake(u, g, st.policy_id, x, t, id));
        break;
      }
      case "review": {
        const e: any = await stmt(
          "SELECT * FROM evidence WHERE id=?",
          id,
        ).first();
        ensure(e, "Evidence not found.");
        const st = await student(u, e.student_id);
        const g: any = await stmt(
          "SELECT * FROM gigs WHERE id=?",
          e.gig_id,
        ).first();
        auditPrevious = e;
        let next = "";
        // Each decision is a different person's: not the one who recorded the
        // gig, and not anyone who already acted on this package. A correction
        // starts a new cycle, so the reviewer who asked for it may judge it.
        if (["Coordinator L1", "Quality Review", "L3 Review"].includes(e.status)) {
          ensure(e.recorder !== u.id, "You recorded this gig, so another person must review it.");
          const cycle = (await all(
            "SELECT actor, decision FROM evidence_reviews WHERE evidence_id=? ORDER BY created_at, id",
            id,
          )) as any[];
          const since = cycle.map((r) => r.decision).lastIndexOf("Rejected");
          ensure(
            !cycle.slice(since + 1).some((r) => r.actor === u.id),
            "You already acted on an earlier step of this evidence, so another person must take this one.",
          );
        }
        if (e.status === "Coordinator L1") {
          // The coordinator check, before Quality: the group's coordinator, its
          // supervisor or Project Operations, never the person who recorded it.
          // Coaches no longer check services.
          ensure(
            st.coordinator === u.id || st.supervisor === u.id || can(u.roles, ["Project Operations", "Operations Systems / Admin"]),
            "The coordinator check is done by the group's coordinator, its supervisor or Project Operations.",
          );
          next = "Quality Review";
        } else if (e.status === "Quality Review") {
          // The Quality decision belongs to the QC team: a member decides what
          // is assigned to them; the Quality Lead decides anything.
          permit(u, ["Quality Member", "Quality Lead"]);
          if (!can(u.roles, ["Quality Lead", "Operations Systems / Admin"]))
            ensure(
              e.qc_actor === u.id,
              e.qc_actor
                ? "This evidence is assigned to another reviewer."
                : "This evidence has not been assigned to you yet. The Quality Lead assigns reviews.",
            );
          ensure(
            ["Accept", "Reject", "Escalate L3"].includes(x.decision),
            "Choose a Quality decision.",
          );
          next =
            x.decision === "Accept"
              ? "Accepted"
              : x.decision === "Reject"
                ? "Rejected"
                : "L3 Review";
        } else if (e.status === "L3 Review") {
          permit(u, ["Project Operations", "Quality Lead"]);
          ensure(
            ["Accept", "Reject", "Final resolution"].includes(x.decision),
            "Choose a final Quality Lead decision.",
          );
          next =
            x.decision === "Accept"
              ? "Accepted"
              : x.decision === "Reject"
                ? "Rejected"
                : "Closed L3";
        } else if (e.status === "Rejected") {
          permit(u, ops);
          ensure(
            x.proof_id && x.payment_proof_id,
            "Upload corrected delivery and payment evidence to resubmit.",
          );
          await proof(u, x.proof_id, e.student_id);
          await proof(u, x.payment_proof_id, e.student_id);
          ensure(
            x.payment_proof_id !== x.proof_id,
            "Delivery and payment proof must be separate uploaded records.",
          );
          await ensureUnusedProof([x.proof_id, x.payment_proof_id], id);
          next =
            e.rejections >= 2 || ["EV06", "EV09"].includes(e.code)
              ? "L3 Review"
              : "Quality Review";
          const latest: any = await stmt(
            "SELECT coalesce(max(revision),0) revision FROM evidence_packages WHERE evidence_id=?",
            id,
          ).first();
          const evidencePackage = uid("EPK");
          jobs.push(
            stmt("UPDATE evidence SET proof_id=? WHERE id=?", x.proof_id, id),
            stmt(
              "INSERT INTO evidence_packages(id,evidence_id,revision,status,created_by,created_at) VALUES(?,?,?,'Resubmitted',?,?)",
              evidencePackage,
              id,
              Number(latest.revision) + 1,
              u.id,
              t,
            ),
            stmt(
              "INSERT INTO evidence_package_items VALUES(?,?,?,?,?)",
              uid("EPI"),
              evidencePackage,
              "Delivery",
              x.proof_id,
              t,
            ),
            stmt(
              "INSERT INTO evidence_package_items VALUES(?,?,?,?,?)",
              uid("EPI"),
              evidencePackage,
              "Payment",
              x.payment_proof_id,
              t,
            ),
          );
        } else if (e.status === "Accepted") {
          permit(u, ["Project Operations", "Quality Lead"]);
          ensure(
            x.decision === "Reopen" && x.notes?.trim(),
            "Reopening accepted evidence requires a documented reason.",
          );
          next = "L3 Review";
        } else
          throw new Error(
            "This evidence is not in an actionable review stage.",
          );
        ensure(x.notes?.trim(), "Record the review or correction guidance.");
        if (next === "Accepted") {
          ensure(g.status === "Paid", "Only paid gigs qualify.");
          const packageChecks: any = await stmt(
            "SELECT count(DISTINCT i.item_type) n FROM evidence_packages p JOIN evidence_package_items i ON i.package_id=p.id WHERE p.evidence_id=? AND p.revision=(SELECT max(revision) FROM evidence_packages WHERE evidence_id=?) AND i.item_type IN ('Delivery','Payment')",
            id,
            id,
          ).first();
          ensure(
            packageChecks?.n === 2,
            "The latest evidence package must contain delivery and payment proof.",
          );
          ensure(
            Array.isArray(x.checklist) &&
              x.checklist.length === 7 &&
              new Set(x.checklist).size === 7 &&
              [
                "Completeness",
                "Identity",
                "Delivery",
                "Payment/value",
                "Authenticity",
                "Source consistency",
                "Duplicate checks",
              ].every((c) => x.checklist.includes(c)),
            "Complete all seven Quality checks before acceptance.",
          );
          const a: any = await stmt(
            "SELECT hash FROM attachments WHERE id=?",
            e.proof_id,
          ).first();
          ensure(
            !(await stmt(
              "SELECT e.id FROM evidence e JOIN attachments a ON a.id=e.proof_id WHERE a.hash=? AND e.id<>? AND e.status='Accepted'",
              a.hash,
              id,
            ).first()),
            "Duplicate evidence detected. Escalate to Quality Lead.",
          );
        }
        if (next === "Rejected") {
          const reviewPolicy = await appliedPolicy(e.policy_id);
          ensure(
            rejectionCodes.some((c) => c.startsWith(x.code + " ")),
            "Select a structured rejection code.",
          );
          jobs.push(
            stmt(
              "UPDATE evidence SET rejections=rejections+1,code=?,requirements=? WHERE id=?",
              x.code,
              x.notes,
              id,
            ),
            stmt(
              "INSERT OR IGNORE INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)",
              uid("TSK"),
              e.student_id,
              "Correct " + x.code + ": " + x.notes,
              st.coordinator,
              new Date(
                Date.now() + reviewPolicy.correctionDays * 86400000,
              ).toISOString(),
              "Correction",
              "High",
              "Open",
              "correction-" + id + "-" + (e.rejections + 1),
              t,
            ),
          );
          if (e.rejections >= 1 || ["EV06", "EV09"].includes(x.code))
            jobs.push(
              stmt(
                "INSERT OR IGNORE INTO cases(id,student_id,title,type,severity,status,owner,due,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                uid("CASE"),
                e.student_id,
                "L3 evidence investigation · " + x.code,
                "Quality",
                "S1 Critical",
                "Open",
                u.id,
                new Date(Date.now() + 2 * 86400000).toISOString(),
                "L3-" + id,
                t,
              ),
            );
        }
        if (["Accepted", "Rejected", "Closed L3"].includes(next))
          jobs.push(
            stmt(
              "UPDATE evidence_packages SET status=? WHERE id=(SELECT id FROM evidence_packages WHERE evidence_id=? ORDER BY revision DESC LIMIT 1)",
              next,
              id,
            ),
          );
        jobs.push(
          stmt(
            "UPDATE evidence SET status=?,stage_at=? WHERE id=?",
            next,
            t,
            id,
          ),
          // Arriving at the QC team, the evidence goes to the member holding
          // the fewest; a correction stays with the reviewer who asked for it.
          ...(next === "Quality Review" && !e.qc_actor
            ? await (async () => {
                const reviewer = await leastLoadedEvidenceReviewer();
                return reviewer ? [stmt("UPDATE evidence SET qc_actor=? WHERE id=?", reviewer, id)] : [];
              })()
            : []),
          stmt(
            "INSERT INTO evidence_reviews VALUES(?,?,?,?,?,?,?)",
            uid("REV"),
            id,
            u.id,
            next,
            x.code || null,
            x.notes,
            t,
          ),
        );
        if (["Accepted", "Closed L3"].includes(next))
          jobs.push(
            stmt(
              "UPDATE tasks SET status='Completed' WHERE category='Correction' AND source LIKE ?",
              "correction-" + id + "-%",
            ),
          );
        sid = e.student_id;
        break;
      }
      case "case": {
        permit(u, [...roles.filter((r) => r !== "Operations Systems / Admin")]);
        ensure(
          x.title?.trim() && x.owner && Date.parse(x.due),
          "Case title, owner and due date are required.",
        );
        ensure(String(x.title).length <= 200 && String(x.notes || "").length <= 2000, "Keep the title under 200 characters and the notes under 2,000.");
        // Every case says what happened (decided 10 Oct 2026).
        ensure(String(x.notes || "").trim().length >= 5, "Write a comment explaining the case.");
        // A case names its group when it has one, so it stays with that group's
        // people; one about the whole programme has neither student nor group,
        // and a demo account may not open those.
        let caseGroup: string | null = s?.group_id || null;
        if (!caseGroup && x.group_id) {
          const scope = scopeSql(u, "g", null);
          const g: any = await stmt(`SELECT g.id FROM groups g WHERE g.id=? AND ${scope.sql}`, x.group_id, ...scope.args).first();
          ensure(g, "Group not found within your assigned scope.");
          caseGroup = g.id;
        }
        if (isDemo(u)) ensure(caseGroup && caseGroup.startsWith("DEMO-"), "In the demo, a case is about a demo student or group.");
        jobs.push(
          stmt(
            "INSERT INTO cases(id,student_id,group_id,title,type,severity,status,owner,due,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            id,
            sid || null,
            caseGroup,
            x.title,
            x.type || "Student",
            x.severity || "S3 Standard",
            "Open",
            x.owner,
            x.due,
            t,
          ),
          stmt(
            "INSERT INTO case_events VALUES(?,?,?,?,?,?)",
            uid("CASEEV"),
            id,
            "Open",
            u.id,
            String(x.notes).trim(),
            t,
          ),
        );
        // Coach Operations hears about every new case at once.
        {
          const people = await all(`SELECT id,roles FROM users WHERE active=1 AND ${sameSide(u, "id")}`);
          for (const p of people) {
            const held = typeof p.roles === "string" ? JSON.parse(p.roles || "[]") : p.roles || [];
            if (held.includes("Coach Operations") && p.id !== u.id)
              jobs.push(notify(p.id, `New case: ${String(x.title).trim()}`, sid ? "student" : "case", sid || id, x.severity === "S1 Critical" || x.severity === "S2 High" ? "Urgent" : "Action Required", `case-new:${id}:${p.id}`));
          }
        }
        break;
      }
      case "case_transition": {
        const c: any = await stmt("SELECT * FROM cases WHERE id=?", id).first();
        ensure(c, "Case not found.");
        if (c.student_id) await student(u, c.student_id);
        ensure(
          c.owner === u.id ||
            can(u.roles, [
              "Project Operations",
              "Team Supervisor",
              "Quality Lead",
            ]),
          "Only the case owner or responsible supervisor can change this case.",
        );
        if (c.type === "Quality") permit(u, ["Quality Lead"]);
        const states = [
          "Open",
          "Triaged",
          "Assigned",
          "In Progress",
          "Waiting",
          "Resolved",
          "Verified",
          "Closed",
        ];
        ensure(
          states.indexOf(x.status) === states.indexOf(c.status) + 1,
          "Complete the previous case stage first.",
        );
        if (["Resolved", "Verified", "Closed"].includes(x.status))
          ensure(
            x.resolution && x.root_cause && x.prevention,
            "Resolution, root cause and preventive action are required.",
          );
        if (x.status === "Verified")
          ensure(
            u.id !== c.owner,
            "Verification requires another authorized staff member.",
          );
        jobs.push(
          stmt(
            "UPDATE cases SET status=?,resolution=?,root_cause=?,prevention=?,verifier=? WHERE id=?",
            x.status,
            x.resolution || c.resolution,
            x.root_cause || c.root_cause,
            x.prevention || c.prevention,
            x.status === "Verified" ? u.id : c.verifier,
            id,
          ),
          stmt(
            "INSERT INTO case_events VALUES(?,?,?,?,?,?)",
            uid("CASEEV"),
            id,
            x.status,
            u.id,
            x.resolution || x.reason || "Case stage updated",
            t,
          ),
        );
        auditPrevious = c;
        break;
      }
      case "saved_view": {
        ensure(
          x.module?.trim() &&
            x.name?.trim() &&
            x.filters &&
            typeof x.filters === "object",
          "Module, name and filters are required.",
        );
        ensure(
          JSON.stringify(x.filters).length < 4000,
          "Saved view filters are too large.",
        );
        jobs.push(
          stmt(
            "INSERT INTO saved_views(id,user_id,module,name,filters,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,module,name) DO UPDATE SET filters=excluded.filters",
            id,
            u.id,
            x.module,
            x.name,
            JSON.stringify(x.filters),
            t,
          ),
        );
        break;
      }
      case "group_gate": {
        // The weekly group gate is the administrators' check.
        permit(u, admin);
        ensure(
          x.group_id &&
            Number.isInteger(+x.week) &&
            +x.week >= 0 &&
            +x.week <= 8 &&
            x.check_key?.trim() &&
            ["Pending", "Complete", "Exception"].includes(x.status) &&
            x.owner &&
            Date.parse(x.due),
          "Group, week, checkpoint, status, owner and due date are required.",
        );
        const group: any = await stmt(
          "SELECT * FROM groups WHERE id=?",
          x.group_id,
        ).first();
        ensure(group, "Group not found.");
        if (!can(u.roles, ["Project Operations"]))
          ensure(
            group.supervisor === u.id || can(u.roles, ["Coach Operations"]),
            "This group is outside your control scope.",
          );
        if (x.evidence_id)
          ensure(
            await stmt(
              "SELECT id FROM attachments WHERE id=?",
              x.evidence_id,
            ).first(),
            "Checkpoint evidence was not found.",
          );
        jobs.push(
          stmt(
            "INSERT INTO group_gate_checks(id,group_id,week,check_key,status,evidence_id,owner,due,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(group_id,week,check_key) DO UPDATE SET status=excluded.status,evidence_id=excluded.evidence_id,owner=excluded.owner,due=excluded.due,updated_at=excluded.updated_at",
            id,
            x.group_id,
            +x.week,
            x.check_key,
            x.status,
            x.evidence_id || null,
            x.owner,
            x.due,
            t,
          ),
        );
        break;
      }
      case "staff": {
        permit(u, admin);
        ensure(
          x.email?.includes("@") &&
            x.name &&
            Array.isArray(x.roles) &&
            x.roles.length &&
            x.roles.every((r: string) => roles.includes(r)),
          "Staff name, email and valid roles are required.",
        );
        // The national ID is what a new person signs in with, so it is stored
        // with the record rather than kept in somebody's spreadsheet. The phone
        // number belongs with it: a coordinator is reached by phone far more
        // often than by email.
        const nationalId = normalizeNationalId(x.national_id);
        ensure(!x.national_id || isNationalId(nationalId), nationalIdProblem(x.national_id) || "Check the national ID.");
        const phone = normalizePhone(x.phone);
        ensure(phone.length <= 40, "Phone number is too long.");
        // Title is free text; Team is one of two, never typed.
        const title = x.title === undefined ? undefined : String(x.title || "").trim().slice(0, 120) || null;
        const team = x.team === undefined ? undefined : String(x.team || "").trim() || null;
        ensure(team === undefined || team === null || ["Target Team", "Service Team"].includes(team), "Choose the Target Team or the Service Team.");
        ensure(x.reason?.trim(), "Document the access change reason.");
        const email = String(x.email).trim().toLowerCase();
        const old: any = await stmt(
          "SELECT * FROM users WHERE lower(email)=?",
          email,
        ).first();
        // Access can be withdrawn as well as granted, because a coordinator
        // who leaves must stop being able to reach their students. Withdrawing
        // your own is refused: only an administrator reaches this action, so a
        // person removing themselves could be the last one holding it.
        const withdrawn = new Set(["0", "false", "inactive", "withdrawn", "no"]);
        const stated = x.active === undefined || String(x.active).trim() === "" ? null : String(x.active).trim().toLowerCase();
        const active = stated === null ? (old ? Number(old.active) : 1) : withdrawn.has(stated) ? 0 : 1;
        if (nationalId)
          ensure(
            !(await stmt(
              "SELECT id FROM users WHERE trim(national_id)=? AND id<>?",
              nationalId,
              old?.id || "",
            ).first()),
            "Another member of staff is recorded with this national ID.",
          );
        if (old && Number(old.active) === 1 && active === 0)
          ensure(old.id !== u.id, "You cannot withdraw your own access.");
        if (old) {
          auditPrevious = old;
          jobs.push(
            stmt(
              "UPDATE users SET name=?,roles=?,active=?,national_id=coalesce(?,national_id),phone=coalesce(?,phone),title=?,team=? WHERE id=?",
              x.name,
              JSON.stringify(x.roles),
              active,
              nationalId || null,
              phone || null,
              title === undefined ? old.title ?? null : title,
              team === undefined ? old.team ?? null : team,
              old.id,
            ),
          );
        } else
          jobs.push(
            stmt(
              "INSERT INTO users(id,email,name,roles,scopes,active,national_id,phone,title,team) VALUES(?,?,?,?,?,?,?,?,?,?)",
              uid("USR"),
              email,
              x.name,
              JSON.stringify(x.roles),
              "[]",
              active,
              nationalId || null,
              phone || null,
              title ?? null,
              team ?? null,
            ),
          );
        // Recorded on the audit entry so an administrator can see whether the
        // person can sign in yet, or is only listed.
        auditValue = {
          ...auditValue,
          national_id: nationalId ? "recorded" : "missing",
          title_change: old && title !== undefined && (old.title ?? null) !== title ? { from: old.title ?? null, to: title } : undefined,
          team_change: old && team !== undefined && (old.team ?? null) !== team ? { from: old.team ?? null, to: team } : undefined,
          phone: phone ? "recorded" : "missing",
          sign_in_reset: x.reset_sign_in ? true : undefined,
        };
        signIn = {
          email,
          nationalId: nationalId || String(old?.national_id || ""),
          name: String(x.name),
          active: active === 1,
          reset: x.reset_sign_in === true || x.reset_sign_in === "Reset to the national ID",
        };
        break;
      }
      case "policy": {
        permit(u, admin);
        ensure(
          x.name && x.reason?.trim(),
          "Policy name and change reason are required.",
        );
        const config = validatePolicy(x.config || {});
        jobs.push(
          stmt(
            "INSERT INTO policies VALUES(?,?,?,?,?,?,?)",
            id,
            x.name,
            "Draft",
            JSON.stringify(config),
            u.id,
            null,
            t,
          ),
        );
        break;
      }
      case "policy_edit": {
        permit(u, admin);
        const p: any = await stmt(
          "SELECT * FROM policies WHERE id=?",
          id,
        ).first();
        ensure(
          p && p.status === "Draft",
          "Only draft policy contents can be edited.",
        );
        ensure(x.reason?.trim(), "Record the policy change reason.");
        const config = validatePolicy(x.config || {});
        auditPrevious = p;
        jobs.push(
          stmt(
            "UPDATE policies SET config=? WHERE id=? AND status='Draft'",
            JSON.stringify(config),
            id,
          ),
        );
        break;
      }
      case "policy_check": {
        return Response.json({ ok: true, summary: await policyChecks(u, key) });
      }
      // One student's three services are one piece of work, held by one
      // quality reviewer. They decide each link on its own; the team leader can
      // decide any of them, because the queue is theirs to balance.
      case "service_qc_review": {
        permit(u, quality);
        const link: any = await stmt(
          "SELECT * FROM service_links WHERE id=?",
          x.service_id || id,
        ).first();
        ensure(link, "Service link not found.");
        ensure(
          ["Lock", "Needs Correction"].includes(x.decision),
          "Choose Lock or Needs Correction.",
        );
        const comment = String(x.comment || "").trim();
        ensure(comment.length <= 1000, "Review comments must be 1,000 characters or fewer.");
        ensure(
          x.decision === "Lock" || comment,
          "Add a correction comment for the student.",
        );
        // A locked link stays locked and a link the automatic gate failed
        // cannot be locked by anyone: the student corrects it and submits
        // again. There is no override.
        ensure(link.qc_status !== "Locked", "This service link is already locked. The student submits a new link instead.");
        // A reviewer decides only what was handed to them, automatically or by
        // the Quality Lead; work nobody holds yet waits for the leader to assign.
        ensure(
          link.qc_actor === u.id || can(u.roles, ["Quality Lead", "Operations Systems / Admin"]),
          link.qc_actor
            ? "This student is assigned to another reviewer."
            : "This student has not been assigned to you yet. The Quality Lead assigns reviews.",
        );
        ensure(
          link.auto_status !== "Failed" || x.decision === "Needs Correction",
          "The automatic check failed for this link, so it can only be returned for correction.",
        );
        const next = x.decision === "Lock" ? "Locked" : "Needs Correction";
        auditValue = {
          service_id: link.id,
          student_id: link.student_id,
          decision: next,
          comment,
        };
        sid = link.student_id;
        s = await student(u, sid);
        auditPrevious = link;
        jobs.push(
          stmt(
            "UPDATE service_links SET qc_status=?,qc_comment=?,qc_actor=?,qc_at=?,updated_at=? WHERE id=? AND qc_status<>'Locked'",
            next,
            comment || null,
            u.id,
            t,
            t,
            link.id,
          ),
          stmt(
            "INSERT INTO service_link_reviews(id,service_link_id,revision,decision,comment,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?)",
            uid("SLR"),
            link.id,
            link.revision,
            next,
            comment || "Verified in coordinator review.",
            u.id,
            t,
          ),
          stmt(
            `UPDATE service_submissions SET status=CASE
               WHEN (SELECT count(*) FROM service_links WHERE student_id=? AND qc_status='Locked')=3 THEN 'Complete'
               WHEN EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND qc_status='Needs Correction') THEN 'Needs Correction'
               ELSE 'Pending QC' END,
               qc_completed_at=CASE WHEN (SELECT count(*) FROM service_links WHERE student_id=? AND qc_status='Locked')=3 THEN ? ELSE NULL END,
               updated_at=? WHERE student_id=?`,
            link.student_id,
            link.student_id,
            link.student_id,
            t,
            t,
            link.student_id,
          ),
          stmt(
            `INSERT OR IGNORE INTO notifications(id,recipient,title,entity_type,entity_id,severity,source,created_at,read_at)
             SELECT ?||'-'||id,id,?,'student',?,'Information',?||':'||id,?,NULL
             FROM users WHERE active=1 AND id IN (
               SELECT coordinator FROM groups WHERE id=(SELECT group_id FROM students WHERE id=?)
               UNION SELECT supervisor FROM groups WHERE id=(SELECT group_id FROM students WHERE id=?)
             )`,
            uid("NTF"),
            next === "Locked" ? "Student service link approved" : "Student service link rejected",
            link.student_id,
            `service-review:${link.id}:${link.revision}:${next}`,
            t,
            link.student_id,
            link.student_id,
          ),
        );
        break;
      }
      // A lead hands out the open quality work, evenly. Passing a reviewer
      // assigns just that item; passing none distributes the whole queue.
      case "service_qc_assign":
      case "evidence_qc_assign": {
        permit(u, ["Quality Lead"]);
        const services = x.action === "service_qc_assign";
        const table = services ? "service_links" : "evidence";
        const openFilter = services ? "qc_status<>'Locked'" : "status='Quality Review'";
        // The team leader does not carry a share of the reviewing, so the pool
        // for service work is the members. Gig evidence keeps its wider pool.
        const reviewers = (await (await stmt(
          `SELECT id FROM users WHERE active=1 AND roles LIKE '%Quality Member%' AND roles NOT LIKE '%Quality Lead%' AND ${sameSide(u, "id")} ORDER BY id`,
        ).all()).results) as any[];
        ensure(reviewers.length, "Add an active Quality Member before assigning reviews.");
        if (x.reviewer_id) {
          ensure(reviewers.some((r) => r.id === x.reviewer_id), "Choose an active Quality reviewer.");
          // Moving a student moves everything of theirs that is still open, so
          // their three services never end up split between two reviewers.
          if (services && x.student_id) {
            const student: any = await stmt(
              "SELECT student_id, count(*) n FROM service_links WHERE student_id=? AND qc_status<>'Locked' GROUP BY student_id",
              x.student_id,
            ).first();
            ensure(student, "That student has no open services to assign.");
            auditValue = { student_id: x.student_id, assigned_to: x.reviewer_id, links: Number(student.n), mode: "manual" };
            jobs.push(
              stmt(
                "UPDATE service_links SET qc_actor=?,updated_at=? WHERE student_id=? AND qc_status<>'Locked'",
                x.reviewer_id,
                t,
                x.student_id,
              ),
            );
            break;
          }
          const item: any = await stmt(`SELECT * FROM ${table} WHERE id=?`, x.item_id || id).first();
          ensure(item, "That review item was not found.");
          auditPrevious = item;
          auditValue = { item_id: item.id, assigned_to: x.reviewer_id, mode: "manual" };
          if (services) {
            auditValue = { student_id: item.student_id, assigned_to: x.reviewer_id, mode: "manual" };
            jobs.push(
              stmt(
                "UPDATE service_links SET qc_actor=?,updated_at=? WHERE student_id=? AND qc_status<>'Locked'",
                x.reviewer_id,
                t,
                item.student_id,
              ),
            );
            break;
          }
          jobs.push(stmt(`UPDATE ${table} SET qc_actor=? WHERE id=?`, x.reviewer_id, item.id));
          break;
        }
        const load = await Promise.all(
          reviewers.map(async (r) => ({
            id: r.id,
            open: Number(
              ((await stmt(
                services
                  ? `SELECT count(DISTINCT student_id) n FROM ${table} WHERE qc_actor=? AND ${openFilter}`
                  : `SELECT count(*) n FROM ${table} WHERE qc_actor=? AND ${openFilter}`,
                r.id,
              ).first()) as any)?.n || 0,
            ),
          })),
        );
        const pending = (await (await stmt(
          services
            ? `SELECT DISTINCT student_id id FROM ${table} WHERE qc_actor IS NULL AND ${openFilter} ORDER BY student_id`
            : `SELECT id FROM ${table} WHERE qc_actor IS NULL AND ${openFilter} ORDER BY id`,
        ).all()).results) as any[];
        ensure(pending.length, services ? "Every student waiting for review already has a reviewer." : "Every open review already has a reviewer.");
        const allocations = distributeEvenly(pending.map((r) => String(r.id)), load);
        for (const allocation of allocations) {
          jobs.push(
            services
              ? stmt(
                  `UPDATE ${table} SET qc_actor=?,updated_at=? WHERE student_id=? AND qc_actor IS NULL AND ${openFilter}`,
                  allocation.reviewerId,
                  t,
                  allocation.itemId,
                )
              : stmt(`UPDATE ${table} SET qc_actor=? WHERE id=? AND qc_actor IS NULL`, allocation.reviewerId, allocation.itemId),
          );
        }
        auditValue = {
          assigned: allocations.length,
          unit: services ? "students" : "items",
          reviewers: load.length,
          spread: spread(load, allocations),
          mode: "even",
        };
        break;
      }
      case "load_demo_data": {
        permit(u, admin);
        const initialized = await stmt(
          "SELECT id FROM audit_events WHERE action='Blank production workspace initialized' LIMIT 1",
        ).first();
        ensure(
          initialized,
          "Synthetic data can only be appended to a blank production workspace.",
        );
        const footprint: any = await stmt(
          `SELECT
            (SELECT count(*) FROM users WHERE id<>?) +
            (SELECT count(*) FROM groups) +
            (SELECT count(*) FROM students) +
            (SELECT count(*) FROM tracks) +
            (SELECT count(*) FROM task_bank) +
            (SELECT count(*) FROM accounts) +
            (SELECT count(*) FROM sessions) +
            (SELECT count(*) FROM applications) +
            (SELECT count(*) FROM attachments) +
            (SELECT count(*) FROM contacts) +
            (SELECT count(*) FROM gigs) +
            (SELECT count(*) FROM evidence) +
            (SELECT count(*) FROM cases) AS n`,
          u.id,
        ).first();
        ensure(
          Number(footprint?.n) === 0,
          "This workspace already contains operational records, so synthetic data was not added.",
        );
        ensure(
          await stmt(
            "SELECT id FROM policies WHERE id='R5-v1' AND status='Effective'",
          ).first(),
          "The effective Round 5 policy is required before loading the pilot.",
        );
        await seed(u, "demo", true, key);
        return Response.json({
          ok: true,
          summary: {
            students: 1000,
            groups: 40,
            sessions: 40,
            evidence: 7,
            cases: 3,
          },
        });
      }
      case "policy_transition": {
        permit(u, ["Project Operations"]);
        const p: any = await stmt(
          "SELECT * FROM policies WHERE id=?",
          id,
        ).first();
        ensure(p, "Policy not found.");
        const states = [
          "Draft",
          "Reviewed",
          "Approved",
          "Effective",
          "Superseded",
        ];
        ensure(
          states.indexOf(x.status) === states.indexOf(p.status) + 1,
          "Follow the policy review and approval sequence.",
        );
        ensure(x.reason?.trim(), "Record the policy decision reason.");
        if (x.status === "Approved")
          ensure(
            p.created_by !== u.id,
            "Approval requires a different Project Operations user.",
          );
        jobs.push(
          stmt(
            "UPDATE policies SET status=?,approved_by=CASE WHEN ?='Approved' THEN ? ELSE approved_by END WHERE id=?",
            x.status,
            x.status,
            u.id,
            id,
          ),
        );
        break;
      }
      case "group_close": {
        permit(u, ["Project Operations"]);
        const g: any = await stmt(
          "SELECT * FROM groups WHERE id=?",
          id,
        ).first();
        ensure(
          g?.status === "Active" && x.reason?.trim(),
          "An active group and closure reason are required.",
        );
        ensure(
          !(await stmt(
            "SELECT id FROM students WHERE group_id=? AND lifecycle IN ('Active','Paused')",
            id,
          ).first()),
          "Close or transfer every active or paused learner before group closure.",
        );
        ensure(
          !(await stmt(
            "SELECT t.id FROM tasks t JOIN students s ON s.id=t.student_id WHERE s.group_id=? AND t.status='Open'",
            id,
          ).first()),
          "Resolve all open student actions before group closure.",
        );
        ensure(
          !(await stmt(
            "SELECT c.id FROM cases c JOIN students s ON s.id=c.student_id WHERE s.group_id=? AND c.status<>'Closed'",
            id,
          ).first()),
          "Close all student cases before group closure.",
        );
        ensure(
          !(await stmt(
            "SELECT z.id FROM gigs z JOIN students s ON s.id=z.student_id WHERE s.group_id=? AND z.status NOT IN ('Paid','Cancelled','Failed')",
            id,
          ).first()),
          "Resolve all active gigs before group closure.",
        );
        ensure(
          !(await stmt(
            "SELECT e.id FROM evidence e JOIN students s ON s.id=e.student_id WHERE s.group_id=? AND e.status NOT IN ('Accepted','Closed L3')",
            id,
          ).first()),
          "Resolve all evidence reviews before group closure.",
        );
        const snapshot: any = await stmt(
          `SELECT
            (SELECT count(*) FROM students WHERE group_id=?) students,
            (SELECT count(*) FROM students WHERE group_id=? AND lifecycle='Graduate Closed') graduates,
            (SELECT count(*) FROM students WHERE group_id=? AND lifecycle='Non-Graduate Closed') non_graduates,
            (SELECT count(*) FROM students WHERE group_id=? AND lifecycle='Withdrawn') withdrawn,
            (SELECT count(*) FROM certificates c JOIN students s ON s.id=c.student_id WHERE s.group_id=?) certificates`,
          id,
          id,
          id,
          id,
          id,
        ).first();
        jobs.push(
          stmt("UPDATE groups SET status='Closed' WHERE id=?", id),
          stmt(
            "INSERT INTO group_closures VALUES(?,?,?,?,?,?,?)",
            uid("GCL"),
            id,
            "Closed",
            JSON.stringify({ ...snapshot, captured_at: t }),
            x.reason.trim(),
            u.id,
            t,
          ),
        );
        break;
      }
      case "group_archive": {
        permit(u, ["Project Operations"]);
        const g: any = await stmt(
          "SELECT * FROM groups WHERE id=?",
          id,
        ).first();
        ensure(
          g?.status === "Closed" && x.reason?.trim(),
          "Only a closed group can be archived.",
        );
        ensure(
          await stmt(
            "SELECT id FROM group_closures WHERE group_id=? AND action='Closed'",
            id,
          ).first(),
          "The closure reconciliation snapshot is missing.",
        );
        jobs.push(
          stmt("UPDATE groups SET status='Archived' WHERE id=?", id),
          stmt(
            "INSERT INTO group_closures VALUES(?,?,?,?,?,?,?)",
            uid("GCL"),
            id,
            "Archived",
            JSON.stringify({ archived_from: "Closed", captured_at: t }),
            x.reason.trim(),
            u.id,
            t,
          ),
        );
        break;
      }
      default:
        throw new Error("This operation is not supported.");
    }
    if (sid && ["review", "gig_transition", "fx_apply"].includes(x.action))
      jobs.push(graduationStmt(sid));
    jobs.push(
      auditStmt(
        u,
        x.action,
        id,
        auditValue,
        auditPrevious,
        key,
        x.reason || null,
      ),
    );
    await db().batch(jobs);
    // The record exists; now make sure the person can get in. This runs after
    // the write so a failure here leaves a listed member of staff rather than
    // an account with no record, and it is reported instead of thrown: the
    // access change itself has already succeeded.
    if (signIn) {
      try {
        const outcome = await provisionStaffLogin(signIn.email, signIn.nationalId, signIn.name, signIn.active, signIn.reset);
        if (outcome === "created" || outcome === "suspended" || outcome === "restored" || outcome === "reset")
          return Response.json({ ok: true, sign_in: outcome });
        if (outcome === "skipped" && signIn.active && !signIn.nationalId)
          return Response.json({
            ok: true,
            sign_in: "no_national_id",
            notice: "Saved. Add this person's national ID to give them a way to sign in.",
          });
      } catch (e: any) {
        return Response.json({ ok: true, sign_in: "failed", notice: e.message });
      }
    }
    return Response.json({ ok: true });
  } catch (e: any) {
    const message = /UNIQUE constraint/.test(e.message)
      ? "A duplicate record or concurrent assignment was blocked. Refresh and review the existing record."
      : /FOREIGN KEY/.test(e.message)
        ? "A linked record does not exist. Check the selected student, owner and group."
        : e.message;
    return Response.json({ error: message }, { status: 400 });
  }
}
