import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { effectiveColumnTypes, effectiveTables } from "./helpers/schema-contract.mjs";

const schemaSource = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const drizzleSnapshot = JSON.parse(
  await readFile(new URL("../drizzle/meta/0012_snapshot.json", import.meta.url), "utf8"),
);
const coreMigration = await readFile(
  new URL("../supabase/migrations/202609180001_core_schema.sql", import.meta.url),
  "utf8",
);
const securityMigration = await readFile(
  new URL("../supabase/migrations/202609180002_integrity_and_rls.sql", import.meta.url),
  "utf8",
);
const storageMigration = await readFile(
  new URL("../supabase/migrations/202609180003_private_evidence_storage.sql", import.meta.url),
  "utf8",
);
const columnTypes = JSON.parse(
  await readFile(new URL("../supabase/column-types.json", import.meta.url), "utf8"),
);
const rosterSourceContract = JSON.parse(
  await readFile(new URL("../supabase/roster-source-contract.json", import.meta.url), "utf8"),
);

test("the Supabase migrations cover every D1 schema table", () => {
  const sqliteTables = new Set(
    [...schemaSource.matchAll(/sqliteTable\(\s*["']([^"']+)/g)].map((match) => match[1]),
  );
  // Every migration, not only the core file: later ones add tables too.
  const postgresTables = effectiveTables();

  assert.equal(sqliteTables.size, 60);
  assert.deepEqual([...postgresTables].sort(), [...sqliteTables].sort());
});

test("Supabase core migration preserves every latest D1 column", () => {
  const postgresColumns = new Map();
  for (const match of coreMigration.matchAll(/create table public\.([a-z_]+) \(([\s\S]*?)\n\);/gi)) {
    const columns = match[2]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[a-z_][a-z0-9_]*\s/i.test(line))
      .filter((line) => !/^(?:check|constraint|foreign|primary|unique)\b/i.test(line))
      .map((line) => line.match(/^([a-z_][a-z0-9_]*)/i)[1]);
    postgresColumns.set(match[1], new Set(columns));
  }

  for (const [table, definition] of Object.entries(drizzleSnapshot.tables)) {
    const expected = Object.keys(definition.columns).sort();
    const actual = [...(postgresColumns.get(table) || [])]
      .filter((column) => column !== "auth_user_id")
      .sort();
    assert.deepEqual(actual, expected, `${table} columns must match the deployed D1 schema`);
  }
  assert.ok(postgresColumns.get("users").has("auth_user_id"));
});

test("Supabase column type contract exactly matches the migrations", () => {
  // Derived from every migration, so a column added by a later one has to be
  // in the contract too. The adapter binds and converts values from this file,
  // so a column missing here is a runtime bug, not a documentation gap.
  assert.deepEqual(columnTypes, effectiveColumnTypes());
});

test("roster source contract preserves the reconciled workbook shape", () => {
  assert.equal(rosterSourceContract.sourceSheet, "DEPI All Databases");
  assert.equal(rosterSourceContract.sourceRows, 2948);
  assert.equal(rosterSourceContract.sourceColumns, 47);
  assert.equal(rosterSourceContract.expectedReconciliation.canonicalStudents, 2887);
  assert.equal(rosterSourceContract.expectedReconciliation.duplicateRowsMerged, 61);
  assert.equal(rosterSourceContract.allSourceColumns.length, 47);
  assert.equal(rosterSourceContract.allSourceColumns.filter((name) => name === "Comments").length, 2);
  assert.equal(rosterSourceContract.duplicateHeaderAliases["47"], "Comments__2");
});

test("Supabase migration preserves critical database safeguards", () => {
  for (const safeguard of [
    "account_assignment_guard",
    "contact_complete",
    "evidence_paid_intake",
    "gig_valid_transition",
    "evidence_valid_transition",
    "audit_no_update",
    "service_reviews_no_update",
    "service_submission_three_links",
  ]) {
    assert.match(securityMigration, new RegExp(`create (?:constraint )?trigger ${safeguard}`, "i"));
  }
});

test("every application table is included in the RLS activation set", () => {
  const postgresTables = [...coreMigration.matchAll(/create table public\.([a-z_]+)/gi)].map(
    (match) => match[1],
  );
  const activationBlock = securityMigration.slice(
    securityMigration.indexOf("foreach table_name in array array["),
    securityMigration.indexOf("create policy users_staff_read"),
  );

  for (const table of postgresTables) {
    assert.match(activationBlock, new RegExp(`'${table}'`), `${table} must have RLS enabled`);
  }
  assert.match(activationBlock, /revoke all on table public\.%I from anon, authenticated/i);
  assert.match(activationBlock, /grant select on table public\.%I to authenticated/i);
});

test("evidence storage is private and has no browser write policy", () => {
  assert.match(storageMigration, /'depi-evidence'[\s\S]*false/);
  assert.match(storageMigration, /for select to authenticated/i);
  assert.match(storageMigration, /app_private\.is_active_staff\(\)/i);
  assert.doesNotMatch(storageMigration, /for (?:insert|update|delete) to authenticated/i);
});
