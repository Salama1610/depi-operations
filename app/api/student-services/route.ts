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
import { normalizeServiceSlots, verifyServiceLink } from "@/lib/domain/service-links";
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
    services: [1, 2, 3].map((slot) => bySlot.get(slot) || { slot, url: "", can_edit: true }),
    reviews,
    last_reviewed_at: reviews[0]?.reviewed_at || null,
  };
}

export async function GET() {
  try {
    const s = await currentStudent();
    return Response.json({ ok: true, student: { id: s.id, name: s.name, email: s.email }, ...(await studentView(s.id)) });
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
    if (x.action !== "submit_services") throw new Error("Choose a service-link action.");
    const s = await currentStudent();
    await rateLimit("student-services:" + s.id, 30, 60);
    const values = normalizeServiceSlots(x.services);
    const existing = await all(
      "SELECT * FROM service_links WHERE student_id=? ORDER BY slot",
      s.id,
    );
    const bySlot = new Map(existing.map((row) => [Number(row.slot), row]));
    // The controlled account a service was published from. The student never
    // types it: the programme assigned them an account per marketplace, so it
    // is resolved from that assignment. The gate's platform names differ from
    // the account platform names (Kafiil is the Kafeel marketplace), so the
    // mapping is explicit. Left null when the student holds no assignment, or
    // more than one, on that marketplace.
    const accountPlatform: Record<string, string> = { Kafiil: "Kafeel", Khamsat: "Khamsat", Nafezly: "Nafezly" };
    const assignments = await all(
      `SELECT a.platform,a.id FROM account_assignments n JOIN accounts a ON a.id=n.account_id WHERE n.student_id=?`,
      s.id,
    );
    const accountFor = (platform: string) => {
      const wanted = accountPlatform[platform];
      if (!wanted) return null;
      const matches = assignments.filter((row: any) => row.platform === wanted);
      return matches.length === 1 ? String(matches[0].id) : null;
    };
    const t = now();
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
      const check = verifyServiceLink(value);
      // When the gate raised an http marketplace address to https, the secure
      // form is what gets stored and opened; both screens link to this column.
      const stored = check.upgraded ? check.normalizedUrl : value;
      const prior: any = bySlot.get(slot);
      if (prior && prior.qc_status !== "Needs Correction") {
        if (prior.normalized_url !== check.normalizedUrl)
          throw new Error(
            prior.qc_status === "Locked"
              ? `Service ${slot} is locked and cannot be changed.`
              : `Service ${slot} is awaiting QC and cannot be changed yet.`,
          );
        continue;
      }
      const revision = prior ? Number(prior.revision || 1) + 1 : 1;
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
            accountFor(check.platform),
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
            accountFor(check.platform),
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
    jobs.push(stmt(
      `UPDATE service_submissions SET status=CASE
         WHEN (SELECT count(*) FROM service_links WHERE student_id=? AND qc_status='Locked')=3 THEN 'Complete'
         WHEN EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND qc_status='Needs Correction') THEN 'Needs Correction'
         ELSE 'Pending QC' END,
         qc_completed_at=CASE WHEN (SELECT count(*) FROM service_links WHERE student_id=? AND qc_status='Locked')=3
           THEN (SELECT max(qc_at) FROM service_links WHERE student_id=?) ELSE NULL END
       WHERE student_id=?`, s.id, s.id, s.id, s.id, s.id,
    ));
    const notificationSeed = uid("NTF");
    jobs.push(stmt(
      `INSERT OR IGNORE INTO notifications(id,recipient,title,entity_type,entity_id,severity,source,created_at,read_at)
       SELECT ?||'-'||id,id,?,'student',?,'Action Required',?||':'||id,?,NULL
       FROM users WHERE active=1 AND id IN (
         SELECT ?
         UNION SELECT coordinator FROM groups WHERE id=(SELECT group_id FROM students WHERE id=?)
       )`,
      notificationSeed,
      priorSubmissionTitle(Boolean(existing.length)),
      s.id,
      `service-links:${s.id}:${t}`,
      t,
      reviewer,
      s.id,
    ));
    jobs.push(auditStmt(s, "Student service links submitted", s.id, { slots: 3 }, null, uid("REQ")));
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
    throw new Error("Choose Lock or Needs Correction.");
  const comment = String(x.comment || "").trim();
  if (comment.length > 1000) throw new Error("Review comments must be 1,000 characters or fewer.");
  if (x.decision === "Needs Correction" && !comment)
    throw new Error("Add a correction comment for the student.");
  const link: any = await stmt("SELECT * FROM service_links WHERE id=?", x.service_id).first();
  if (!link) throw new Error("Service link not found.");
  if (link.qc_status === "Locked")
    throw new Error("This service link is already locked. The student submits a new link instead.");
  if (link.auto_status === "Failed" && x.decision === "Lock")
    throw new Error("The automatic check failed for this link, so it can only be returned for correction.");
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
