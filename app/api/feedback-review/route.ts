import { actor, all, auditStmt, db, now, permit, rateLimit, stmt, uid } from "@/lib/server";
import { sameSide } from "@/lib/demo";
import { can, ensure } from "@/lib/domain/rules";

export const dynamic = "force-dynamic";

// The quality team's review of students' feedback after each session.
//
// Every session with feedback goes to one Quality Member, chosen at random
// among those with the fewest reviews still pending (so the work stays even).
// A member sees the sessions given to them; the Quality Lead and the
// administrators see them all, and can hand one to someone else or share the
// pending ones out again. Reviewers read the ratings and comments, not who gave
// them: students' names stay with the people who run the groups.
const lead = ["Quality Lead", "Operations Systems / Admin"];
const team = ["Quality Member", ...lead];
const noStore = { headers: { "Cache-Control": "no-store" } };

/** The active Quality Members on the caller's side (demo or real), with their pending load. */
async function members(u: any) {
  const people = await all(
    `SELECT u.id,u.name,u.roles,(SELECT count(*) FROM feedback_reviews r WHERE r.reviewer=u.id AND r.status='Pending') pending
     FROM users u WHERE u.active=1 AND ${sameSide(u, "u.id")}`,
  );
  return people
    .filter((p: any) => (typeof p.roles === "string" ? JSON.parse(p.roles || "[]") : p.roles || []).includes("Quality Member"))
    .map((p: any) => ({ id: p.id as string, name: p.name as string, pending: Number(p.pending) }));
}

/** One of the least-loaded reviewers, at random. */
function draw(pool: { id: string; pending: number }[]) {
  const least = Math.min(...pool.map((p) => p.pending));
  const tied = pool.filter((p) => p.pending === least);
  const chosen = tied[Math.floor(Math.random() * tied.length)];
  chosen.pending += 1;
  return chosen.id;
}

