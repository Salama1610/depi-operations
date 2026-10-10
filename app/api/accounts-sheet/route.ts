import { env } from "@/lib/env";
import { actor, all, auditStmt, db, keepsAccounts, now, rateLimit, refuseDemo, stmt, uid } from "@/lib/server";
import { ensure } from "@/lib/domain/rules";
import { credentialKey, openCredential, sealCredential } from "@/lib/domain/account-secrets";
import { readAccountRows } from "@/lib/domain/accounts-sheet";

export const dynamic = "force-dynamic";

// Upload of the team's own accounts sheet (lib/domain/accounts-sheet.ts),
// in place of a template. The first call (apply: false) only counts what
// would change; the second writes it. For each account:
//  - a new one is added with its opening credit;
//  - its status follows the sheet unless the app has it in use or decided
//    (Assigned, Cooldown, Blocked, Funding Block and Retired are kept);
//  - its credit follows the sheet with a correction in the credit history,
//    unless the app has recorded credit changes of its own since the import;
//  - pending credit, the coordinator named in the sheet (the owner column)
//    and the comments follow the sheet;
//  - the password is sealed again when it differs from the stored one.
// Accounts in the app but not in the sheet are left alone and counted.
// For the people who keep the accounts only. Passwords are never returned.

const kept = new Set(["Assigned", "Cooldown", "Blocked", "Funding Block", "Retired"]);

export async function POST(req: Request) {
  try {
    const u = await actor();
    refuseDemo(u);
    ensure(keepsAccounts(u), "The accounts sheet is uploaded by the people who keep the accounts.");
    await rateLimit("accounts-sheet:" + u.id, 10, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site upload rejected.",
    );
    const x = await req.json();
    const rows = Array.isArray(x.rows) ? x.rows : [];
    ensure(rows.length > 0 && rows.length <= 3000, "Upload between 1 and 3,000 rows.");
    const read = await readAccountRows(
      rows.map((r: any) => ({ sheet: String(r.sheet || "").slice(0, 60), cells: (Array.isArray(r.cells) ? r.cells : []).slice(0, 12).map((c: any) => String(c ?? "").slice(0, 400)) })),
    );
    const key = await credentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    const live = new Map((await all("SELECT * FROM accounts")).map((a: any) => [a.id, a]));
    const secrets = new Map((await all("SELECT * FROM account_secrets")).map((s: any) => [s.account_id, s]));
    const moved = new Set(
      (await all("SELECT DISTINCT account_id FROM account_credit_ledger WHERE reason NOT LIKE 'Opening balance%'")).map((r: any) => r.account_id),
    );
    const t = now();
    const n = { new: 0, status: 0, status_kept: 0, credit: 0, credit_kept: 0, pending: 0, owner: 0, comments: 0, password: 0, unchanged: 0 };
    const jobs: any[] = [];
    for (const a of read.accounts) {
      const cur: any = live.get(a.id);
      const secret = secrets.get(a.id);
      let stored: string | null = null;
      if (secret)
        try {
          stored = (await openCredential(key, a.id, secret)).password;
        } catch {
          stored = null;
        }
      const reseal = stored !== a.password;
      const sealJobs: any[] = [];
      if (reseal) {
        n.password++;
        const sealed = await sealCredential(key, a.id, a.label, a.password);
        sealJobs.push(
          stmt(
            `INSERT INTO account_secrets(account_id,username,secret,iv,updated_by,updated_at) VALUES(?,?,?,?,?,?)
             ON CONFLICT(account_id) DO UPDATE SET username=excluded.username,secret=excluded.secret,iv=excluded.iv,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
            a.id, sealed.username, sealed.secret, sealed.iv, u.id, t,
          ),
        );
      }
      if (!cur) {
        n.new++;
        jobs.push(
          stmt("INSERT INTO accounts(id,platform,label,status,credits,pending_credits,owner_name,comments) VALUES(?,?,?,?,?,?,?,?)", a.id, a.platform, a.label, a.status, a.credits, a.pending, a.owner, a.comments),
        );
        if (a.credits > 0)
          jobs.push(
            stmt(
              "INSERT INTO account_credit_ledger(id,account_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?)",
              uid("CR"), a.id, a.credits, a.credits, "Opening balance from the accounts sheet", u.id, t,
            ),
          );
        jobs.push(...sealJobs);
        continue;
      }
      const sets: string[] = [];
      const args: any[] = [];
      if (cur.status !== a.status) {
        if (kept.has(cur.status)) n.status_kept++;
        else {
          n.status++;
          sets.push("status=?");
          args.push(a.status);
        }
      }
      if (Math.abs(Number(cur.credits) - a.credits) > 0.004) {
        if (moved.has(a.id)) n.credit_kept++;
        else {
          n.credit++;
          sets.push("credits=?");
          args.push(a.credits);
          jobs.push(
            stmt(
              "INSERT INTO account_credit_ledger(id,account_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?)",
              uid("CR"), a.id, Math.round((a.credits - Number(cur.credits)) * 100) / 100, a.credits, "Balance corrected from the accounts sheet", u.id, t,
            ),
          );
        }
      }
      if (Math.abs(Number(cur.pending_credits || 0) - a.pending) > 0.004) {
        n.pending++;
        sets.push("pending_credits=?");
        args.push(a.pending);
      }
      if ((cur.owner_name || null) !== (a.owner || null)) {
        n.owner++;
        sets.push("owner_name=?");
        args.push(a.owner);
      }
      if ((cur.comments || null) !== (a.comments || null)) {
        n.comments++;
        sets.push("comments=?");
        args.push(a.comments);
      }
      if (sets.length) jobs.push(stmt(`UPDATE accounts SET ${sets.join(",")} WHERE id=?`, ...args, a.id));
      else if (!reseal) n.unchanged++;
      jobs.push(...sealJobs);
    }
    const ids = new Set(read.accounts.map((a) => a.id));
    const summary = {
      accounts: read.accounts.length,
      ...n,
      repeated_in_sheet: read.repeated,
      skipped: read.skipped,
      only_in_app: [...live.keys()].filter((id) => !ids.has(id)).length,
    };
    if (x.apply === true) {
      for (let i = 0; i < jobs.length; i += 150) await db().batch(jobs.slice(i, i + 150));
      await auditStmt(u, "Accounts sheet uploaded", "accounts", { ...summary, skipped: undefined }).run();
    }
    return Response.json({ ok: true, applied: x.apply === true, summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
