import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPostgresDatabase, isoTimestamp, normalizeDatabaseError, translateSql } from "../lib/data/postgres.ts";
import { columnTypes, dialectOptions, migrationFiles, startPostgresTestDatabase } from "./helpers/postgres-test-db.mjs";

const options = dialectOptions();
const t = (sql) => translateSql(sql, options);

test("PostgreSQL column order matches the deployed D1 schema for positional inserts", () => {
  const snapshot = JSON.parse(fs.readFileSync(new URL("../drizzle/meta/0012_snapshot.json", import.meta.url), "utf8"));
  const migration = fs.readFileSync(new URL("../supabase/migrations/" + migrationFiles()[0], import.meta.url), "utf8");
  const postgresColumns = new Map();
  for (const match of migration.matchAll(/create table public\.([a-z_]+) \(([\s\S]*?)\n\);/gi)) {
    postgresColumns.set(
      match[1],
      match[2]
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[a-z_][a-z0-9_]*\s/i.test(line))
        .filter((line) => !/^(?:check|constraint|foreign|primary|unique)\b/i.test(line))
        .map((line) => line.match(/^([a-z_][a-z0-9_]*)/i)[1]),
    );
  }
  for (const [table, definition] of Object.entries(snapshot.tables)) {
    const d1 = Object.keys(definition.columns);
    const pg = (postgresColumns.get(table) || []).slice(0, d1.length);
    assert.deepEqual(pg, d1, `${table}: PostgreSQL must keep the D1 column order (extra columns only at the end)`);
  }
  const contract = JSON.parse(fs.readFileSync(new URL("../supabase/column-types.json", import.meta.url), "utf8"));
  for (const [table, columns] of postgresColumns) {
    assert.deepEqual(Object.keys(contract[table] || {}), columns, `${table}: column-types.json order must match the migration`);
  }
});

test("translator rewrites positional placeholders outside literals", () => {
  assert.equal(
    t("SELECT * FROM users WHERE email=? AND name<>'why?' AND id=?"),
    "SELECT * FROM users WHERE email=$1 AND name<>'why?' AND id=$2",
  );
  assert.equal(t("INSERT INTO t VALUES(?,?,?)"), "INSERT INTO t VALUES($1,$2,$3)");
});

test("translator maps SQLite-only idioms", () => {
  assert.equal(
    t("INSERT OR IGNORE INTO notifications VALUES(?,?)"),
    "INSERT INTO notifications VALUES($1,$2) ON CONFLICT DO NOTHING",
  );
  assert.equal(
    t("INSERT OR IGNORE INTO tasks(id) VALUES(?) RETURNING id"),
    "INSERT INTO tasks(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id",
  );
  assert.equal(
    t("INSERT INTO rate_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1"),
    "INSERT INTO rate_limits(id,count,expires_at) VALUES($1,1,$2) ON CONFLICT(id) DO UPDATE SET count=rate_limits.count+1",
  );
  assert.equal(
    t("INSERT INTO attendance VALUES(?,?,?) ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status,recorder=CASE WHEN status='Present' THEN recorder ELSE excluded.recorder END WHERE session_id<>'x'"),
    "INSERT INTO attendance VALUES($1,$2,$3) ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status,recorder=CASE WHEN attendance.status='Present' THEN attendance.recorder ELSE excluded.recorder END WHERE attendance.session_id<>'x'",
  );
  assert.equal(t("SELECT json_extract(p.config,'$.minGig') FROM policies p"), "SELECT ((p.config->>'minGig')::numeric) FROM policies p");
  assert.equal(
    t("SELECT (SELECT json_group_array(e.id) FROM evidence e) ids"),
    "SELECT (SELECT coalesce(jsonb_agg(e.id),'[]'::jsonb) FROM evidence e) ids",
  );
  assert.equal(t("SELECT group_concat(id) FROM students"), "SELECT string_agg((id)::text, ',') FROM students");
  assert.equal(t("SELECT CAST(min(2,(SELECT count(*) FROM x)) AS TEXT)||'/3'"), "SELECT CAST(least(2,(SELECT count(*) FROM x)) AS TEXT)||'/3'");
  assert.equal(t("SELECT * FROM students WHERE name LIKE ? OR email NOT LIKE 'a%'"), "SELECT * FROM students WHERE name ILIKE $1 OR email NOT ILIKE 'a%'");
  assert.equal(t("SELECT * FROM x WHERE unlike_col=1"), "SELECT * FROM x WHERE unlike_col=1");
  assert.equal(
    t("SELECT id FROM users WHERE roles LIKE '%Quality Member%' OR u.roles NOT LIKE ? OR name LIKE ?"),
    "SELECT id FROM users WHERE roles::text ILIKE '%Quality Member%' OR u.roles::text NOT ILIKE $1 OR name ILIKE $2",
  );
  assert.equal(t("SELECT * FROM t WHERE s.id LIKE ? ESCAPE '\\'"), "SELECT * FROM t WHERE s.id ILIKE $1 ESCAPE '\\'");
});

