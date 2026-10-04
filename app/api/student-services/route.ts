import {
  all,
  auditStmt,
  currentStudent,
  db,
  now,
  rateLimit,
  stmt,
  uid,
  actor,
  permit,
  student,
} from "@/lib/server";
import { normalizeServiceSlots, serviceKey, serviceProgress, verifyServiceLink } from "@/lib/domain/service-links";
import { distributeEvenly } from "@/lib/domain/qc-assignment";
export const dynamic = "force-dynamic";

function parseLink(row: any) {
  let autoResult: any = {};
  try {
    autoResult = JSON.parse(row.auto_result || "{}");
  } catch {}
  return {
    id: row.id,
    slot: row.slot,
    url: row.url,
    platform: row.platform,
    auto_status: row.auto_status,
    auto_result: autoResult,
    auto_checked_at: row.auto_checked_at,
    qc_status: row.qc_status,
    qc_comment: row.qc_comment,
    qc_at: row.qc_at,
    revision: row.revision,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    can_edit: row.qc_status === "Needs Correction",
  };
}

async function studentView(studentId: string) {
  const submission: any = await stmt(
    "SELECT * FROM service_submissions WHERE student_id=?",
    studentId,
  ).first();
  const rows = await all(
    "SELECT * FROM service_links WHERE student_id=? ORDER BY slot",
    studentId,
  );
  const bySlot = new Map(rows.map((row) => [row.slot, parseLink(row)]));
  const reviews = await all(
    `SELECT r.id,r.service_link_id,l.slot,r.revision,r.decision,r.comment,r.reviewed_at,u.name reviewer_name
     FROM service_link_reviews r
     JOIN service_links l ON l.id=r.service_link_id
     JOIN users u ON u.id=r.reviewed_by
     WHERE l.student_id=? ORDER BY r.reviewed_at DESC LIMIT 50`,
    studentId,
  );
  return {
    submitted: Boolean(submission),
    submission: submission
      ? {
          id: submission.id,
          status: submission.status,
          submitted_at: submission.submitted_at,
          updated_at: submission.updated_at,
          qc_completed_at: submission.qc_completed_at,
        }
      : null,
    // The links in the order they were added, and where the student stands:
    // three at least, with a Kafiil and a Nafezly service among them.
    services: rows.map((row) => bySlot.get(row.slot)),
    progress: serviceProgress(rows.map((row) => row.platform)),
    reviews,
    last_reviewed_at: reviews[0]?.reviewed_at || null,
  };
}

/**
 * A submission's state, read from its links. It is Complete when at least
 * three Kafiil or Nafezly links are approved and nothing is waiting for QC;
 * links in "Other" are reviewed but are not needed for it. Approved links short of that are In Progress: the
 * student has more to add.
 */
function submissionStatus(studentId: string, t: string, completedAt: "now" | "latest") {
  const done = `(NOT EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND qc_status='Pending')
    AND (SELECT count(*) FROM service_links WHERE student_id=? AND platform IN ('Kafiil','Nafezly') AND qc_status='Locked')>=3)`;
  const doneArgs = [studentId, studentId];
  return stmt(
    `UPDATE service_submissions SET status=CASE
       WHEN ${done} THEN 'Complete'
       WHEN EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND qc_status='Needs Correction') THEN 'Needs Correction'
       WHEN EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND qc_status='Pending') THEN 'Pending QC'
       ELSE 'In Progress' END,
       qc_completed_at=CASE WHEN ${done} THEN ${completedAt === "now" ? "?" : "(SELECT max(qc_at) FROM service_links WHERE student_id=?)"} ELSE NULL END,
       updated_at=? WHERE student_id=?`,
    ...doneArgs,
    studentId,
    studentId,
    ...doneArgs,
    completedAt === "now" ? t : studentId,
    t,
    studentId,
  );
}

/**
 * The student's group sessions that have ended, newest first, each with
 * whether the student has given feedback on it yet.
 */
