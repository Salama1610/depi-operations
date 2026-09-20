#!/usr/bin/env node
// Applies supabase/migrations/*.sql to a PostgreSQL database in file order,
// skipping versions already recorded in supabase_migrations.schema_migrations
// (the same bookkeeping table the Supabase CLI uses). Each file runs inside its
// own transaction using the simple query protocol so `$$` bodies run unchanged.
//
//   node scripts/apply-supabase-migrations.mjs --credentials ../.secrets/supabase-depi.json
//   node scripts/apply-supabase-migrations.mjs --db-url postgresql://... [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminConnection, parseArgs, redact, resolveDatabaseUrl } from "./supabase-env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

const args = parseArgs(process.argv.slice(2));
const url = resolveDatabaseUrl(args, "session");
const files = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const sql = adminConnection(url);

try {
  const [{ version }] = await sql.unsafe("select current_setting('server_version') as version");
  console.log(`connected to ${redact(url)} (PostgreSQL ${version})`);
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);
  const applied = new Set(
    (await sql.unsafe("select version from supabase_migrations.schema_migrations")).map((r) => r.version),
  );
  for (const file of files) {
    const version = file.split("_")[0];
    const name = file.replace(/\.sql$/, "");
    if (applied.has(version)) {
      console.log(`skip    ${file} (already applied)`);
      continue;
    }
    const body = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    if (args["dry-run"]) {
      console.log(`would apply ${file} (${body.length} bytes)`);
      continue;
    }
    const started = Date.now();
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx.unsafe(
        "insert into supabase_migrations.schema_migrations(version, name, statements) values ($1, $2, $3)",
        [version, name, [body]],
      );
    });
    console.log(`applied ${file} in ${Date.now() - started} ms`);
  }
  const [summary] = await sql.unsafe(`
    select
      (select count(*) from pg_tables where schemaname = 'public') as tables,
      (select count(*) from pg_tables where schemaname = 'public' and rowsecurity) as rls_tables,
      (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and not t.tgisinternal) as triggers,
      (select count(*) from storage.buckets where id = 'depi-evidence') as evidence_bucket
  `);
  console.log("summary", JSON.stringify(summary));
} finally {
  await sql.end({ timeout: 5 });
}
