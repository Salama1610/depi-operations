import { actor, all, auditStmt, db, now, permit, rateLimit, refuseDemo, revokesStudents, stmt, uid } from "@/lib/server";
import { sameSide } from "@/lib/demo";
import { can, ensure } from "@/lib/domain/rules";

export const dynamic = "force-dynamic";

// Our quality team's check of the gigs students upload to the ministry portal.
//
// On the portal a gig is approved by the student's coach, then the ministry's
// quality reviewers, then a third-party company. Before the coach decides, one
// of our Quality Members checks it (by their own SOP) and approves or rejects
// it with a comment. The coach and the student's coordinator read the verdict
// in their own views (/api/coach-progress, /api/portal); the coach acts on the
// portal.
//
// Every gig in the latest gigs sheet that still waits for the coach (provider
// status Pending or blank) is handed out when the queue is opened: to the
// member already holding that student's gigs, so one person sees the whole
// student, or else to whoever holds the fewest pending ones. A member sees the
// gigs given to them; the Quality Lead and the administrators see them all and
// can move a student to someone else or share the pending ones out again.
const lead = ["Quality Lead", "Operations Systems / Admin"];
const team = ["Quality Member", ...lead];
const noStore = { headers: { "Cache-Control": "no-store" } };
const verdicts = ["Pending", "Approved", "Rejected"];
// Gigs the coach has not decided on yet: the only ones worth checking first.
const preCoach = "lower(trim(coalesce(z.provider_status,''))) IN ('','pending')";

/** The active Quality Members (not the lead, who hands the work out), with their pending load. */
async function members(u: any) {
  const people = await all(
    `SELECT u.id,u.name,u.roles,(SELECT count(*) FROM portal_gig_reviews r WHERE r.reviewer=u.id AND r.status='Pending') pending
     FROM users u WHERE u.active=1 AND ${sameSide(u, "u.id")} ORDER BY u.id`,
  );
  return people
    .map((p: any) => ({ ...p, roles: typeof p.roles === "string" ? JSON.parse(p.roles || "[]") : p.roles || [] }))
    .filter((p: any) => p.roles.includes("Quality Member") && !p.roles.includes("Quality Lead"))
    .map((p: any) => ({ id: p.id as string, name: p.name as string, pending: Number(p.pending) }));
}

/** One of the least-loaded reviewers, at random, charged with `count` gigs. */
function draw(pool: { id: string; pending: number }[], count: number) {
  const least = Math.min(...pool.map((p) => p.pending));
  const tied = pool.filter((p) => p.pending === least);
  const chosen = tied[Math.floor(Math.random() * tied.length)];
  chosen.pending += count;
  return chosen.id;
}

async function activeGigsBatch() {
  return (await stmt("SELECT batch_id FROM portal_uploads WHERE sheet='gigs' AND status='Active' ORDER BY committed_at DESC LIMIT 1").first()) as any;
}
async function activeStudentsBatch() {
  return (await stmt("SELECT batch_id FROM portal_uploads WHERE sheet='students' AND status='Active' ORDER BY committed_at DESC LIMIT 1").first()) as any;
}

/** Runs the statements a few hundred at a time, so a big sheet never makes one oversized request. */
async function inBatches(statements: any[]) {
  for (let i = 0; i < statements.length; i += 200) await db().batch(statements.slice(i, i + 200));
}

/** Gives every pending gig, student by student, to a reviewer: keeping the student's current one when asked. */
function share(
  pool: { id: string; pending: number }[],
  rows: { key: string; student: string }[],
  holder: Map<string, string>,
) {
  const byStudent = new Map<string, string[]>();
  for (const r of rows) byStudent.set(r.student, [...(byStudent.get(r.student) || []), r.key]);
  const out: { key: string; reviewer: string }[] = [];
  for (const [student, keys] of byStudent) {
    const kept = holder.get(student);
    let reviewer = kept && pool.some((p) => p.id === kept) ? kept : "";
    if (reviewer) pool.find((p) => p.id === reviewer)!.pending += keys.length;
    else reviewer = draw(pool, keys.length);
    holder.set(student, reviewer);
    for (const key of keys) out.push({ key, reviewer });
  }
  return out;
}

