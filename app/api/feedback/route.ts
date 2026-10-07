import { actor, all, auditStmt, db, now, permit, rateLimit, scopeSql, stmt, uid } from "@/lib/server";
import { can, ensure } from "@/lib/domain/rules";
import { levelOf, scoreOf } from "@/lib/domain/feedback";

export const dynamic = "force-dynamic";

// Students' feedback after their sessions (see lib/domain/feedback.ts).
// Coach Operations follows it closely and handles the red flags; the group's
// coordinator, its supervisor and Project Operations read it for their own
// groups. Coaches and the quality team do not see it.
const readers = ["Coach Operations", "Operations Coordinator", "Team Supervisor", "Project Operations", "Operations Systems / Admin"];
const handlers = ["Coach Operations", "Operations Systems / Admin"];
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request) {
  try {
    const u = await actor();
    permit(u, readers);
    await rateLimit("feedback:" + u.id, 60, 60);
    const q = scopeSql(u, "g", null);

    // The count behind the red card on Coach Operations' first screen: sessions
    // whose score is below 3 and that nobody has handled yet.
    if (new URL(req.url).searchParams.get("summary")) {
      const totals = await all(
        `SELECT f.session_id, count(*) n, sum(f.satisfaction+f.clarity+f.usefulness) total
         FROM session_feedback f JOIN sessions t ON t.id=f.session_id JOIN groups g ON g.id=t.group_id
         WHERE ${q.sql} AND NOT EXISTS (SELECT 1 FROM feedback_flags h WHERE h.session_id=f.session_id)
         GROUP BY f.session_id`,
        ...q.args,
      );
      const open = totals.filter((r: any) => levelOf(Math.round((Number(r.total) / (3 * Number(r.n))) * 10) / 10) === "flag").length;
      return Response.json({ open, handles: can(u.roles, handlers) }, noStore);
    }

    const [sessions, responses, handled] = await Promise.all([
      all(
        `SELECT t.id,t.group_id,t.coach_id,t.week,t.starts_at,t.title,c.name coach_name
         FROM sessions t JOIN groups g ON g.id=t.group_id LEFT JOIN users c ON c.id=t.coach_id
         WHERE ${q.sql} AND EXISTS (SELECT 1 FROM session_feedback f WHERE f.session_id=t.id)`,
        ...q.args,
      ),
      all(
        `SELECT f.id,f.session_id,f.student_id,s.name student_name,f.satisfaction,f.clarity,f.usefulness,f.searched_gig,f.liked,f.comments,f.created_at
         FROM session_feedback f JOIN sessions t ON t.id=f.session_id JOIN groups g ON g.id=t.group_id LEFT JOIN students s ON s.id=f.student_id
         WHERE ${q.sql} ORDER BY f.created_at DESC`,
        ...q.args,
      ),
      all(
        `SELECT h.session_id,h.score,h.note,h.case_id,h.handled_by,h.handled_at,p.name handled_by_name,k.status case_status
         FROM feedback_flags h JOIN sessions t ON t.id=h.session_id JOIN groups g ON g.id=t.group_id
         LEFT JOIN users p ON p.id=h.handled_by LEFT JOIN cases k ON k.id=h.case_id
         WHERE ${q.sql}`,
        ...q.args,
      ),
    ]);
    return Response.json(
      {
        sessions: sessions.map((s: any) => ({ ...s, coach_name: s.coach_name && !/unassigned/i.test(s.coach_name) ? s.coach_name : null })),
        responses,
        handled,
        handles: can(u.roles, handlers),
      },
      noStore,
    );
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

/** Coach Operations records what was done about a red flag, and may open a case. */
export async function POST(req: Request) {
  try {
    const u = await actor();
    permit(u, handlers);
    await rateLimit("feedback-handle:" + u.id, 30, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();
    ensure(x.action === "handle_flag", "Choose a feedback action.");
    const q = scopeSql(u, "g", null);
    const session: any = await stmt(
      `SELECT t.id,t.group_id,t.week FROM sessions t JOIN groups g ON g.id=t.group_id WHERE t.id=? AND ${q.sql}`,
      String(x.session_id || ""),
      ...q.args,
    ).first();
    ensure(session, "Session not found.");
    const score = scoreOf(await all("SELECT satisfaction,clarity,usefulness FROM session_feedback WHERE session_id=?", session.id));
    ensure(levelOf(score) === "flag", "Only a session rated below 3 out of 5 is a flag to handle.");
    ensure(!(await stmt("SELECT session_id FROM feedback_flags WHERE session_id=?", session.id).first()), "Someone has already handled this flag.");
    const note = String(x.note || "").trim();
    ensure(note.length >= 5 && note.length <= 2000, "Write what was done, in 5 to 2,000 characters.");

    const t = now();
    const jobs: any[] = [];
    let caseId: string | null = null;
    if (x.open_case) {
      caseId = uid("CASE");
      const title = String(x.case_title || "").trim().slice(0, 200) || `Low session feedback · ${session.group_id} · Week ${session.week}`;
      const due = x.case_due && Number.isFinite(Date.parse(x.case_due)) ? new Date(x.case_due).toISOString() : new Date(Date.now() + 3 * 86400000).toISOString();
      jobs.push(
        stmt(
          "INSERT INTO cases(id,student_id,title,type,severity,status,owner,due,source,created_at,group_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          caseId, null, title, "Session", "S2 High", "Open", u.id, due, "feedback-flag:" + session.id, t, session.group_id,
        ),
        stmt("INSERT INTO case_events VALUES(?,?,?,?,?,?)", uid("CASEEV"), caseId, "Open", u.id, note, t),
      );
    }
    jobs.push(
      stmt(
        "INSERT INTO feedback_flags(session_id,score,note,case_id,handled_by,handled_at) VALUES(?,?,?,?,?,?)",
        session.id, score, note, caseId, u.id, t,
      ),
      auditStmt(u, "Session feedback flag handled", session.id, { score, case_id: caseId }, null, uid("REQ")),
    );
    await db().batch(jobs);
    return Response.json({ ok: true, case_id: caseId });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
