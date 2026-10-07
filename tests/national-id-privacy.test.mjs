// A national ID is a first password. The database must not hand it to a
// signed-in client through PostgREST, whatever the row-level policies allow;
// the rest of the record stays readable as before.
import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { startPostgresTestDatabase } from "./helpers/postgres-test-db.mjs";

test("a signed-in client cannot read national IDs from the database, but can read the other columns", async () => {
  const handle = await startPostgresTestDatabase();
  const sql = postgres(handle.url, { max: 1, prepare: false, onnotice: () => {} });
  const asClient = (query) =>
    sql.begin(async (tx) => {
      await tx.unsafe("set local role authenticated");
      return tx.unsafe(query);
    });
  try {
    for (const table of ["users", "students"]) {
      await assert.rejects(asClient(`select national_id from public.${table}`), /permission denied/, `${table}.national_id is hidden`);
      await assert.rejects(asClient(`select * from public.${table}`), /permission denied/, `select * on ${table} would include it`);
      await asClient(`select id from public.${table}`);
    }
    await asClient("select id, name, email, roles, title, team, phone from public.users");
    await asClient("select id, name, email, group_id, lifecycle from public.students");
  } finally {
    await sql.end();
    await handle.stop();
  }
});
