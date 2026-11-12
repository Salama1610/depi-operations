// No signed-in client reads the database directly. A national ID is a first
// password, and the row-level policies were far looser than the app's own
// scope, so since 12 November 2026 the anon and authenticated roles hold no
// privilege on any application table: every read goes through the server.
import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { startPostgresTestDatabase } from "./helpers/postgres-test-db.mjs";

test("a signed-in or anonymous client cannot read any application table from the database", async () => {
  const handle = await startPostgresTestDatabase();
  const sql = postgres(handle.url, { max: 1, prepare: false, onnotice: () => {} });
  const as = (role, query) =>
    sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      return tx.unsafe(query);
    });
  try {
    const tables = (await sql`select tablename from pg_tables where schemaname = 'public'`).map((r) => r.tablename);
    assert.ok(tables.includes("students") && tables.includes("account_secrets"), "the schema is loaded");
    for (const role of ["authenticated", "anon"]) {
      for (const table of tables) await assert.rejects(as(role, `select 1 from public.${table} limit 1`), /permission denied/, `${role} cannot read ${table}`);
      await assert.rejects(as(role, "select national_id from public.students"), /permission denied/);
      await assert.rejects(as(role, "select public.depi_execute('[]'::jsonb)"), /permission denied/, `${role} cannot run SQL`);
    }
  } finally {
    await sql.end();
    await handle.stop();
  }
});