async function sessionsForFeedback(studentId: string) {
  const learner: any = await stmt("SELECT group_id FROM students WHERE id=?", studentId).first();
  if (!learner?.group_id) return [];
  const rows = await all(
    `SELECT t.id,t.title,t.week,t.starts_at,t.duration_minutes,u.name coach_name,
            (SELECT f.id FROM session_feedback f WHERE f.session_id=t.id AND f.student_id=?) feedback_id
     FROM sessions t LEFT JOIN users u ON u.id=t.coach_id
     WHERE t.group_id=? AND t.status<>'Cancelled' AND t.starts_at<=?
     ORDER BY t.starts_at DESC LIMIT 20`,
    studentId,
    learner.group_id,
    now(),
  );
  return rows
    .filter((r: any) => Date.parse(r.starts_at) + Number(r.duration_minutes || 180) * 60000 <= Date.now())
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      week: r.week,
      starts_at: r.starts_at,
      coach_name: r.coach_name && !/unassigned/i.test(r.coach_name) ? r.coach_name : null,
      given: Boolean(r.feedback_id),
    }));
}

const rating = (value: unknown, question: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`Answer "${question}" from 1 to 5.`);
  return n;
};

/** A student's feedback on a session they had: once per session, after it ended. */
async function sessionFeedback(x: any) {
  const s = await currentStudent();
  await rateLimit("session-feedback:" + s.id, 30, 60);
  const session: any = await stmt("SELECT * FROM sessions WHERE id=?", x.session_id).first();
  if (!session || session.group_id !== s.group_id) throw new Error("This session is not one of your group's.");
  if (session.status === "Cancelled") throw new Error("This session was cancelled.");
  if (Date.parse(session.starts_at) + Number(session.duration_minutes || 180) * 60000 > Date.now())
    throw new Error("Feedback opens once the session has ended.");
  if (await stmt("SELECT id FROM session_feedback WHERE session_id=? AND student_id=?", session.id, s.id).first())
    throw new Error("You have already given feedback on this session.");
  if (typeof x.searched_gig !== "boolean") throw new Error('Answer "Did you search for a gig through platforms?"');
  const text = (value: unknown) => String(value || "").trim().slice(0, 1000) || null;
  const t = now();
  await db().batch([
    stmt(
      "INSERT INTO session_feedback(id,session_id,student_id,satisfaction,clarity,searched_gig,usefulness,liked,comments,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      uid("SFB"),
      session.id,
      s.id,
      rating(x.satisfaction, "How satisfied are you with today's session?"),
      rating(x.clarity, "How clear was the coach's explanation?"),
      x.searched_gig ? 1 : 0,
      rating(x.usefulness, "How useful was today's mentorship for you?"),
      text(x.liked),
      text(x.comments),
      t,
    ),
    auditStmt(s, "Session feedback", session.id, { satisfaction: x.satisfaction, clarity: x.clarity, usefulness: x.usefulness }, null, uid("REQ")),
  ]);
  return Response.json({ ok: true, sessions: await sessionsForFeedback(s.id) });
}