export async function GET() {
  try {
    const u = await actor();
    permit(u, [...team, "Coach"]);
    await rateLimit("feedback-review:" + u.id, 60, 60);
    const leads = can(u.roles, lead);
    const side = sameSide(u, "g.id");

    // A coach (who is not also on the quality team) reads their own sessions'
    // feedback, read-only: the sessions they led, or that followed them as the
    // group's coach. No reviewer, note or student is shown.
    if (!can(u.roles, team)) {
      const own = "coalesce(t.coach_id,g.coach)=?";
      const [sessions, responses] = await Promise.all([
        all(
          `SELECT t.id,t.title,t.group_id,t.week,t.starts_at,g.track,g.provider,coalesce(t.coach_id,g.coach) coach_id,c.name coach_name
           FROM sessions t JOIN groups g ON g.id=t.group_id LEFT JOIN users c ON c.id=coalesce(t.coach_id,g.coach)
           WHERE ${side} AND ${own} AND EXISTS (SELECT 1 FROM session_feedback f WHERE f.session_id=t.id) ORDER BY t.starts_at DESC`,
          u.id,
        ),
        all(
          `SELECT f.id,f.session_id,f.satisfaction,f.clarity,f.usefulness,f.searched_gig,f.liked,f.comments,f.created_at
           FROM session_feedback f JOIN sessions t ON t.id=f.session_id JOIN groups g ON g.id=t.group_id
           WHERE ${side} AND ${own} ORDER BY f.created_at`,
          u.id,
        ),
      ]);
      return Response.json({ sessions, responses, lead: false, coach: true, me: u.id }, noStore);
    }

    // Sessions whose feedback nobody reviews yet are given out now.
    const pool = await members(u);
    if (pool.length) {
      const waiting = await all(
        `SELECT t.id FROM sessions t JOIN groups g ON g.id=t.group_id
         WHERE ${side} AND coalesce(g.delivery_model,'Regular')<>'Industry'
           AND EXISTS (SELECT 1 FROM session_feedback f WHERE f.session_id=t.id)
           AND NOT EXISTS (SELECT 1 FROM feedback_reviews r WHERE r.session_id=t.id)
         ORDER BY t.starts_at`,
      );
      if (waiting.length) {
        const t = now();
        await db().batch([
          ...waiting.map((s: any) =>
            stmt(
              "INSERT INTO feedback_reviews(session_id,reviewer,assigned_by,assigned_at,status) VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO NOTHING",
              s.id, draw(pool), null, t, "Pending",
            ),
          ),
          auditStmt(u, "Feedback reviews assigned", "feedback-reviews", { sessions: waiting.length, automatic: true }),
        ]);
      }
    }

    const mine = leads ? "" : " AND r.reviewer=?";
    const args = leads ? [] : [u.id];
    const [sessions, responses] = await Promise.all([
      all(
        `SELECT t.id,t.title,t.group_id,t.week,t.starts_at,t.status session_status,g.track,g.provider,
                coalesce(t.coach_id,g.coach) coach_id,c.name coach_name,
                r.reviewer,p.name reviewer_name,r.status,r.note,r.reviewed_at,r.assigned_at,r.assigned_by
         FROM feedback_reviews r JOIN sessions t ON t.id=r.session_id JOIN groups g ON g.id=t.group_id
         LEFT JOIN users c ON c.id=coalesce(t.coach_id,g.coach) LEFT JOIN users p ON p.id=r.reviewer
         WHERE ${side}${mine} ORDER BY t.starts_at DESC`,
        ...args,
      ),
      all(
        `SELECT f.id,f.session_id,f.satisfaction,f.clarity,f.usefulness,f.searched_gig,f.liked,f.comments,f.created_at
         FROM session_feedback f JOIN feedback_reviews r ON r.session_id=f.session_id JOIN sessions t ON t.id=f.session_id JOIN groups g ON g.id=t.group_id
         WHERE ${side}${mine} ORDER BY f.created_at`,
        ...args,
      ),
    ]);
    return Response.json(
      {
        sessions: sessions.map((s: any) => ({ ...s, coach_name: s.coach_name && !/unassigned/i.test(s.coach_name) ? s.coach_name : null })),
        responses,
        reviewers: leads ? pool.map(({ id, name }) => ({ id, name })) : [],
        lead: leads,
        me: u.id,
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
    permit(u, team);
    await rateLimit("feedback-review-write:" + u.id, 60, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();
    const leads = can(u.roles, lead);
    const t = now();
    const requestId = String(x.request_id || uid("REQ"));
    const review = async (sessionId: string) => {
      const row: any = await stmt(
        `SELECT r.* FROM feedback_reviews r JOIN sessions t ON t.id=r.session_id JOIN groups g ON g.id=t.group_id WHERE r.session_id=? AND ${sameSide(u, "g.id")}`,
        sessionId,
      ).first();
      ensure(row, "This session has no feedback review.");
      return row;
    };

    if (x.action === "review") {
      // The reviewer (or the lead) marks it reviewed with a note, or opens it again.
      const row = await review(String(x.session_id || ""));
      ensure(leads || row.reviewer === u.id, "Only the reviewer it was given to, or the Quality Lead, can review it.");
      const done = x.status !== "Pending";
      const note = String(x.note || "").trim();
      ensure(note.length <= 2000, "Keep the note under 2,000 characters.");
      await db().batch([
        stmt(
          "UPDATE feedback_reviews SET status=?,note=?,reviewed_at=? WHERE session_id=?",
          done ? "Reviewed" : "Pending", note || null, done ? t : null, row.session_id,
        ),
        auditStmt(u, done ? "Feedback reviewed" : "Feedback review reopened", row.session_id, { note: note || null }, row, requestId),
      ]);
      return Response.json({ ok: true });
    }

    ensure(leads, "Only the Quality Lead hands out feedback reviews.");
    const pool = await members(u);
    if (x.action === "reassign") {
      const row = await review(String(x.session_id || ""));
      ensure(pool.some((p) => p.id === x.reviewer), "Choose an active Quality Member.");
      ensure(row.reviewer !== x.reviewer, "This reviewer already has it.");
      await db().batch([
        stmt(
          "UPDATE feedback_reviews SET reviewer=?,assigned_by=?,assigned_at=?,status='Pending',reviewed_at=NULL WHERE session_id=?",
          x.reviewer, u.id, t, row.session_id,
        ),
        auditStmt(u, "Feedback review reassigned", row.session_id, { reviewer: x.reviewer }, row, requestId),
      ]);
      return Response.json({ ok: true });
    }

    if (x.action === "redistribute") {
      // Every pending review shared out again at random, evenly.
      ensure(pool.length, "There is no active Quality Member to give reviews to.");
      const pending = await all(
        `SELECT r.session_id FROM feedback_reviews r JOIN sessions t ON t.id=r.session_id JOIN groups g ON g.id=t.group_id
         WHERE r.status='Pending' AND ${sameSide(u, "g.id")}`,
      );
      for (const p of pool) p.pending = 0;
      const order = pending.map((r: any) => r.session_id as string);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      await db().batch([
        ...order.map((sessionId) =>
          stmt("UPDATE feedback_reviews SET reviewer=?,assigned_by=?,assigned_at=? WHERE session_id=?", draw(pool), u.id, t, sessionId),
        ),
        auditStmt(u, "Feedback reviews shared out", "feedback-reviews", { sessions: order.length, reviewers: pool.length }, null, requestId),
      ]);
      return Response.json({ ok: true, moved: order.length });
    }

    throw new Error("Choose a feedback review action.");
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