test("translator converts integer flags on boolean columns only", () => {
  assert.equal(t("SELECT * FROM users WHERE active=1 AND u.active <> 0"), "SELECT * FROM users WHERE active = true AND u.active <> false");
  assert.equal(t("UPDATE sessions SET attendance_reconciled=1 WHERE week=1"), "UPDATE sessions SET attendance_reconciled = true WHERE week=1");
  assert.equal(t("SELECT * FROM t WHERE task_fit=0 AND milestone=1"), "SELECT * FROM t WHERE task_fit = false AND milestone=1");
  assert.equal(t("SELECT * FROM t WHERE reactive=1"), "SELECT * FROM t WHERE reactive=1");
  assert.equal(
    t("INSERT INTO tracks(id,name,provider,capacity,active,created_at) VALUES(?,?,?,?,1,?)"),
    "INSERT INTO tracks(id,name,provider,capacity,active,created_at) VALUES($1,$2,$3,$4,true,$5)",
  );
  assert.equal(t("INSERT INTO users VALUES(?,?,?,?,?,0)"), "INSERT INTO users VALUES($1,$2,$3,$4,$5,false)");
  assert.equal(
    t("INSERT OR IGNORE INTO users(id,email,name,roles,scopes,active) VALUES('a','b','c, 1','[]','[]',1),(?,?,?,?,?,0)"),
    "INSERT INTO users(id,email,name,roles,scopes,active) VALUES('a','b','c, 1','[]','[]',true),($1,$2,$3,$4,$5,false) ON CONFLICT DO NOTHING",
  );
  assert.equal(t("INSERT INTO sessions(id,week) VALUES(?,1)"), "INSERT INTO sessions(id,week) VALUES($1,1)");
});

test("translator casts CASE assignments to the declared column type", () => {
  assert.equal(
    t("UPDATE service_submissions SET status=CASE WHEN x=1 THEN 'Complete' ELSE 'Pending QC' END, qc_completed_at=CASE WHEN (SELECT count(*) FROM service_links WHERE student_id=?)=3 THEN ? ELSE NULL END, updated_at=? WHERE student_id=?"),
    "UPDATE service_submissions SET status=CASE WHEN x=1 THEN 'Complete' ELSE 'Pending QC' END, qc_completed_at=(CASE WHEN (SELECT count(*) FROM service_links WHERE student_id=$1)=3 THEN $2 ELSE NULL END)::timestamptz, updated_at=$3 WHERE student_id=$4",
  );
  assert.equal(
    t("INSERT INTO service_submissions(id,student_id,status,submitted_at,updated_at,qc_completed_at) VALUES(?,?,?,?,?,NULL) ON CONFLICT(student_id) DO UPDATE SET status='Pending QC',updated_at=?,qc_completed_at=CASE WHEN status='x' THEN ? ELSE NULL END"),
    "INSERT INTO service_submissions(id,student_id,status,submitted_at,updated_at,qc_completed_at) VALUES($1,$2,$3,$4,$5,NULL) ON CONFLICT(student_id) DO UPDATE SET status='Pending QC',updated_at=$6,qc_completed_at=(CASE WHEN service_submissions.status='x' THEN $7 ELSE NULL END)::timestamptz",
  );
  assert.equal(t("UPDATE users SET name=CASE WHEN id=? THEN ? ELSE name END WHERE id=?"), "UPDATE users SET name=CASE WHEN id=$1 THEN $2 ELSE name END WHERE id=$3");
});

