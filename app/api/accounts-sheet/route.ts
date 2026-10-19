import { env } from "@/lib/env";
import { actor, all, auditStmt, db, keepsAccounts, now, rateLimit, refuseDemo, stmt, uid } from "@/lib/server";
import { ensure } from "@/lib/domain/rules";
import { credentialKey, sealCredential } from "@/lib/domain/account-secrets";
import { readAccountRows } from "@/lib/domain/accounts-sheet";

export const dynamic = "force-dynamic";

// Upload of the team's own accounts sheet (lib/domain/accounts-sheet.ts),
// in place of a template. The first call (apply: false) only counts what
// would change; the second writes it.
//
// An upload only ADDS accounts (19 October 2026): an account the sheet lists
// that the app does not have yet is added with its opening credit and its
// sealed password. An account the app already has (the same email on the same
// marketplace) is left exactly as it is: its state, credit, coordinator,
// student and password are kept, whatever the sheet says, and it is counted.
// For the people who keep the accounts only. Passwords are never returned.

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
    const live = new Set((await all("SELECT id FROM accounts")).map((a: any) => a.id as string));
    const t = now();
    const n = { new: 0, already_in_app: 0 };
    const jobs: any[] = [];
    for (const a of read.accounts) {
      if (live.has(a.id)) {
        n.already_in_app++;
        continue;
      }
      n.new++;
      const sealed = await sealCredential(key, a.id, a.label, a.password);
      // The account first: its password row points at it.
      jobs.push(
        stmt("INSERT INTO accounts(id,platform,label,status,credits,pending_credits,owner_name,comments) VALUES(?,?,?,?,?,?,?,?)", a.id, a.platform, a.label, a.status, a.credits, a.pending, a.owner, a.comments),
        stmt(
          "INSERT INTO account_secrets(account_id,username,secret,iv,updated_by,updated_at) VALUES(?,?,?,?,?,?)",
          a.id, sealed.username, sealed.secret, sealed.iv, u.id, t,
        ),
      );
      if (a.credits > 0)
        jobs.push(
          stmt(
            "INSERT INTO account_credit_ledger(id,account_id,delta,balance_after,reason,actor,created_at) VALUES(?,?,?,?,?,?,?)",
            uid("CR"), a.id, a.credits, a.credits, "Opening balance from the accounts sheet", u.id, t,
          ),
        );
    }
    const ids = new Set(read.accounts.map((a) => a.id));
    const summary = {
      accounts: read.accounts.length,
      ...n,
      repeated_in_sheet: read.repeated,
      skipped: read.skipped,
      only_in_app: [...live].filter((id) => !ids.has(id)).length,
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