export async function GET() {
  try {
    const u = await actor();
    refuseDemo(u);
    permit(u, team);
    await rateLimit("portal-qc:" + u.id, 60, 60);
    const leads = can(u.roles, lead);
    const [gigsBatch, studentsBatch] = await Promise.all([activeGigsBatch(), activeStudentsBatch()]);
    const pool = await members(u);

    // New gigs waiting for the coach are handed out now.
    if (gigsBatch && pool.length) {
      const waiting = await all(
        `SELECT z.portal_gig_id,z.portal_student_id,z.student_name,z.title,z.url,p.student_id,s.name linked_name
         FROM portal_gigs z
         LEFT JOIN portal_students p ON p.batch_id=? AND p.portal_id=z.portal_student_id
         LEFT JOIN students s ON s.id=p.student_id
         WHERE z.batch_id=? AND coalesce(trim(z.portal_gig_id),'')<>'' AND coalesce(trim(z.portal_student_id),'')<>''
           AND ${preCoach}
           AND COALESCE(s.lifecycle,'')<>'Revoked'
           AND NOT EXISTS (SELECT 1 FROM portal_gig_reviews r WHERE r.portal_gig_id=z.portal_gig_id)
         ORDER BY z.portal_student_id,z.created_on`,
        studentsBatch?.batch_id || "",
        gigsBatch.batch_id,
      );
      if (waiting.length) {
        const holders = await all(
          "SELECT portal_student_id,reviewer FROM portal_gig_reviews WHERE status='Pending' ORDER BY assigned_at DESC",
        );
        const holder = new Map<string, string>();
        for (const h of holders) if (!holder.has(h.portal_student_id)) holder.set(h.portal_student_id, h.reviewer);
        const seen = new Set<string>();
        const fresh = waiting.filter((w: any) => !seen.has(w.portal_gig_id) && seen.add(w.portal_gig_id));
        const given = new Map(
          share(pool, fresh.map((w: any) => ({ key: w.portal_gig_id, student: String(w.portal_student_id) })), holder).map((a) => [a.key, a.reviewer]),
        );
        const t = now();
        await inBatches([
          ...fresh.map((w: any) =>
            stmt(
              `INSERT INTO portal_gig_reviews(portal_gig_id,portal_student_id,student_id,student_name,title,url,reviewer,assigned_by,assigned_at,status)
               VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(portal_gig_id) DO NOTHING`,
              w.portal_gig_id, String(w.portal_student_id), w.student_id || null, w.linked_name || w.student_name || null,
              w.title || null, w.url || null, given.get(w.portal_gig_id), null, t, "Pending",
            ),
          ),
          auditStmt(u, "Portal gig reviews assigned", "portal-gig-reviews", { gigs: fresh.length, automatic: true }),
        ]);
      }
    }

    const mine = leads ? "" : " AND r.reviewer=?";
    const hidden = revokesStudents(u) ? "" : " AND COALESCE(s.lifecycle,'')<>'Revoked'";
    const reviews = await all(
      `SELECT r.*,p.name reviewer_name,d.name reviewed_by_name,s.group_id,g.track,g.provider,
              z.status portal_status,z.provider_status,z.auditor_status,z.price,z.created_on,z.category,z.proof_url,z.comment portal_comment,
              CASE WHEN z.portal_gig_id IS NULL THEN 0 ELSE 1 END in_sheet
       FROM portal_gig_reviews r
       LEFT JOIN users p ON p.id=r.reviewer LEFT JOIN users d ON d.id=r.reviewed_by
       LEFT JOIN students s ON s.id=r.student_id LEFT JOIN groups g ON g.id=s.group_id
       LEFT JOIN portal_gigs z ON z.batch_id=? AND z.portal_gig_id=r.portal_gig_id
       WHERE 1=1${mine}${hidden} ORDER BY r.status='Pending' DESC, r.portal_student_id, r.assigned_at`,
      gigsBatch?.batch_id || "",
      ...(leads ? [] : [u.id]),
    );
    // What else in the sheet repeats this gig: the same proof on another row,
    // or the same link entered again on the same day. Shown on the card, so
    // the reviewer checks the proof against them before deciding.
    if (gigsBatch && reviews.length) {
      const sheet = await all(
        "SELECT portal_gig_id,lower(trim(url)) link,lower(trim(proof_url)) proof,substr(CAST(created_on AS TEXT),1,10) AS gig_day FROM portal_gigs WHERE batch_id=?",
        gigsBatch.batch_id,
      );
      const byProof = new Map<string, string[]>();
      const byLinkDay = new Map<string, string[]>();
      for (const g of sheet) {
        if (g.proof) byProof.set(g.proof, [...(byProof.get(g.proof) || []), g.portal_gig_id]);
        if (g.link && g.gig_day) byLinkDay.set(g.link + " " + g.gig_day, [...(byLinkDay.get(g.link + " " + g.gig_day) || []), g.portal_gig_id]);
      }
      const others = (list: string[] | undefined, id: string) => (list || []).filter((x) => x !== id);
      for (const r of reviews as any[]) {
        const z = sheet.find((g: any) => g.portal_gig_id === r.portal_gig_id);
        r.same_proof = z?.proof ? others(byProof.get(z.proof), r.portal_gig_id) : [];
        r.same_link_day = z?.link && z.gig_day ? others(byLinkDay.get(z.link + " " + z.gig_day), r.portal_gig_id) : [];
      }
    }
    return Response.json(
      {
        reviews,
        reviewers: leads ? pool.map(({ id, name, pending }) => ({ id, name, pending })) : [],
        lead: leads,
        me: u.id,
        sheet: Boolean(gigsBatch),
        team: pool.length,
      },
      noStore,
    );
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    refuseDemo(u);
    permit(u, team);
    await rateLimit("portal-qc-write:" + u.id, 120, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();
    const leads = can(u.roles, lead);
    const t = now();
    const requestId = String(x.request_id || uid("REQ"));
    const review = async (id: string) => {
      const row: any = await stmt("SELECT * FROM portal_gig_reviews WHERE portal_gig_id=?", id).first();
      ensure(row, "This gig is not in the quality queue.");
      return row;
    };

    if (x.action === "decide") {
      // Approve or reject (with the reason), or put it back to pending.
      const row = await review(String(x.portal_gig_id || ""));
      ensure(leads || row.reviewer === u.id, "Only the reviewer it was given to, or the Quality Lead, can decide on it.");
      const status = String(x.status || "");
      ensure(verdicts.includes(status), "Choose Approved, Rejected or Pending.");
      const comment = String(x.comment || "").trim();
      ensure(comment.length <= 2000, "Keep the comment under 2,000 characters.");
      ensure(status !== "Rejected" || comment.length >= 3, "Write why the gig is rejected, so the coach can tell the student.");
      const done = status !== "Pending";
      // A decision is taken on the proof: the reviewer opens it first.
      if (done) {
        const sheet: any = await activeGigsBatch();
        const gig: any = sheet
          ? await stmt("SELECT proof_url FROM portal_gigs WHERE batch_id=? AND portal_gig_id=?", sheet.batch_id, row.portal_gig_id).first()
          : null;
        if (String(gig?.proof_url || "").trim()) ensure(x.proof_checked === true, "Open the proof before you approve or reject the gig.");
      }
      await db().batch([
        stmt(
          "UPDATE portal_gig_reviews SET status=?,comment=?,reviewed_by=?,reviewed_at=? WHERE portal_gig_id=?",
          status, comment || null, done ? u.id : null, done ? t : null, row.portal_gig_id,
        ),
        auditStmt(u, done ? `Portal gig ${status.toLowerCase()} by quality` : "Portal gig review reopened", row.portal_gig_id, { status, comment: comment || null, proof_checked: x.proof_checked === true }, row, requestId),
      ]);
      return Response.json({ ok: true });
    }

    ensure(leads, "Only the Quality Lead hands out portal gig reviews.");
    const pool = await members(u);
    if (x.action === "reassign") {
      // The student moves as a whole: every gig of theirs still pending.
      const row = await review(String(x.portal_gig_id || ""));
      ensure(pool.some((p) => p.id === x.reviewer), "Choose an active Quality Member.");
      const moved = await all(
        "SELECT portal_gig_id FROM portal_gig_reviews WHERE portal_student_id=? AND (status='Pending' OR portal_gig_id=?)",
        row.portal_student_id, row.portal_gig_id,
      );
      await db().batch([
        ...moved.map((m: any) =>
          stmt("UPDATE portal_gig_reviews SET reviewer=?,assigned_by=?,assigned_at=? WHERE portal_gig_id=?", x.reviewer, u.id, t, m.portal_gig_id),
        ),
        auditStmt(u, "Portal gig reviews reassigned", row.portal_student_id, { reviewer: x.reviewer, gigs: moved.length }, row, requestId),
      ]);
      return Response.json({ ok: true, moved: moved.length });
    }

    if (x.action === "redistribute") {
      // Every pending gig shared out again evenly, a student's gigs together.
      ensure(pool.length, "There is no active Quality Member to give reviews to.");
      const pending = await all("SELECT portal_gig_id,portal_student_id FROM portal_gig_reviews WHERE status='Pending'");
      for (const p of pool) p.pending = 0;
      const rows = pending.map((r: any) => ({ key: r.portal_gig_id as string, student: String(r.portal_student_id) }));
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rows[i], rows[j]] = [rows[j], rows[i]];
      }
      const given = share(pool, rows, new Map());
      await inBatches([
        ...given.map((g) =>
          stmt("UPDATE portal_gig_reviews SET reviewer=?,assigned_by=?,assigned_at=? WHERE portal_gig_id=?", g.reviewer, u.id, t, g.key),
        ),
        auditStmt(u, "Portal gig reviews shared out", "portal-gig-reviews", { gigs: given.length, reviewers: pool.length }, null, requestId),
      ]);
      return Response.json({ ok: true, moved: given.length });
    }

    throw new Error("Choose a portal gig review action.");
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