test("translator skips statements the PostgreSQL migrations already cover", () => {
  assert.equal(t("CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'x'); END"), null);
  assert.equal(t("PRAGMA foreign_keys=ON"), null);
});

test("timestamps normalize to the ISO form D1 rows used", () => {
  assert.equal(isoTimestamp("2026-09-18 15:00:00.123+00"), "2026-09-18T15:00:00.123Z");
  assert.equal(isoTimestamp("2026-09-18 15:00:00+00"), "2026-09-18T15:00:00.000Z");
  assert.equal(isoTimestamp("2026-09-18 17:30:00.5+02"), "2026-09-18T15:30:00.500Z");
  assert.equal(isoTimestamp("2026-09-18T15:00:00.000Z"), "2026-09-18T15:00:00.000Z");
});

test("constraint errors keep the wording the routes recognise", () => {
  assert.match(
    normalizeDatabaseError({ code: "23505", message: "duplicate key", table_name: "users", constraint_name: "users_pkey" }).message,
    /^UNIQUE constraint failed: users\.users_pkey/,
  );
  assert.match(normalizeDatabaseError({ code: "23503", message: "fk", table_name: "students" }).message, /^FOREIGN KEY constraint failed/);
  assert.equal(normalizeDatabaseError({ code: "P0001", message: "Audit history is immutable." }).message, "Audit history is immutable.");
});

let pg;
before(async () => {
  pg = await startPostgresTestDatabase();
});
after(async () => {
  if (pg) await pg.stop();
});

