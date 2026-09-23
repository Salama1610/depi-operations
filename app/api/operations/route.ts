import { policyChecks } from "@/lib/automation";
import { distributeEvenly, spread } from "@/lib/domain/qc-assignment";
import {
  loadTimings,
  actor,
  identity,
  stmt,
  db,
  now,
  uid,
  student,
  proof,
  permit,
  auditStmt,
  loadData,
  graduationStmt,
  appliedPolicy,
  rateLimit,
} from "@/lib/server";
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
import { seed } from "@/lib/seed";
export const dynamic = "force-dynamic";
const ops = ["Project Operations", "Operations Coordinator"];
// Who reviews a student's work in this application. The quality team tracks
// programme activities in a separate system, so inside this workspace the
// coordinator is the reviewer, covered by the supervisor above them.
const reviewers = [...ops, "Team Supervisor"];
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

async function validateSessionSlot(x: any, excludeId?: string) {
  ensure(
    x.group_id && x.coach_id && x.title?.trim() && x.starts_at,
    "Group, assigned coach, title and date are required.",
  );
  const group: any = await stmt(
    "SELECT g.*,p.config policy_config FROM groups g JOIN policies p ON p.id=g.policy_id WHERE g.id=? AND g.status='Active'",
    x.group_id,
  ).first();
  ensure(group, "Choose an active group.");
  const assigned = await stmt(
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
  const coachConflict = await stmt(
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
    let auditValue: any = { ...x };
    delete auditValue.request_id;
    switch (x.action) {
      case "contact": {
        permit(u, ops);
        validateContact(x);
        await proof(u, x.proof_id, sid);
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
            x.proof_id,
            x.next_action,
            x.owner,
            x.due,
            x.notes || "",
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
            x.proof_id,
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
        permit(u, ["Project Operations", ...admin]);
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
          ["Regular", "Industry"].includes(deliveryModel),
          "Choose the Regular or Industry delivery model.",
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
        permit(u, ["Coach Operations", "Project Operations"]);
        const session = await validateSessionSlot(x);
        jobs.push(
          stmt(
            "INSERT INTO sessions(id,group_id,coach_id,title,starts_at,session_day,duration_minutes,status,week,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            id,
            x.group_id,
            x.coach_id,
            x.title.trim(),
            session.startsAt,
            session.day,
            session.duration,
            "Scheduled",
            session.week,
            t,
          ),
        );
        break;
      }
      case "session_confirm": {
        permit(u, ["Coach"]);
        const session: any = await stmt(
          "SELECT * FROM sessions WHERE id=?",
          id,
        ).first();
        ensure(session, "Session not found.");
        ensure(
          session.coach_id === u.id,
          "Only the coach assigned to this session can confirm it.",
        );
        ensure(
          session.status === "Scheduled",
          "Only a scheduled session can be confirmed.",
        );
        auditPrevious = session;
        jobs.push(
          stmt(
            "UPDATE sessions SET status='Confirmed',confirmed_at=?,updated_at=? WHERE id=?",
            t,
            t,
            id,
          ),
        );
        break;
      }
      case "session_reschedule": {
        permit(u, ["Coach Operations", "Project Operations"]);
        const current: any = await stmt(
          "SELECT * FROM sessions WHERE id=?",
          id,
        ).first();
        ensure(
          current && ["Scheduled", "Confirmed"].includes(current.status),
          "Only a scheduled or confirmed session can be rescheduled.",
        );
        ensure(
          x.reason?.trim().length >= 5,
          "Record a rescheduling reason.",
        );
        const session = await validateSessionSlot(
          {
            ...x,
            group_id: current.group_id,
            title: current.title,
            coach_id: x.coach_id || current.coach_id,
            week: current.week,
            duration_minutes: current.duration_minutes,
          },
          id,
        );
        auditPrevious = current;
        jobs.push(
          stmt(
            "UPDATE sessions SET coach_id=?,starts_at=?,session_day=?,status='Scheduled',confirmed_at=NULL,cancel_reason=NULL,updated_at=? WHERE id=?",
            x.coach_id || current.coach_id,
            session.startsAt,
            session.day,
            t,
            id,
          ),
        );
        break;
      }
      case "session_cancel": {
        permit(u, ["Coach Operations", "Project Operations"]);
        const current: any = await stmt(
          "SELECT * FROM sessions WHERE id=?",
          id,
        ).first();
        ensure(
          current && ["Scheduled", "Confirmed"].includes(current.status),
          "Only a scheduled or confirmed session can be cancelled.",
        );
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
        );
        break;
      }
      case "attendance": {
        permit(u, ["Coach", "Coach Operations", "Project Operations"]);
        const session: any = await stmt(
          "SELECT * FROM sessions WHERE id=?",
          x.session_id,
        ).first();
        ensure(
          session && s && session.group_id === s.group_id,
          "Student must belong to the session group.",
        );
        ensure(
          session.status !== "Cancelled" && session.starts_at <= t,
          "Attendance can only be recorded after a non-cancelled session starts.",
        );
        if (
          can(u.roles, ["Coach"]) &&
          !can(u.roles, ["Coach Operations", "Project Operations"])
        )
          ensure(
            !session.coach_id || session.coach_id === u.id,
            "Only the coach assigned to this session can record attendance.",
          );
        ensure(
          ["Present", "Absent", "Late", "Excused"].includes(x.status),
          "Invalid attendance status.",
        );
        jobs.push(
          stmt(
            "INSERT INTO attendance VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status,recorder=excluded.recorder,source=excluded.source,updated_at=excluded.updated_at",
            uid("ATT"),
            x.session_id,
            sid,
            x.status,
            u.id,
            x.source || "Staff entry",
            t,
          ),
        );
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
        permit(u, ["Higher Board"]);
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
        permit(u, ops);
        ensure(
          s &&
            x.task_bank_id &&
            x.job_profile?.trim() &&
            Number.isInteger(+x.gig_number) &&
            +x.gig_number >= 1 &&
            +x.gig_number <= 3,
          "Student, approved task, job profile and gig number 1–3 are required.",
        );
        const g: any = await stmt(
          "SELECT track,pathway FROM groups WHERE id=?",
          s.group_id,
        ).first();
        ensure(
          g?.pathway === "Support",
          "Controlled account requests are available only for the Support / Internal-Service pathway.",
        );
        const task: any = await stmt(
          "SELECT * FROM task_bank WHERE id=? AND active=1",
          x.task_bank_id,
        ).first();
        ensure(
          task &&
            task.track === g.track &&
            controlledPlatforms.includes(task.platform),
          "Choose an active task approved for this student track and controlled platform.",
        );
        ensure(
          !(await stmt(
            "SELECT r.id FROM account_requests r JOIN account_request_details d ON d.request_id=r.id WHERE r.student_id=? AND d.gig_number=? AND r.status NOT IN ('Rejected','Cancelled')",
            sid,
            +x.gig_number,
          ).first()),
          "This student already has an active request for that controlled gig number.",
        );
        jobs.push(
          stmt(
            "INSERT INTO account_requests VALUES(?,?,?,?,?,?,?,?,?)",
            id,
            sid,
            task.title,
            task.platform,
            task.value,
            "Submitted",
            0,
            u.id,
            t,
          ),
          stmt(
            "INSERT INTO account_request_details VALUES(?,?,?,?,?)",
            id,
            task.id,
            x.job_profile,
            +x.gig_number,
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
            `Allocation for request ${r.id}`,
            u.id,
            t,
          ),
        );
        break;
      }
      case "account_status": {
        permit(u, ["Higher Board"]);
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
          Blocked: ["Under Review", "Retired"],
          "Access Issue": ["Under Review", "Retired"],
          "Funding Block": ["Under Review", "Retired"],
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
        permit(u, ops);
        ensure(
          s &&
            x.title &&
            x.platform &&
            Number(x.value) > 0 &&
            x.order_ref?.trim() &&
            Date.parse(x.due),
          "Student, task, platform, order reference, value and due date are required.",
        );
        jobs.push(
          stmt(
            "INSERT INTO gigs(id,student_id,platform,title,value,currency,order_ref,status,due,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            id,
            sid,
            x.platform,
            x.title,
            Number(x.value),
            x.currency || "USD",
            x.order_ref,
            "Account Assigned",
            x.due,
            t,
          ),
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
        const st = await student(u, g.student_id);
        await proof(u, x.proof_id, g.student_id);
        await proof(u, x.payment_proof_id, g.student_id);
        ensure(x.source, "External source is required.");
        ensure(
          x.payment_proof_id !== x.proof_id,
          "Delivery and payment proof must be separate uploaded records.",
        );
        const evidencePackage = uid("EPK");
        jobs.push(
          stmt(
            "INSERT INTO evidence(id,student_id,gig_id,proof_id,source,status,recorder,stage_at,created_at,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
            id,
            g.student_id,
            g.id,
            x.proof_id,
            x.source,
            "Coach Review",
            u.id,
            t,
            t,
            st.policy_id,
          ),
          stmt(
            "INSERT INTO evidence_packages(id,evidence_id,revision,status,created_by,created_at) VALUES(?,?,1,'Submitted',?,?)",
            evidencePackage,
            id,
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
          stmt(
            "UPDATE attachment_context SET gig_id=?,account_id=?,activity_type='Evidence submission',platform=?,source=?,performed_by_type='STUDENT',performed_by_student_id=? WHERE attachment_id=?",
            g.id,
            g.account_id || null,
            g.platform,
            x.source,
            g.student_id,
            x.proof_id,
          ),
          stmt(
            "UPDATE attachment_context SET gig_id=?,account_id=?,activity_type='Payment evidence',platform=?,source=?,performed_by_type='STUDENT',performed_by_student_id=? WHERE attachment_id=?",
            g.id,
            g.account_id || null,
            g.platform,
            x.source,
            g.student_id,
            x.payment_proof_id,
          ),
        );
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
        if (e.status === "Coach Review") {
          permit(u, ["Coach"]);
          const configured: any = await stmt(
            "SELECT count(*) n FROM group_coaches WHERE group_id=? AND status='Active'",
            st.group_id,
          ).first();
          const assigned = await stmt(
            "SELECT id FROM group_coaches WHERE group_id=? AND user_id=? AND status='Active' AND onboarding_status='Complete'",
            st.group_id,
            u.id,
          ).first();
          ensure(
            assigned || (!configured?.n && st.coach === u.id),
            "Only an onboarded coach assigned to this group can complete first evidence review.",
          );
          next = "Coordinator L1";
        } else if (e.status === "Coordinator L1") {
          permit(u, ops);
          next = "Quality Review";
        } else if (e.status === "Quality Review") {
          permit(u, [...reviewers, "Quality Member", "Quality Lead"]);
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
        jobs.push(
          stmt(
            "INSERT INTO cases(id,student_id,title,type,severity,status,owner,due,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            id,
            sid || null,
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
            x.notes || "Case opened",
            t,
          ),
        );
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
        permit(u, [
          "Project Operations",
          "Team Supervisor",
          "Coach Operations",
        ]);
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
        ensure(x.reason?.trim(), "Document the access change reason.");
        const old: any = await stmt(
          "SELECT * FROM users WHERE email=?",
          x.email,
        ).first();
        if (old) {
          auditPrevious = old;
          jobs.push(
            stmt(
              "UPDATE users SET name=?,roles=? WHERE id=?",
              x.name,
              JSON.stringify(x.roles),
              old.id,
            ),
          );
        } else
          jobs.push(
            stmt(
              "INSERT INTO users(id,email,name,roles,scopes) VALUES(?,?,?,?,?)",
              uid("USR"),
              x.email,
              x.name,
              JSON.stringify(x.roles),
              "[]",
            ),
          );
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
      // The gig phase is reviewed by the people who run the student's group:
      // the coordinator owns it, with the supervisor and Project Operations
      // able to cover. `student()` below applies the same scope rule as the
      // rest of the workspace, so a coordinator cannot reach another team's
      // students. Quality no longer reviews service links; their activity
      // review lives outside this application.
      case "service_qc_review": {
        permit(u, reviewers);
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
            next === "Locked" ? "Student service link approved" : "Student service link needs correction",
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
      case "evidence_qc_assign": {
        permit(u, ["Quality Lead"]);
        const table = "evidence";
        const openFilter = "status IN ('Quality','Coach','L1')";
        const reviewers = (await (await stmt(
          "SELECT id FROM users WHERE active=1 AND (roles LIKE '%Quality Member%' OR roles LIKE '%Quality Lead%') ORDER BY id",
        ).all()).results) as any[];
        ensure(reviewers.length, "Add an active Quality Member before assigning reviews.");
        if (x.reviewer_id) {
          ensure(reviewers.some((r) => r.id === x.reviewer_id), "Choose an active Quality reviewer.");
          const item: any = await stmt(`SELECT * FROM ${table} WHERE id=?`, x.item_id || id).first();
          ensure(item, "That review item was not found.");
          auditPrevious = item;
          auditValue = { item_id: item.id, assigned_to: x.reviewer_id, mode: "manual" };
          jobs.push(stmt(`UPDATE ${table} SET qc_actor=? WHERE id=?`, x.reviewer_id, item.id));
          break;
        }
        const load = await Promise.all(
          reviewers.map(async (r) => ({
            id: r.id,
            open: Number(
              ((await stmt(`SELECT count(*) n FROM ${table} WHERE qc_actor=? AND ${openFilter}`, r.id).first()) as any)?.n || 0,
            ),
          })),
        );
        const pending = (await (await stmt(
          `SELECT id FROM ${table} WHERE qc_actor IS NULL AND ${openFilter} ORDER BY id`,
        ).all()).results) as any[];
        ensure(pending.length, "Every open review already has a reviewer.");
        const allocations = distributeEvenly(pending.map((r) => String(r.id)), load);
        for (const allocation of allocations) {
          jobs.push(
            stmt(`UPDATE ${table} SET qc_actor=? WHERE id=? AND qc_actor IS NULL`, allocation.reviewerId, allocation.itemId),
          );
        }
        auditValue = {
          assigned: allocations.length,
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
