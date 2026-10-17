import { actor, all, auditStmt, db, notRevoked, now, permit, rateLimit, stmt, uid } from "@/lib/server";
import { sameSide } from "@/lib/demo";
import { can, ensure } from "@/lib/domain/rules";

export const dynamic = "force-dynamic";

// The quality team's check of each held session's attendance register.
//
// Quality opens a session that has started, reads who was marked present or
// absent (and by whom), and marks the register Valid or Has problems with a
// comment. The marks themselves are never changed here: Coach Operations and
// Project Operations read the check and act on it. A "Has problems" check
// tells every Coach Operations member.
const lead = ["Quality Lead", "Operations Systems / Admin"];
const team = ["Quality Member", ...lead];
const readers = ["Coach Operations", "Project Operations"];
const statuses = ["Valid", "Has problems"];
const noStore = { headers: { "Cache-Control": "no-store" } };

/** Held sessions the caller may see: their side, no Industry group, not cancelled, already started. */
const held = (u: any) =>
  `${sameSide(u, "g.id")} AND coalesce(g.delivery_model,'Regular')<>'Industry' AND t.status<>'Cancelled' AND t.starts_at<=?`;
const realName = (n: any) => (n && !/unassigned/i.test(String(n)) ? n : null);

export async function GET(req?: Request) {
  try {
    const u = await actor();
    permit(u, [...team, ...readers]);
    await rateLimit("attendance-check:" + u.id, 60, 60);
    const t = now();
    const checks = can(u.roles, team);
    const role = { checks, lead: can(u.roles, lead), me: u.id };

    // One session's register, on request: every student marked, then the
    // group's current students nobody marked yet.
    const sessionId = req ? new URL(req.url).searchParams.get("session") : null;
    if (sessionId) {
      const session: any = await stmt(
        `SELECT t.id,t.group_id FROM sessions t JOIN groups g ON g.id=t.group_id WHERE t.id=? AND ${held(u)}`,
        sessionId, t,
      ).first();
      ensure(session, "This session is not one to check.");
      const [marked, unmarked] = await Promise.all([
        all(
          `SELECT a.session_id,a.student_id,s.name student_name,s.group_id student_group,a.status,a.recorder,coalesce(r.name,a.recorder) recorder_name,a.source,a.updated_at
           FROM attendance a JOIN students s ON s.id=a.student_id LEFT JOIN users r ON r.id=a.recorder
           WHERE a.session_id=? AND ${notRevoked(u, "a.student_id")} ORDER BY s.name`,
          session.id,
        ),
        all(
          `SELECT s.id student_id,s.name student_name,s.group_id student_group FROM students s
           WHERE s.group_id=? AND s.lifecycle IN ('Active','Paused') AND ${notRevoked(u, "s.id")}
             AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id=? AND a.student_id=s.id) ORDER BY s.name`,
          session.group_id, session.id,
        ),
      ]);
      const register = [
        ...marked,
        ...unmarked.map((s: any) => ({ session_id: session.id, ...s, status: null, recorder: null, recorder_name: null, source: null, updated_at: null })),
      ];
      return Response.json({ session: session.id, register, ...role }, noStore);
    }

    const marks = `(SELECT count(*) FROM attendance a WHERE a.session_id=t.id AND a.status=? AND ${notRevoked(u, "a.student_id")})`;
    const [sessions, recorders] = await Promise.all([
      all(
        `SELECT t.id,t.title,t.group_id,t.week,t.starts_at,t.duration_minutes,g.track,g.provider,
                coalesce(t.coach_id,g.coach) coach_id,c.name coach_name,g.coordinator coordinator_id,o.name coordinator_name,
                ${marks} present,${marks} absent,
                (SELECT count(*) FROM students s WHERE s.group_id=t.group_id AND s.lifecycle IN ('Active','Paused') AND ${notRevoked(u, "s.id")}) enrolled,
                k.status check_status,k.note check_note,k.checked_by,p.name checked_by_name,k.checked_at
         FROM sessions t JOIN groups g ON g.id=t.group_id
         LEFT JOIN users c ON c.id=coalesce(t.coach_id,g.coach) LEFT JOIN users o ON o.id=g.coordinator
         LEFT JOIN attendance_checks k ON k.session_id=t.id LEFT JOIN users p ON p.id=k.checked_by
         WHERE ${held(u)} ORDER BY t.starts_at DESC`,
        "Present", "Absent", t,
      ),
      all(
        `SELECT a.session_id,a.recorder,coalesce(r.name,a.recorder) name,count(*) n
         FROM attendance a JOIN sessions t ON t.id=a.session_id JOIN groups g ON g.id=t.group_id LEFT JOIN users r ON r.id=a.recorder
         WHERE ${held(u)} GROUP BY a.session_id,a.recorder,r.name`,
        t,
      ),
    ]);
    const bySession = new Map<string, string[]>();
    for (const r of recorders as any[]) bySession.set(r.session_id, [...(bySession.get(r.session_id) || []), String(r.name)]);
    return Response.json(
      {
        sessions: sessions.map((s: any) => {
          const present = Number(s.present) || 0;
          const absent = Number(s.absent) || 0;
          return {
            ...s,
            present,
            absent,
            marked: present + absent,
            enrolled: Number(s.enrolled) || 0,
            coach_name: realName(s.coach_name),
            recorded_by: (bySession.get(s.id) || []).sort(),
          };
        }),
        ...role,
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
    await rateLimit("attendance-check-write:" + u.id, 60, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();
    const t = now();
    const requestId = String(x.request_id || uid("REQ"));
    const session: any = await stmt(
      `SELECT t.id,t.group_id,t.week,t.title FROM sessions t JOIN groups g ON g.id=t.group_id WHERE t.id=? AND ${held(u)}`,
      String(x.session_id || ""), t,
    ).first();
    ensure(session, "This session is not one to check.");
    const previous: any = await stmt("SELECT * FROM attendance_checks WHERE session_id=?", session.id).first();

    if (x.action === "check") {
      const status = String(x.status || "");
      ensure(statuses.includes(status), "Choose Valid or Has problems.");
      const note = String(x.note || "").trim();
      ensure(note.length <= 2000, "Keep the note under 2,000 characters.");
      ensure(status !== "Has problems" || note.length >= 3, "Say what the problem is with this register.");
      const jobs = [
        stmt(
          `INSERT INTO attendance_checks(session_id,status,note,checked_by,checked_at) VALUES(?,?,?,?,?)
           ON CONFLICT(session_id) DO UPDATE SET status=excluded.status,note=excluded.note,checked_by=excluded.checked_by,checked_at=excluded.checked_at`,
          session.id, status, note || null, u.id, t,
        ),
        auditStmt(u, "Attendance register checked", session.id, { status, note: note || null }, previous || null, requestId),
      ];
      if (status === "Has problems")
        jobs.push(
          stmt(
            `INSERT OR IGNORE INTO notifications(id,recipient,title,entity_type,entity_id,severity,source,created_at,read_at)
             SELECT ?||'-'||id,id,?,'session',?,'Action Required',?||':'||id,?,NULL
             FROM users WHERE active=1 AND roles LIKE '%Coach Operations%' AND ${sameSide(u, "id")}`,
            uid("NTF"),
            `Quality found a problem in the attendance of ${session.group_id} Week ${session.week}`,
            session.id,
            `attendance-check:${session.id}:${t}`,
            t,
          ),
        );
      await db().batch(jobs);
      return Response.json({ ok: true });
    }

    if (x.action === "clear") {
      ensure(can(u.roles, lead), "Only the Quality Lead removes a check.");
      ensure(previous, "This session has no check to remove.");
      await db().batch([
        stmt("DELETE FROM attendance_checks WHERE session_id=?", session.id),
        auditStmt(u, "Attendance check removed", session.id, null, previous, requestId),
      ]);
      return Response.json({ ok: true });
    }

    throw new Error("Choose an attendance check action.");
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