test("Supabase migrations apply to a real PostgreSQL server", async () => {
  assert.ok(pg.version, "server version should be reported");
  const { results } = await pg.db
    .prepare("SELECT count(*) n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
    .all();
  assert.equal(results[0].n, 59);
  const triggers = await pg.db.prepare("SELECT count(*) n FROM information_schema.triggers WHERE trigger_schema='public'").first();
  assert.ok(triggers.n >= 20, `expected the integrity triggers to be installed, found ${triggers.n}`);
  const rls = await pg.db
    .prepare("SELECT count(*) n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity")
    .first();
  assert.equal(rls.n, 59, "row level security must be enabled on every application table");
});

test("adapter preserves D1 value semantics through the PostgreSQL types", async () => {
  const db = pg.db;
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  await stmt("INSERT INTO users VALUES(?,?,?,?,?,?)", "owner", "Owner@Example.com", "Owner", JSON.stringify(["Project Operations"]), "[]", 1).run();
  await stmt("INSERT INTO users VALUES(?,?,?,?,?,?)", "former", "former@example.com", "Former", "[]", "[]", 0).run();
  const active = await stmt("SELECT * FROM users WHERE active=1").all();
  assert.equal(active.results.length, 1);
  assert.equal(active.results[0].active, 1);
  assert.equal(active.results[0].auth_user_id, null);
  assert.deepEqual(JSON.parse(active.results[0].roles), ["Project Operations"]);
  const inactive = await stmt("SELECT active FROM users WHERE id=?", "former").first();
  assert.equal(inactive.active, 0);

  const created = "2026-09-18T12:34:56.789Z";
  await stmt("INSERT INTO policies VALUES(?,?,?,?,?,?,?)", "POL-1", "Baseline", "Effective", JSON.stringify({ minGig: 5, gigCount: 3, minTotal: 15, largeGig: 300 }), "owner", null, created).run();
  const policy = await stmt("SELECT *, json_extract(config,'$.minGig') min_gig FROM policies WHERE id=?", "POL-1").first();
  assert.equal(policy.created_at, created);
  assert.equal(policy.min_gig, 5);
  assert.equal(typeof policy.config, "string");
  assert.equal(JSON.parse(policy.config).largeGig, 300);

  await stmt("INSERT INTO rate_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1", "rl:1", created).run();
  await stmt("INSERT INTO rate_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1", "rl:1", created).run();
  const count = await stmt("SELECT count FROM rate_limits WHERE id=?", "rl:1").first();
  assert.equal(count.count, 2);
  const total = await stmt("SELECT count(*) n, sum(count) s FROM rate_limits").first();
  assert.equal(total.n, 1);
  assert.equal(total.s, 2);

  await stmt("INSERT OR IGNORE INTO users VALUES(?,?,?,?,?,?)", "owner", "owner@example.com", "Dup", "[]", "[]", 1).run();
  await assert.rejects(
    stmt("INSERT INTO users VALUES(?,?,?,?,?,?)", "owner", "owner@example.com", "Dup", "[]", "[]", 1).run(),
    /UNIQUE constraint failed/,
  );
  const changes = await stmt("UPDATE users SET name=? WHERE id=?", "Renamed", "owner").run();
  assert.equal(changes.meta.changes, 1);
});

test("batch is atomic and trigger installation statements are ignored", async () => {
  const db = pg.db;
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  await assert.rejects(
    db.batch([
      stmt("INSERT INTO users VALUES(?,?,?,?,?,?)", "batch-a", "batch-a@example.com", "A", "[]", "[]", 1),
      stmt("INSERT INTO users VALUES(?,?,?,?,?,?)", "batch-a", "batch-a@example.com", "A again", "[]", "[]", 1),
    ]),
    /UNIQUE constraint failed/,
  );
  assert.equal((await stmt("SELECT count(*) n FROM users WHERE id=?", "batch-a").first()).n, 0);
  const results = await db.batch([
    stmt("CREATE TRIGGER IF NOT EXISTS ignored BEFORE UPDATE ON users BEGIN SELECT RAISE(ABORT,'x'); END"),
    stmt("INSERT INTO users VALUES(?,?,?,?,?,?)", "batch-b", "batch-b@example.com", "B", "[]", "[]", 1),
    stmt("SELECT id FROM users WHERE id=?", "batch-b"),
  ]);
  assert.equal(results.length, 3);
  assert.equal(results[2].results[0].id, "batch-b");
});

test("PostgreSQL integrity triggers reject mutations the D1 triggers rejected", async () => {
  const db = pg.db;
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  const contract = JSON.parse(fs.readFileSync(new URL("../supabase/column-types.json", import.meta.url), "utf8"));
  const columns = Object.keys(contract.audit_events);
  assert.ok(columns.includes("actor"), "audit_events should carry an actor column");
  const sample = { actor: "owner", action: "Test", entity: "USER-1", at: "2026-09-18T00:00:00.000Z", target: "USER-1", details: "{}" };
  const values = columns.map((column) => {
    if (column in sample) return sample[column];
    if (column === "id") return "AUD-1";
    const type = contract.audit_events[column];
    if (type === "jsonb") return "{}";
    if (type === "timestamptz") return "2026-09-18T00:00:00.000Z";
    if (type === "boolean") return 1;
    if (/^(integer|bigint|numeric)/.test(type)) return 1;
    return "test";
  });
  await stmt(`INSERT INTO audit_events VALUES(${columns.map(() => "?").join(",")})`, ...values).run();
  await assert.rejects(stmt("UPDATE audit_events SET action='tampered'").run(), /immutable/);
  await assert.rejects(stmt("DELETE FROM audit_events").run(), /immutable/);
});

test("createPostgresDatabase requires TLS for non-local hosts by default", () => {
  const remote = createPostgresDatabase("postgres://u:p@db.example.supabase.co:6543/postgres", { columnTypes: columnTypes() });
  assert.equal(remote.sql.options.ssl, "require");
  return remote.end();
});
