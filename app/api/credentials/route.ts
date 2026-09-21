import { env } from "@/lib/env";
import { actor, permit, stmt, auditStmt, db, uid, now, rateLimit, scopeSql } from "@/lib/server";
import { can, ensure } from "@/lib/domain/rules";
import { credentialKey, credentialKeyConfigured, openCredential, sealCredential } from "@/lib/domain/account-secrets";

export const dynamic = "force-dynamic";

const custodians = ["Higher Board", "Operations Systems / Admin"];

/**
 * Whether this person may see the credential for this account.
 *
 * A custodian may always. Anyone else must be responsible for a group that is
 * currently using the account: coordinators and supervisors need the login to
 * run the work, and that is the whole point of the account pool. The check is
 * done in SQL against the same scope rule the rest of the workspace uses, so a
 * coordinator cannot reach another team's accounts.
 */
async function mayReveal(u: any, accountId: string) {
  if (can(u.roles, custodians)) return true;
  if (!can(u.roles, ["Project Operations", "Operations Coordinator", "Team Supervisor"])) return false;
  const scope = scopeSql(u);
  const row = await stmt(
    `SELECT n.id FROM account_assignments n JOIN groups g ON g.id=n.group_id WHERE n.account_id=? AND ${scope.sql} LIMIT 1`,
    accountId,
    ...scope.args,
  ).first();
  return Boolean(row);
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    await rateLimit("credentials:" + u.id, 12, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site credential access rejected.",
    );
    const x = await req.json();
    ensure(
      x.account_id && typeof x.purpose === "string" && x.purpose.trim().length >= 10,
      "Account and a meaningful access purpose are required.",
    );
    const a: any = await stmt("SELECT * FROM accounts WHERE id=?", x.account_id).first();
    ensure(a, "Account not found.");

    if (x.action === "set_reference") {
      permit(u, custodians);
      ensure(
        typeof x.reference === "string" && /^[A-Za-z0-9_/-]{1,160}$/.test(x.reference) && !x.reference.includes(".."),
        "Use a vault path containing letters, digits, slashes, hyphens or underscores.",
      );
      await db().batch([
        stmt("UPDATE accounts SET secret_ref=? WHERE id=?", x.reference, a.id),
        auditStmt(u, "Credential reference updated", a.id, { configured: true }, null, uid("REQ"), x.purpose),
      ]);
      return Response.json({ ok: true });
    }

    // Store the marketplace login itself, encrypted. This is the path that
    // replaces the credential columns of the old operations spreadsheet.
    if (x.action === "set_credential") {
      permit(u, custodians);
      const username = String(x.username ?? "").trim();
      const password = String(x.password ?? "");
      ensure(username.length >= 3 && username.length <= 320, "Enter the marketplace username.");
      ensure(password.length >= 6 && password.length <= 400, "Enter the marketplace password.");
      const sealed = await sealCredential(await credentialKey(env.CREDENTIAL_ENCRYPTION_KEY), a.id, username, password);
      await db().batch([
        stmt(
          `INSERT INTO account_secrets(account_id,username,secret,iv,updated_by,updated_at) VALUES(?,?,?,?,?,?)
           ON CONFLICT(account_id) DO UPDATE SET username=excluded.username,secret=excluded.secret,iv=excluded.iv,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
          a.id,
          sealed.username,
          sealed.secret,
          sealed.iv,
          u.id,
          now(),
        ),
        auditStmt(u, "Marketplace credential stored", a.id, { stored: true }, null, uid("REQ"), x.purpose),
      ]);
      return Response.json({ ok: true });
    }

    if (x.action === "report_exposure") {
      permit(u, [...custodians, "Project Operations", "Operations Coordinator", "Team Supervisor"]);
      ensure(await mayReveal(u, a.id), "This account is not used by a group you are responsible for.");
      await db().batch([
        stmt(
          "INSERT INTO cases(id,title,type,severity,status,owner,due,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          uid("CASE"),
          "Credential exposure: " + a.id,
          "Account",
          "S1 Critical",
          "Open",
          u.id,
          new Date(Date.now() + 3600000).toISOString(),
          uid("exposure"),
          now(),
        ),
        stmt("UPDATE accounts SET status='Blocked' WHERE id=? AND status<>'Retired'", a.id),
        auditStmt(u, "Credential exposure reported", a.id, { severity: "S1 Critical" }, null, uid("REQ"), x.purpose),
      ]);
      return Response.json({ ok: true });
    }

    ensure(x.action === "reveal", "Unsupported credential operation.");
    ensure(await mayReveal(u, a.id), "This account is not used by a group you are responsible for.");
    ensure(
      !["Retired", "Blocked", "Under Review"].includes(a.status),
      "Credential access is blocked for this account state.",
    );
    await auditStmt(u, "Credential access requested", a.id, { purpose: x.purpose }).run();

    // Preferred path: the credential this workspace holds, encrypted at rest.
    const stored: any = await stmt("SELECT * FROM account_secrets WHERE account_id=?", a.id).first();
    if (stored) {
      const opened = await openCredential(await credentialKey(env.CREDENTIAL_ENCRYPTION_KEY), a.id, stored);
      await auditStmt(u, "Credential access granted", a.id, {
        purpose: x.purpose,
        display_seconds: 30,
        source: "workspace",
      }).run();
      return Response.json(
        { username: opened.username, password: opened.password, expires_in: 30 },
        { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
      );
    }

    // Fallback: an external vault, for organizations that keep credentials there.
    ensure(
      env.VAULT_URL && env.VAULT_TOKEN,
      credentialKeyConfigured(env.CREDENTIAL_ENCRYPTION_KEY)
        ? "No credential is stored for this account yet."
        : "Store the marketplace credential, or connect the approved credential vault, before retrieving it.",
    );
    ensure(a.secret_ref, "No vault reference is configured for this account.");
    const base = new URL(env.VAULT_URL!);
    ensure(base.protocol === "https:" && !base.username && !base.password, "Vault endpoint must use HTTPS.");
    const url = new URL(base.href);
    url.pathname = url.pathname.replace(/\/$/, "") + "/" + a.secret_ref.split("/").map(encodeURIComponent).join("/");
    const r = await fetch(url, {
      headers: { Authorization: "Bearer " + env.VAULT_TOKEN, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    ensure(r.ok, "The vault refused the credential request.");
    ensure(Number(r.headers.get("content-length") || 0) <= 16000, "Vault response is too large.");
    const body = await r.text();
    ensure(body.length <= 16000, "Vault response is too large.");
    const v = JSON.parse(body);
    ensure(
      typeof v.username === "string" && typeof v.password === "string",
      "The vault response must contain username and password fields.",
    );
    await auditStmt(u, "Credential access granted", a.id, {
      purpose: x.purpose,
      display_seconds: 30,
      source: "vault",
    }).run();
    return Response.json(
      { username: v.username, password: v.password, expires_in: 30 },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