export async function GET() {
  try {
    const s = await currentStudent();
    return Response.json({
      ok: true,
      student: { id: s.id, name: s.name, email: s.email },
      ...(await studentView(s.id)),
      feedback_sessions: await sessionsForFeedback(s.id),
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 403 });
  }
}

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 20_000) throw new Error("The request is too large.");
    const origin = req.headers.get("origin");
    if (origin) {
      if (origin !== new URL(req.url).origin)
        throw new Error("Cross-site requests are not allowed.");
    }
    const x = await req.json();
    if (x.action === "qc_review") return await qcReview(x);
    if (x.action === "session_feedback") return await sessionFeedback(x);
    if (x.action !== "submit_services") throw new Error("Choose a service-link action.");
    const s = await currentStudent();
    await rateLimit("student-services:" + s.id, 30, 60);
    const existing = await all(
      "SELECT * FROM service_links WHERE student_id=? ORDER BY slot",
      s.id,
    );
    const bySlot = new Map(existing.map((row) => [Number(row.slot), row]));
    // The student sends the whole form: the links already submitted, in their
    // places, with corrections, then any new ones. An approved or waiting link
    // cannot change, and a link is never dropped.
    let values: string[] = Array.isArray(x.services) ? x.services : [];
    if (values.length < existing.length)
      throw new Error("Keep every link you already submitted. Replace a link that needs correction instead of removing it.");
    values = normalizeServiceSlots(values);
    // A service is the student's own listing. It is never tied to one of the
    // programme's client accounts, which only order gigs, so account_id stays
    // empty.
    //
    // Each service belongs to one student. The same listing, matched by its
    // marketplace and service ID so a renamed slug is still caught, is refused
    // when another student has already submitted it.
    const takenElsewhere = async (check: any) => {
      // An open link has no service ID: the same address is the same service.
      if (!check.serviceId)
        return Boolean(
          check.normalizedUrl &&
            (await stmt(
              "SELECT id FROM service_links WHERE student_id<>? AND normalized_url=?",
              s.id,
              check.normalizedUrl,
            ).first()),
        );
      const key = serviceKey(check);
      if (!key) return false;
      const candidates = await all(
        "SELECT normalized_url,platform FROM service_links WHERE platform=? AND student_id<>? AND normalized_url LIKE ?",
        check.platform,
        s.id,
        `%/${check.serviceId}-%`,
      );
      return candidates.some((row: any) => serviceKey(verifyServiceLink(row.normalized_url)) === key);
    };
    const t = now();
    // Whether this submission replaces a link QC sent back.
    let corrected = false;
    const jobs: any[] = [
      stmt(
        `INSERT INTO service_submissions(id,student_id,status,submitted_at,updated_at,qc_completed_at)
         VALUES(?,?,?,?,?,NULL)
         ON CONFLICT(student_id) DO UPDATE SET status='Pending QC',updated_at=?,qc_completed_at=NULL`,
        uid("SSUB"),
        s.id,
        "Pending QC",
        t,
        t,
        t,
      ),
    ];
    for (let index = 0; index < values.length; index += 1) {
      const slot = index + 1;
      const value = values[index];
      const check = verifyServiceLink(value, { open: true });
      // When the gate raised an http marketplace address to https, the secure
      // form is what gets stored and opened; both screens link to this column.
      const stored = check.upgraded ? check.normalizedUrl : value;
      const prior: any = bySlot.get(slot);
      // A link sent back unchanged is left exactly as it is, a correction included.
      if (prior && prior.normalized_url === check.normalizedUrl) continue;
      if (prior && prior.qc_status !== "Needs Correction") {
        if (prior.normalized_url !== check.normalizedUrl)
          throw new Error(
            prior.qc_status === "Locked"
              ? `Service ${slot} is locked and cannot be changed.`
              : `Service ${slot} is awaiting QC and cannot be changed yet.`,
          );
        continue;
      }
      if (await takenElsewhere(check))
        throw new Error(
          `Link ${slot} is already submitted by another student. Each student submits their own services.`,
        );
      const revision = prior ? Number(prior.revision || 1) + 1 : 1;
      if (prior) corrected = true;
      const qcStatus = check.status === "Failed" ? "Needs Correction" : "Pending";
      if (prior) {
        jobs.push(
          stmt(
            `UPDATE service_links SET url=?,normalized_url=?,platform=?,auto_status=?,auto_result=?,auto_checked_at=?,qc_status=?,qc_comment=NULL,qc_actor=NULL,qc_at=NULL,revision=?,account_id=?,submitted_at=?,updated_at=? WHERE id=? AND qc_status<>'Locked'`,
            stored,
            check.normalizedUrl,
            check.platform,
            check.status,
            JSON.stringify(check),
            t,
            qcStatus,
            revision,
            null,
            t,
            t,
            prior.id,
          ),
        );
      } else {
        jobs.push(
          stmt(
            `INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,account_id,submitted_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?,?,?)`,
            uid("SLK"),
            s.id,
            slot,
            stored,
            check.normalizedUrl,
            check.platform,
            check.status,
            JSON.stringify(check),
            t,
            qcStatus,
            revision,
            null,
            t,
            t,
          ),
        );
      }
    }
    // The student's services go to a reviewer as they are submitted, so the
    // queue is never an unowned pile and every reviewer can see their share.
    const reviewer = await reviewerFor(s.id, existing.map((row: any) => row.qc_actor).find(Boolean) || null);
    if (reviewer)
      jobs.push(
        stmt(
          "UPDATE service_links SET qc_actor=?,updated_at=? WHERE student_id=? AND qc_status<>'Locked'",
          reviewer,
          t,
          s.id,
        ),
      );
    jobs.push(submissionStatus(s.id, t, "latest"));
    const notificationSeed = uid("NTF");
    jobs.push(stmt(
      `INSERT OR IGNORE INTO notifications(id,recipient,title,entity_type,entity_id,severity,source,created_at,read_at)
       SELECT ?||'-'||id,id,?,'student',?,'Action Required',?||':'||id,?,NULL
       FROM users WHERE active=1 AND id IN (
         SELECT ?
         UNION SELECT coordinator FROM groups WHERE id=(SELECT group_id FROM students WHERE id=?)
       )`,
      notificationSeed,
      corrected
        ? "A student corrected a service link: review it again"
        : priorSubmissionTitle(Boolean(existing.length)),
      s.id,
      `service-links:${s.id}:${t}`,
      t,
      reviewer,
      s.id,
    ));
    jobs.push(auditStmt(s, "Student service links submitted", s.id, { links: values.length }, null, uid("REQ")));
    await db().batch(jobs);
    return Response.json({ ok: true, ...(await studentView(s.id)) });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

