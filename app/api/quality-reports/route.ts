import { actor, all, auditStmt, db, now, permit, rateLimit, refuseDemo, stmt, uid } from "@/lib/server";
import { can, ensure } from "@/lib/domain/rules";

export const dynamic = "force-dynamic";

// Problems the quality team reports about a group (20 October 2026).
//
// A Quality Member or the Quality Lead picks the group by its code, describes
// the problem and chooses who it goes to: Coach Operations, Project Operations
// or both. Everyone holding that role gets a notification and reads it here,
// and marks it handled with a note. The quality team reads every report; Coach
// and Project Operations read the ones sent to them; the administrators
// (Abdelrahman Salama and Abdelrahman Shoman among them) read them all.
const team = ["Quality Member", "Quality Lead"];
const readers = [...team, "Coach Operations", "Project Operations", "Operations Systems / Admin"];
const audiences = ["Coach Operations", "Project Operations", "Both"];
const noStore = { headers: { "Cache-Control": "no-store" } };

/** The reports this person may read, as a SQL condition on r.audience. */
function visible(u: any) {
  if (can(u.roles, [...team, "Operations Systems / Admin"])) return "1=1";
  const mine = ["'Both'"];
  if (can(u.roles, ["Coach Operations"])) mine.push("'Coach Operations'");
  if (can(u.roles, ["Project Operations"])) mine.push("'Project Operations'");
  return `r.audience IN (${mine.join(",")})`;
}
/** Whether this person is one a report is sent to, and so may mark it handled. */
function handles(u: any, audience: string) {
  if (can(u.roles, ["Operations Systems / Admin"])) return true;
  if (audience === "Both") return can(u.roles, ["Coach Operations", "Project Operations"]);
  return can(u.roles, [audience]);
}

export async function GET() {
  try {
    const u = await actor();
    refuseDemo(u);
    permit(u, readers);
    await rateLimit("quality-reports:" + u.id, 60, 60);
    const [reports, groups] = await Promise.all([
      all(
        `SELECT r.*,g.track,g.provider,c.name coordinator_name,h.name coach_name,a.name created_by_name,b.name handled_by_name
         FROM quality_reports r JOIN groups g ON g.id=r.group_id
         LEFT JOIN users c ON c.id=g.coordinator LEFT JOIN users h ON h.id=g.coach
         LEFT JOIN users a ON a.id=r.created_by LEFT JOIN users b ON b.id=r.handled_by
         WHERE ${visible(u)} ORDER BY r.status='Open' DESC, r.created_at DESC LIMIT 2000`,
      ),
      can(u.roles, [...team, "Operations Systems / Admin"])
        ? all(
            `SELECT g.id,g.track,g.provider FROM groups g
             WHERE g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND coalesce(g.delivery_model,'Regular')<>'Industry' ORDER BY g.id`,
          )
        : Promise.resolve([] as any[]),
    ]);
    return Response.json(
      {
        reports: reports.map((r: any) => ({ ...r, can_handle: handles(u, r.audience) })),
        groups,
        reports_problems: can(u.roles, [...team, "Operations Systems / Admin"]),
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
    refuseDemo(u);
    permit(u, readers);
    await rateLimit("quality-reports-write:" + u.id, 60, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();
    const t = now();

    if (x.action === "report") {
      permit(u, team);
      const group: any = await stmt("SELECT id FROM groups WHERE id=? AND id NOT LIKE 'DEMO-%'", String(x.group_id || "")).first();
      ensure(group, "Choose the group the problem is about.");
      ensure(audiences.includes(x.audience), "Choose who the report goes to.");
      const description = String(x.description || "").trim();
      ensure(description.length >= 5, "Describe the problem.");
      ensure(description.length <= 2000, "Keep the description under 2,000 characters.");
      const id = uid("QRP");
      const roles = x.audience === "Both" ? ["Coach Operations", "Project Operations"] : [x.audience];
      const recipients = (await all("SELECT id,roles FROM users WHERE active=1 AND id NOT LIKE 'DEMO-%' AND id<>?", u.id)).filter((p: any) => {
        const held = typeof p.roles === "string" ? JSON.parse(p.roles || "[]") : p.roles || [];
        return roles.some((r) => held.includes(r));
      });
      const title = `Quality reported a problem in ${group.id}: ${description}`.slice(0, 300);
      await db().batch([
        stmt(
          "INSERT INTO quality_reports(id,group_id,audience,description,created_by,created_at,status) VALUES(?,?,?,?,?,?,?)",
          id, group.id, x.audience, description, u.id, t, "Open",
        ),
        ...recipients.map((p: any) =>
          stmt(
            "INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?,?,?)",
            uid("NTF"), p.id, title, "group", group.id, "Action Required", `quality-report:${id}:${p.id}`, t, null,
          ),
        ),
        auditStmt(u, "Quality problem reported", id, { group_id: group.id, audience: x.audience, description, notified: recipients.length }),
      ]);
      return Response.json({ ok: true, id, notified: recipients.length });
    }

    if (x.action === "handle") {
      // The people it was sent to mark it handled (or open it again), with a note.
      const r: any = await stmt("SELECT * FROM quality_reports WHERE id=?", String(x.id || "")).first();
      ensure(r, "Report not found.");
      ensure(handles(u, r.audience), "Only the people this report was sent to can mark it handled.");
      const done = x.status !== "Open";
      const note = String(x.note || "").trim();
      ensure(note.length <= 1000, "Keep the note under 1,000 characters.");
      await db().batch([
        stmt(
          "UPDATE quality_reports SET status=?,handled_by=?,handled_at=?,handled_note=? WHERE id=?",
          done ? "Handled" : "Open", done ? u.id : null, done ? t : null, done ? note || null : null, r.id,
        ),
        // The reporter hears that it was handled.
        ...(done && r.created_by !== u.id
          ? [stmt("INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?,?,?)", uid("NTF"), r.created_by, `Your report on ${r.group_id} was handled${note ? ": " + note : ""}`.slice(0, 300), "group", r.group_id, "Information", `quality-report-handled:${r.id}:${t}`, t, null)]
          : []),
        auditStmt(u, done ? "Quality report handled" : "Quality report reopened", r.id, { note: note || null }, r),
      ]);
      return Response.json({ ok: true });
    }

    throw new Error("Choose a report action.");
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
