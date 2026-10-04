import { env } from "@/lib/env";
import { actor, auditStmt, db, now, permit, rateLimit, stmt, uid } from "@/lib/server";
import { can, ensure } from "@/lib/domain/rules";
import { credentialKey, openCredential, sealCredential } from "@/lib/domain/account-secrets";
import { joinAccountId, type JoinKind } from "@/lib/domain/join-accounts";

export const dynamic = "force-dynamic";

const admin = ["Operations Systems / Admin"];

/**
 * Whether this person may see the login for this group.
 *
 * The coach's login (one per YAT group) is the group's coach's and Coach
 * Operations'. The coordinators' login (one per provider) is for the
 * coordinator of a group on that provider, the group's supervisor and Project
 * Operations. Administrators may see both.
 */
async function mayReveal(u: any, kind: JoinKind, group: any) {
  if (can(u.roles, admin)) return true;
  if (kind === "coach") {
    if (can(u.roles, ["Coach Operations"])) return true;
    if (!can(u.roles, ["Coach"])) return false;
    if (group.coach === u.id) return true;
    return Boolean(
      await stmt(
        "SELECT id FROM group_coaches WHERE group_id=? AND user_id=? AND status='Active'",
        group.id,
        u.id,
      ).first(),
    );
  }
  if (can(u.roles, ["Project Operations"])) return true;
  if (can(u.roles, ["Operations Coordinator"]) && group.coordinator === u.id) return true;
  return can(u.roles, ["Team Supervisor"]) && group.supervisor === u.id;
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    await rateLimit("join-accounts:" + u.id, 20, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site credential access rejected.",
    );
    const x = await req.json();
    const kind: JoinKind = x.kind === "coordinator" ? "coordinator" : "coach";
    ensure(x.kind === "coach" || x.kind === "coordinator", "Choose the coach or the coordinator login.");

    // An administrator keeps the logins up to date.
    if (x.action === "set") {
      permit(u, admin);
      const provider = String(x.provider ?? "").trim();
      const groupId = kind === "coach" ? String(x.group_id ?? "").trim() : null;
      if (groupId) ensure(await stmt("SELECT id FROM groups WHERE id=?", groupId).first(), "Group not found.");
      ensure(provider.length >= 2 && provider.length <= 40, "Name the training provider.");
      const username = String(x.username ?? "").trim();
      const password = String(x.password ?? "");
      ensure(username.length >= 3 && username.length <= 320, "Enter the login email or username.");
      ensure(password.length >= 1 && password.length <= 400, "Enter the password.");
      const id = joinAccountId(kind, groupId || provider);
      const sealed = await sealCredential(await credentialKey(env.CREDENTIAL_ENCRYPTION_KEY), id, username, password);
      await db().batch([
        stmt(
          `INSERT INTO join_accounts(id,kind,provider,group_id,username,secret,iv,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,username=excluded.username,secret=excluded.secret,iv=excluded.iv,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
          id, kind, provider, groupId, sealed.username, sealed.secret, sealed.iv, u.id, now(),
        ),
        auditStmt(u, "Join login stored", id, { kind, provider, group_id: groupId }, null, uid("REQ"), null),
      ]);
      return Response.json({ ok: true });
    }

    ensure(x.action === "reveal", "Unsupported operation.");
    const group: any = await stmt("SELECT * FROM groups WHERE id=?", String(x.group_id ?? "")).first();
    ensure(group, "Group not found.");
    ensure(await mayReveal(u, kind, group), "This login is not yours to see.");
    const id = joinAccountId(kind, kind === "coach" ? group.id : group.provider);
    const stored: any = await stmt("SELECT * FROM join_accounts WHERE id=?", id).first();
    ensure(
      stored,
      kind === "coach"
        ? `No coach login is stored for this group. On ${group.provider} the coach joins with their own email.`
        : `No coordinator login is stored for ${group.provider}.`,
    );
    const opened = await openCredential(await credentialKey(env.CREDENTIAL_ENCRYPTION_KEY), id, stored);
    await auditStmt(u, "Join login shown", id, { kind, group_id: group.id, display_seconds: 60 }, null, uid("REQ"), null).run();
    return Response.json(
      { username: opened.username, password: opened.password, expires_in: 60 },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
