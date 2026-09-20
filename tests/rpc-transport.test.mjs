// Unit tests for the HTTPS SQL transport (lib/data/rpc.ts): literal inlining,
// statement classification, row normalization, PostgREST error mapping and the
// fetch caller. The end-to-end behaviour against PostgreSQL is covered by
// tests/integration-postgres-rpc.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bareStatement,
  createRpcCaller,
  createRpcDatabase,
  inlineParameters,
  literal,
  normalizeRow,
  rpcError,
  statementMode,
} from "../lib/data/rpc.ts";
import { columnTypes } from "./helpers/postgres-test-db.mjs";

test("literals stay untyped so PostgreSQL coerces them to the column type", () => {
  assert.equal(literal(null), "NULL");
  assert.equal(literal(undefined), "NULL");
  assert.equal(literal(true), "TRUE");
  assert.equal(literal(false), "FALSE");
  assert.equal(literal(1), "'1'");
  assert.equal(literal(12.5), "'12.5'");
  assert.equal(literal(10n), "'10'");
  assert.equal(literal("it's"), "E'it''s'");
  assert.equal(literal("a\\b"), "E'a\\\\b'");
  assert.equal(literal(new Date("2026-09-20T10:00:00.000Z")), "E'2026-09-20T10:00:00.000Z'");
  assert.equal(literal({ a: 1 }), `E'{"a":1}'`);
  assert.throws(() => literal(Number.NaN), /non-finite/);
  assert.throws(() => literal("x\0y"), /NUL/);
});

test("parameters are inlined outside quoted literals only", () => {
  assert.equal(
    inlineParameters("SELECT * FROM t WHERE a=$1 AND b='$2 literal' AND c=$2", ["x", 2]),
    "SELECT * FROM t WHERE a=E'x' AND b='$2 literal' AND c='2'",
  );
  assert.throws(() => inlineParameters("SELECT $2", ["only one"]), /parameter \$2/);
});

test("statement mode and trailing semicolons", () => {
  assert.equal(statementMode("SELECT 1"), "rows");
  assert.equal(statementMode("  with x as (select 1) select * from x"), "rows");
  assert.equal(statementMode("INSERT INTO t VALUES(1) RETURNING id"), "rows");
  assert.equal(statementMode("INSERT INTO t VALUES('returning')"), "exec");
  assert.equal(statementMode("UPDATE t SET a=1"), "exec");
  assert.equal(bareStatement("SELECT 1;;  "), "SELECT 1");
});

test("rows from to_jsonb() are normalized to the D1 value shapes", () => {
  assert.deepEqual(
    normalizeRow({
      active: true,
      task_fit: false,
      roles: ["Coach"],
      config: { a: 1 },
      created_at: "2026-09-16T19:47:26+00:00",
      start_date: "2026-09-16",
      note: "2026-09-16T19:47:26.000Z",
      amount: 12.5,
      nothing: null,
    }),
    {
      active: 1,
      task_fit: 0,
      roles: '["Coach"]',
      config: '{"a":1}',
      created_at: "2026-09-16T19:47:26.000Z",
      start_date: "2026-09-16",
      note: "2026-09-16T19:47:26.000Z",
      amount: 12.5,
      nothing: null,
    },
  );
});

test("PostgREST errors keep the constraint wording the routes recognise", () => {
  const unique = rpcError(409, {
    code: "23505",
    message: 'duplicate key value violates unique constraint "students_pkey"',
    details: "Key (id)=(S1) already exists.",
  });
  assert.match(unique.message, /^UNIQUE constraint failed: students_pkey/);
  assert.equal(unique.code, "23505");
  const fk = rpcError(409, {
    code: "23503",
    message: 'insert or update on table "attachments" violates foreign key constraint "attachments_student_id_fkey"',
    details: "Key (student_id)=(S1) is not present in table \"students\".",
  });
  assert.match(fk.message, /^FOREIGN KEY constraint failed: attachments\.attachments_student_id_fkey/);
  const plain = rpcError(500, "<html>gateway</html>");
  assert.match(plain.message, /HTTP 500/);
});

test("the fetch caller posts statements with the service role and maps failures", async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1)
      return new Response(JSON.stringify([{ rows: [{ n: 2, active: true }], changes: 1 }]), { status: 200 });
    return new Response(JSON.stringify({ code: "23505", message: 'duplicate key value violates unique constraint "x"' }), {
      status: 409,
    });
  };
  const caller = createRpcCaller("https://example.supabase.co/", "service-key", { fetch: fetchMock });
  const db = createRpcDatabase(caller, { columnTypes: columnTypes() });
  const row = await db.prepare("SELECT count(*) n, active FROM users WHERE active=? AND id=?").bind(1, "u1").first();
  assert.deepEqual(row, { n: 2, active: 1 });
  assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/rpc/depi_execute");
  assert.equal(calls[0].init.headers.apikey, "service-key");
  assert.equal(calls[0].init.headers.Authorization, "Bearer service-key");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.statements, [
    { sql: "SELECT count(*) n, active FROM users WHERE active='1' AND id=E'u1'", mode: "rows" },
  ]);
  await assert.rejects(db.prepare("INSERT INTO users(id) VALUES(?)").bind("u1").run(), /UNIQUE constraint failed/);
});

test("batches send every statement in one call and skip SQLite trigger DDL", async () => {
  let sent;
  const caller = async (statements) => {
    sent = statements;
    return statements.map(() => ({ rows: [], changes: 1 }));
  };
  const db = createRpcDatabase(caller, { columnTypes: columnTypes() });
  const results = await db.batch([
    db.prepare("CREATE TRIGGER IF NOT EXISTS x BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'x'); END"),
    db.prepare("INSERT OR IGNORE INTO notifications(id) VALUES(?)").bind("n1"),
    db.prepare("UPDATE users SET active=? WHERE id=?").bind(0, "u1"),
  ]);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].sql, "INSERT INTO notifications(id) VALUES(E'n1') ON CONFLICT DO NOTHING");
  assert.equal(sent[1].sql, "UPDATE users SET active='0' WHERE id=E'u1'");
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], { results: [], success: true, meta: { changes: 0 } });
  assert.equal(results[1].meta.changes, 1);
});
