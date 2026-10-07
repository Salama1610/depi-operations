import { actor, all, auditStmt, bucket, db, now, permit, rateLimit, stmt, uid } from "@/lib/server";
import { can, ensure } from "@/lib/domain/rules";
import { isDemo } from "@/lib/demo";
import { notify } from "@/lib/automation";

export const dynamic = "force-dynamic";

// Technical problems staff report from /support: bugs, access problems and
// error messages, never how-to questions (those go through the team). The
// system owner (an administrator) sees every report and works it to Resolved;
// everyone else sees their own.

const owner = ["Operations Systems / Admin"];
const categories = ["Bug", "Access", "Error"];
const severities = ["Blocking", "Major", "Minor"];
const statuses = ["Open", "In progress", "Resolved", "Not a bug"];

const sameOrigin = (req: Request) => !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin;
const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export async function GET(req: Request) {
  try {
    const u = await actor();
    await rateLimit("support-read:" + u.id, 120, 60);
    const admin = can(u.roles, owner);
    const url = new URL(req.url);

    // A report's screenshot, for its reporter and the system owner.
    const shot = url.searchParams.get("screenshot");
    if (shot) {
      const report: any = await stmt("SELECT reporter,screenshot_key,screenshot_type FROM support_reports WHERE id=?", shot).first();
      ensure(report?.screenshot_key && (admin || report.reporter === u.id), "Screenshot not found.");
      const object = await bucket().get(report.screenshot_key);
      ensure(object, "The screenshot could not be retrieved.");
      return new Response(object.body, {
        headers: { "Content-Type": report.screenshot_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" },
      });
    }

    if (isDemo(u)) return Response.json({ reports: [], admin: false, demo: true }, { headers: { "Cache-Control": "no-store" } });
    const columns =
      "r.id,r.reporter,p.name reporter_name,r.reporter_roles,r.page,r.url,r.category,r.severity,r.action,r.happened,r.expected,r.occurred_at,r.browser,r.screenshot_key IS NOT NULL has_screenshot,r.status,r.resolution,r.handled_by,h.name handled_by_name,r.handled_at,r.created_at";
    const reports = admin
      ? await all(`SELECT ${columns} FROM support_reports r LEFT JOIN users p ON p.id=r.reporter LEFT JOIN users h ON h.id=r.handled_by ORDER BY r.created_at DESC LIMIT 500`)
      : await all(`SELECT ${columns} FROM support_reports r LEFT JOIN users p ON p.id=r.reporter LEFT JOIN users h ON h.id=r.handled_by WHERE r.reporter=? ORDER BY r.created_at DESC LIMIT 100`, u.id);
    return Response.json({ reports, admin, me: { id: u.id, name: u.name, roles: u.roles } }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  let key: string | null = null;
  try {
    const u = await actor();
    ensure(sameOrigin(req), "Cross-site requests are not allowed.");
    ensure(!isDemo(u), "Reporting a problem is not available in the demo. Sign in with your own account.");

    // The system owner moves a report along.
    if ((req.headers.get("content-type") || "").includes("application/json")) {
      permit(u, owner);
      await rateLimit("support-update:" + u.id, 60, 60);
      const x = await req.json();
      ensure(x.action === "update", "Choose a support action.");
      ensure(statuses.includes(x.status), "Choose a status.");
      const resolution = text(x.resolution, 2000) || null;
      ensure(!["Resolved", "Not a bug"].includes(x.status) || resolution, "Write what was done before closing the report.");
      const report: any = await stmt("SELECT id FROM support_reports WHERE id=?", String(x.id || "")).first();
      ensure(report, "Report not found.");
      await db().batch([
        stmt("UPDATE support_reports SET status=?,resolution=?,handled_by=?,handled_at=? WHERE id=?", x.status, resolution, u.id, now(), report.id),
        auditStmt(u, "Technical problem updated", report.id, { status: x.status }, null, uid("REQ")),
      ]);
      return Response.json({ ok: true });
    }

    // Anyone on the staff reports a problem.
    await rateLimit("support-report:" + u.id, 10, 3600);
    ensure(Number(req.headers.get("content-length") || 0) <= 9 * 1024 * 1024, "Maximum screenshot size is 8 MB.");
    const form = await req.formData();
    const category = String(form.get("category") || "");
    const severity = String(form.get("severity") || "");
    ensure(categories.includes(category), "Choose what kind of problem it is.");
    ensure(severities.includes(severity), "Choose how much it blocks your work.");
    const page = text(form.get("page"), 80);
    const action = text(form.get("action"), 2000);
    const happened = text(form.get("happened"), 2000);
    ensure(page, "Choose the page where it happened.");
    ensure(action.length >= 5, "Describe what you did.");
    ensure(happened.length >= 5, "Describe what happened.");
    const occurred = String(form.get("occurred_at") || "");
    const occurredAt = Number.isFinite(Date.parse(occurred)) ? new Date(occurred).toISOString() : now();
    ensure(Date.parse(occurredAt) <= Date.now() + 5 * 60000, "The time it happened cannot be in the future.");

    const id = uid("SUP");
    let type: string | null = null;
    const file = form.get("screenshot");
    if (file && typeof file !== "string" && file.size > 0) {
      ensure(file.size <= 8 * 1024 * 1024, "Maximum screenshot size is 8 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      ensure(png || jpg, "The screenshot must be a PNG or JPEG image.");
      type = png ? "image/png" : "image/jpeg";
      key = "support/" + crypto.randomUUID();
      await bucket().put(key, bytes, { httpMetadata: { contentType: type } });
    }

    const admins = (await all("SELECT id FROM users WHERE active=1 AND roles LIKE '%Operations Systems / Admin%' AND id NOT LIKE 'DEMO-%'")).map((r: any) => r.id);
    await db().batch([
      stmt(
        "INSERT INTO support_reports(id,reporter,reporter_roles,page,url,category,severity,action,happened,expected,occurred_at,browser,screenshot_key,screenshot_type,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id, u.id, (u.roles || []).join(", "), page, text(form.get("url"), 300) || null, category, severity, action, happened,
        text(form.get("expected"), 2000) || null, occurredAt, text(req.headers.get("user-agent"), 300) || null, key, type, "Open", now(),
      ),
      ...admins.map((admin: string) => notify(admin, `Technical problem (${severity}): ${page}`, "support", id, severity === "Blocking" ? "Urgent" : "Action Required", "support:" + id + ":" + admin)),
      auditStmt(u, "Technical problem reported", id, { page, category, severity }, null, uid("REQ")),
    ]);
    return Response.json({ ok: true, id });
  } catch (e: any) {
    if (key) await bucket().delete(key).catch(() => {});
    return Response.json({ error: e.message }, { status: 400 });
  }
}
