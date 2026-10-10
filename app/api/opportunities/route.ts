import { actor, all, auditStmt, currentStudent, db, now, rateLimit, stmt, uid } from "@/lib/server";
import { can, ensure } from "@/lib/domain/rules";
import { sameSide } from "@/lib/demo";

export const dynamic = "force-dynamic";

// Work opportunities found on the freelance platforms. The Target Team's
// coordinators, every team supervisor, the coaches and Project Operations post
// the link, what the job is, the track it suits, the platform and the day it
// was posted there, one at a time, and all of them see every post. A student
// sees the active ones for their own track. (9 and 10 October 2026.)

const noStore = { headers: { "Cache-Control": "no-store" } };

/** Supervisors, Project Operations and administrators: they also remove anyone's post. */
const leads = (u: any) => can(u.roles, ["Team Supervisor", "Project Operations", "Operations Systems / Admin"]);
/** Those leaders, the coaches and the Target Team's coordinators post and read. */
const posts = (u: any) =>
  leads(u) || can(u.roles, ["Coach"]) || (can(u.roles, ["Operations Coordinator"]) && u.team === "Target Team");
const reads = posts;

/** The tracks a post can be for: the tracks of the groups on the caller's side. */
async function tracksFor(u: any) {
  const rows = await all(
    `SELECT DISTINCT g.track FROM groups g WHERE g.track IS NOT NULL AND trim(g.track)<>'' AND COALESCE(g.delivery_model,'Regular')<>'Industry' AND ${sameSide(u, "g.id")} ORDER BY g.track`,
  );
  return rows.map((r: any) => String(r.track));
}

export async function GET() {
  try {
    let staff: any = null;
    try {
      staff = await actor();
    } catch {
      // Not on the staff: a student, or nobody.
    }
    if (staff) {
      ensure(reads(staff), "Opportunities are for the Target Team, the supervisors, the coaches and Project Operations.");
      await rateLimit("opportunities:" + staff.id, 60, 60);
      const opportunities = await all(
        `SELECT o.id,o.url,o.title,o.track,o.platform,o.posted_on,o.status,o.created_by,p.name created_by_name,o.created_at
         FROM opportunities o LEFT JOIN users p ON p.id=o.created_by
         WHERE o.status='Active' AND ${sameSide(staff, "o.created_by")} ORDER BY o.posted_on DESC,o.created_at DESC LIMIT 1000`,
      );
      return Response.json({ opportunities, tracks: await tracksFor(staff), posts: posts(staff), leads: leads(staff), me: staff.id }, noStore);
    }
    const s: any = await currentStudent();
    await rateLimit("opportunities-student:" + s.id, 60, 60);
    const opportunities = s.track
      ? await all(
          `SELECT o.id,o.url,o.title,o.track,o.platform,o.posted_on FROM opportunities o
           WHERE o.status='Active' AND o.track=? AND ${sameSide(s, "o.created_by")} ORDER BY o.posted_on DESC,o.created_at DESC LIMIT 200`,
          s.track,
        )
      : [];
    return Response.json({ opportunities, track: s.track || null }, noStore);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    await rateLimit("opportunities-write:" + u.id, 60, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();

    if (x.action === "remove") {
      const row: any = await stmt(`SELECT id,created_by FROM opportunities WHERE id=? AND status='Active' AND ${sameSide(u, "created_by")}`, String(x.id || "")).first();
      ensure(row, "Opportunity not found.");
      ensure(row.created_by === u.id || leads(u), "Only the person who posted it, a supervisor or Project Operations removes an opportunity.");
      await db().batch([
        stmt("UPDATE opportunities SET status='Removed',removed_by=?,removed_at=? WHERE id=?", u.id, now(), row.id),
        auditStmt(u, "Opportunity removed", row.id, { status: "Removed" }, null, uid("REQ")),
      ]);
      return Response.json({ ok: true });
    }

    ensure(x.action === "post", "Choose an opportunity action.");
    ensure(posts(u), "Only the Target Team, the supervisors, the coaches and Project Operations post opportunities.");
    const title = String(x.title ?? "").trim();
    const platform = String(x.platform ?? "").trim();
    const track = String(x.track ?? "").trim();
    const posted = String(x.posted_on ?? "").trim();
    ensure(title.length >= 3 && title.length <= 200, "Describe the job in 3 to 200 characters.");
    ensure(platform.length >= 2 && platform.length <= 60, "Name the platform.");
    ensure((await tracksFor(u)).includes(track), "Choose the track this job suits.");
    ensure(/^\d{4}-\d{2}-\d{2}$/.test(posted) && Number.isFinite(Date.parse(posted)), "Enter the date the job was posted.");
    ensure(Date.parse(posted) <= Date.now() + 86400000, "The posting date cannot be in the future.");
    let url: URL;
    try {
      url = new URL(String(x.url ?? "").trim());
    } catch {
      throw new Error("Enter the job's full link, starting with https://");
    }
    ensure(url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2000, "Enter the job's full link, starting with https://");
    ensure(
      !(await stmt(`SELECT id FROM opportunities WHERE url=? AND track=? AND status='Active' AND ${sameSide(u, "created_by")}`, url.href, track).first()),
      "This link is already posted for this track.",
    );
    const id = uid("OPP");
    await db().batch([
      stmt(
        "INSERT INTO opportunities(id,url,title,track,platform,posted_on,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id, url.href, title, track, platform, posted, "Active", u.id, now(),
      ),
      auditStmt(u, "Opportunity posted", id, { track, platform }, null, uid("REQ")),
    ]);
    return Response.json({ ok: true, id });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
