import { all, auditStmt, db, stmt, uid } from "@/lib/server";
import { openCredential, sealCredential } from "@/lib/domain/account-secrets";

/**
 * Seals again, each value under its own IV, every stored login still in the
 * old format, where a username and its password shared one IV (see
 * sealCredential). It runs after any successful reveal, when the configured key
 * is known to be the right one, so the old rows are gone after the first few
 * reveals; after that the query finds nothing. A row that cannot be opened
 * is left as it is rather than stopping the reveal that triggered this.
 */
export async function resealLegacyCredentials(u: any, key: CryptoKey) {
  const jobs: any[] = [];
  const reseal = async (table: "join_accounts" | "account_secrets", idColumn: "id" | "account_id") => {
    // A hundred at a time, so the reveal that triggers this stays quick; the
    // rest follow on the next reveals.
    const rows = await all(`SELECT ${idColumn} id,username,secret,iv FROM ${table} WHERE iv NOT LIKE '%.%' LIMIT 100`);
    for (const row of rows) {
      try {
        const opened = await openCredential(key, row.id, row);
        const sealed = await sealCredential(key, row.id, opened.username, opened.password);
        jobs.push(stmt(`UPDATE ${table} SET username=?,secret=?,iv=? WHERE ${idColumn}=? AND iv=?`, sealed.username, sealed.secret, sealed.iv, row.id, row.iv));
      } catch {
        // Written under another key, or damaged: leave it for an administrator.
      }
    }
  };
  await reseal("join_accounts", "id");
  await reseal("account_secrets", "account_id");
  if (!jobs.length) return 0;
  await db().batch([...jobs, auditStmt(u, "Stored logins re-encrypted", "credentials", { rows: jobs.length }, null, uid("REQ"))]);
  return jobs.length;
}