/**
 * One decision on one published service link.
 *
 * The reviewer the student was assigned to makes it, one link at a time; the
 * team leader can decide any of them, because they own the queue. A locked
 * link is final and a link the automatic gate failed can only go back for
 * correction, so there is no override to argue about.
 */
async function qcReview(x: any) {
  const u = await actor();
  permit(u, ["Quality Member", "Quality Lead"]);
  if (!["Lock", "Needs Correction"].includes(x.decision))
    throw new Error("Choose Approve or Reject.");
  const comment = String(x.comment || "").trim();
  if (comment.length > 1000) throw new Error("Review comments must be 1,000 characters or fewer.");
  if (x.decision === "Needs Correction" && !comment)
    throw new Error("Add a comment telling the student why the link is rejected.");
  const link: any = await stmt("SELECT * FROM service_links WHERE id=?", x.service_id).first();
  if (!link) throw new Error("Service link not found.");
  if (link.qc_status === "Locked")
    throw new Error("This service link is already approved. The student submits a new link instead.");
  if (link.auto_status === "Failed" && x.decision === "Lock")
    throw new Error("The automatic check failed for this link, so it can only be rejected.");
  if (link.qc_actor && link.qc_actor !== u.id && !u.roles.includes("Quality Lead"))
    throw new Error("This student is assigned to another reviewer.");
  await student(u, link.student_id);
  const t = now();
  const next = x.decision === "Lock" ? "Locked" : "Needs Correction";
  const jobs: any[] = [
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
      comment || "Verified in quality review.",
      u.id,
      t,
    ),
    submissionStatus(link.student_id, t, "now"),
    auditStmt(u, "Service link review", link.id, { decision: next, student_id: link.student_id, comment }),
  ];
  await db().batch(jobs);
  return Response.json({ ok: true });
}

/**
 * Who reviews student services, and who gets the next student.
 *
 * The quality team reviews; the team leader hands the work out and does not
 * carry a share of it, so the pool is the active Quality Members. Work is
 * counted in students rather than links, because a student's three services
 * are one piece of work: the same reviewer sees all three, forms one view of
 * the person, and decides each link on its own.
 */
async function reviewerPool() {
  const staff = await all("SELECT id, roles FROM users WHERE active=1");
  return staff
    .filter((person: any) => {
      let held: string[] = [];
      try {
        held = JSON.parse(person.roles || "[]");
      } catch {
        held = [];
      }
      return held.includes("Quality Member") && !held.includes("Quality Lead");
    })
    .map((person: any) => String(person.id));
}

/**
 * The reviewer for this student: the one who already holds them, so a
 * resubmission goes back to the person who asked for the correction, and
 * otherwise whoever currently holds the fewest students.
 */
export async function reviewerFor(studentId: string, priorActor?: string | null) {
  const pool = await reviewerPool();
  if (!pool.length) return null;
  if (priorActor && pool.includes(priorActor)) return priorActor;
  const counts = new Map(pool.map((id) => [id, 0]));
  const held = await all(
    `SELECT qc_actor, count(DISTINCT student_id) students FROM service_links
      WHERE qc_actor IS NOT NULL AND qc_status<>'Locked' AND student_id<>? GROUP BY qc_actor`,
    studentId,
  );
  for (const row of held as any[]) if (counts.has(String(row.qc_actor))) counts.set(String(row.qc_actor), Number(row.students) || 0);
  const [allocation] = distributeEvenly([studentId], [...counts].map(([id, open]) => ({ id, open })));
  return allocation ? allocation.reviewerId : null;
}

function priorSubmissionTitle(resubmission: boolean) {
  return resubmission ? "Student resubmitted service links" : "New student service links";
}
