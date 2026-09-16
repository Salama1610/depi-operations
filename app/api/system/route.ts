import { env } from "cloudflare:workers";
import { actor, permit, all, stmt, auditStmt, db, uid, now, rateLimit } from "@/lib/server";
import { ensure } from "@/lib/domain/rules";

export async function GET() {
  try {
    const u = await actor();
    await rateLimit("system:" + u.id, 60, 60);
    permit(u, ["Operations Systems / Admin"]);
    const [missingEmail, duplicateEmails, roster] = await Promise.all([
      all("SELECT id,name,group_id,lifecycle FROM students WHERE email IS NULL OR trim(email)='' ORDER BY group_id,id LIMIT 500"),
      all("SELECT lower(email) email,count(*) count,group_concat(id) student_ids FROM students WHERE email IS NOT NULL AND trim(email)<>'' GROUP BY lower(email) HAVING count(*)>1 ORDER BY count(*) DESC LIMIT 100"),
      stmt("SELECT count(*) total,sum(CASE WHEN lifecycle='Active' THEN 1 ELSE 0 END) active,sum(CASE WHEN email IS NULL OR trim(email)='' THEN 1 ELSE 0 END) missing_email FROM students").first(),
    ]);
    return Response.json({
      connections: {
        automation: Boolean(env.AUTOMATION_HMAC_SECRET && env.AUTOMATION_ACTOR_EMAIL),
        vault: Boolean(env.VAULT_URL && env.VAULT_TOKEN),
        backup_encryption: Boolean(env.BACKUP_ENCRYPTION_KEY),
      },
      roster: { ...roster, duplicate_emails: duplicateEmails, missing_email_rows: missingEmail },
      runs: await all("SELECT id,kind,status,result,created_at,updated_at FROM automation_runs ORDER BY created_at DESC LIMIT 50"),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 403 });
  }
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    await rateLimit("system-write:" + u.id, 20, 60);
    permit(u, ["Operations Systems / Admin"]);
    ensure(!req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin, "Cross-site action rejected.");
    const x = await req.json();
    ensure(x.action === "retry_run" && x.reason?.trim(), "Choose a failed run and record the retry reason.");
    const run: any = await stmt("SELECT * FROM automation_runs WHERE id=?", x.id).first();
    ensure(run && (run.status === "Failed" || run.status === "Running" && Date.now() - Date.parse(run.updated_at) > 15 * 60000), "Only failed or stale runs can be released for retry.");
    await db().batch([
      stmt("UPDATE automation_runs SET status='Retryable',updated_at=? WHERE id=? AND status=?", now(), x.id, run.status),
      auditStmt(u, "Automation retry authorized", x.id, { status: "Retryable" }, run, uid("REQ"), x.reason),
    ]);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
