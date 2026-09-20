#!/usr/bin/env node
/**
 * One-time, rehearsable migration of the DEPI operational data from the
 * Cloudflare D1/R2 deployment into Supabase (PostgreSQL + private Storage).
 *
 * Source: an encrypted `depi-backup-v1` archive produced by the application's
 * Administration → backup export (or the same JSON already decrypted). The
 * source is never modified, so the D1/R2 deployment remains a complete
 * rollback path until the environment is switched.
 *
 * Target: a Supabase project where `supabase/migrations/*.sql` have already
 * been applied. Rows are transformed with `supabase/column-types.json`,
 * loaded in foreign-key order inside one transaction, reconciled by count
 * and content hash, and only then committed. `--dry-run` does everything
 * except commit.
 *
 * Usage:
 *   node scripts/migrate-d1-to-supabase.mjs --backup depi-backup-2026-09-18.zip \
 *     --database "$SUPABASE_DB_URL" [--supabase-url URL --service-role-key KEY] \
 *     [--bucket depi-evidence] [--dry-run] [--skip-evidence] [--keep-triggers] \
 *     [--report migration-report.json]
 *   node scripts/migrate-d1-to-supabase.mjs --json database.json --database ... [--evidence-dir DIR]
 *
 * Secrets come from the environment when flags are omitted:
 *   BACKUP_ENCRYPTION_KEY, SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   SUPABASE_EVIDENCE_BUCKET.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import postgres from "postgres";
import { createPostgresDatabase, postgresTypes } from "../lib/data/postgres.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(message) {
  console.error("ERROR: " + message);
  process.exit(1);
}

function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<connection string>";
  }
}

// ---------------------------------------------------------------- source ----

function decryptEntry(entries, key, name) {
  const part = entries[name];
  if (!part || part.length < 28) throw new Error("Missing or invalid encrypted entry: " + name);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, part.slice(0, 12));
  decipher.setAAD(Buffer.from(name));
  decipher.setAuthTag(part.slice(-16));
  return Buffer.concat([decipher.update(part.slice(12, -16)), decipher.final()]);
}

function loadSource() {
  if (args.backup) {
    const hex = String(args.key || process.env.BACKUP_ENCRYPTION_KEY || "");
    if (!/^[a-fA-F0-9]{64}$/.test(hex)) fail("A valid 32-byte hexadecimal BACKUP_ENCRYPTION_KEY is required to read the archive.");
    const key = Buffer.from(hex, "hex");
    const entries = unzipSync(fs.readFileSync(args.backup));
    const manifest = JSON.parse(decryptEntry(entries, key, "manifest.enc").toString("utf8"));
    const backup = JSON.parse(decryptEntry(entries, key, "database.enc").toString("utf8"));
    if (manifest.format !== "depi-backup-v1" || backup.format !== "depi-backup-v1") fail("Unsupported backup format.");
    for (const [table, count] of Object.entries(manifest.tables)) {
      if (!Array.isArray(backup.tables[table]) || backup.tables[table].length !== count) fail("Table manifest does not match backup contents: " + table);
    }
    const evidence = manifest.files.map((file) => ({
      ...file,
      read: () => {
        const bytes = decryptEntry(entries, key, file.entry);
        if (bytes.length !== file.size || crypto.createHash("sha256").update(bytes).digest("hex") !== file.hash) {
          throw new Error("Evidence integrity failure: " + file.id);
        }
        return bytes;
      },
    }));
    key.fill(0);
    return { kind: "archive:" + path.basename(args.backup), created_at: backup.created_at, tables: backup.tables, evidence };
  }
  if (args.json) {
    const backup = JSON.parse(fs.readFileSync(args.json, "utf8"));
    if (backup.format !== "depi-backup-v1" || !backup.tables) fail("The JSON file is not a depi-backup-v1 export.");
    const dir = args["evidence-dir"] ? String(args["evidence-dir"]) : null;
    const evidence = (backup.tables.attachments || []).map((a) => ({
      id: a.id,
      key: a.key,
      name: a.name,
      size: a.size,
      hash: a.hash,
      read: () => {
        if (!dir) throw new Error("--evidence-dir is required to migrate evidence from a JSON export.");
        const bytes = fs.readFileSync(path.join(dir, a.id));
        if (bytes.length !== a.size || crypto.createHash("sha256").update(bytes).digest("hex") !== a.hash) {
          throw new Error("Evidence integrity failure: " + a.id);
        }
        return bytes;
      },
    }));
    return { kind: "json:" + path.basename(args.json), created_at: backup.created_at, tables: backup.tables, evidence };
  }
  fail("Provide --backup <encrypted zip> or --json <decrypted export>.");
}

// -------------------------------------------------------------- contract ----

const columnTypes = JSON.parse(fs.readFileSync(path.join(ROOT, "supabase/column-types.json"), "utf8"));

/** Foreign-key order derived from the core migration (parents before children). */
function tableOrder(tables) {
  const migration = fs.readFileSync(path.join(ROOT, "supabase/migrations/202609180001_core_schema.sql"), "utf8");
  const edges = new Map();
  for (const match of migration.matchAll(/create table public\.([a-z_]+) \(([\s\S]*?)\n\);/gi)) {
    const table = match[1];
    const parents = new Set();
    for (const ref of match[2].matchAll(/references public\.([a-z_]+)/gi)) if (ref[1] !== table) parents.add(ref[1]);
    edges.set(table, parents);
  }
  const wanted = new Set(tables);
  const ordered = [];
  const placed = new Set();
  let progress = true;
  while (progress && ordered.length < wanted.size) {
    progress = false;
    for (const table of wanted) {
      if (placed.has(table)) continue;
      const parents = [...(edges.get(table) || [])].filter((p) => wanted.has(p));
      if (parents.every((p) => placed.has(p))) {
        ordered.push(table);
        placed.add(table);
        progress = true;
      }
    }
  }
  const remaining = [...wanted].filter((t) => !placed.has(t));
  if (remaining.length) fail("Circular or unknown table dependencies: " + remaining.join(", "));
  return ordered;
}

function transformValue(value, type) {
  if (value === null || value === undefined) return null;
  if (type === "boolean") return value === true || value === 1 || value === "1" || value === "true";
  if (type === "jsonb" || type === "json") {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    JSON.parse(text);
    return text;
  }
  if (/^(integer|bigint|numeric)/.test(type)) {
    const number = Number(value);
    if (Number.isNaN(number)) throw new Error("Not a number: " + value);
    return type === "integer" || type === "bigint" ? Math.trunc(number) : number;
  }
  if (type === "timestamptz") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error("Not a timestamp: " + value);
    return parsed.toISOString();
  }
  return String(value);
}

/** Canonical representation used to compare a source row with a loaded row. */
function canonicalRow(row, types) {
  const out = {};
  for (const column of Object.keys(types).sort()) {
    if (!(column in row)) continue;
    const value = row[column];
    const type = types[column];
    if (value === null || value === undefined) out[column] = null;
    else if (type === "boolean") out[column] = value === true || value === 1 || value === "1" || value === "true";
    else if (type === "jsonb" || type === "json") out[column] = canonicalJson(typeof value === "string" ? JSON.parse(value) : value);
    else if (/^(integer|bigint|numeric)/.test(type)) out[column] = Number(value);
    else if (type === "timestamptz") out[column] = new Date(value).toISOString();
    else out[column] = String(value);
  }
  return JSON.stringify(out);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonicalJson(value[k])]));
  }
  return value;
}

function tableHash(rows, types) {
  const lines = rows.map((row) => canonicalRow(row, types)).sort();
  return { hash: crypto.createHash("sha256").update(lines.join("\n")).digest("hex"), lines };
}

// ------------------------------------------------------------------ main ----

async function main() {
  const source = loadSource();
  const databaseUrl = String(args.database || process.env.SUPABASE_DB_URL || "");
  if (!databaseUrl) fail("Provide --database or SUPABASE_DB_URL (the Supabase PostgreSQL connection string).");
  const dryRun = Boolean(args["dry-run"]);
  const skipEvidence = Boolean(args["skip-evidence"]);
  // Historical rows cannot be replayed through the live-state integrity triggers
  // (for example account_assignment_guard checks that the account is still
  // Available). Like pg_restore, the load runs with user triggers disabled while
  // foreign keys, uniqueness and check constraints stay fully enforced.
  const disableTriggers = !args["keep-triggers"];
  const chunkSize = Number(args["chunk-size"] || 500);

  const tables = Object.keys(source.tables).filter((t) => source.tables[t].length > 0 || t in columnTypes);
  for (const table of tables) {
    if (!columnTypes[table]) fail(`Table ${table} is in the export but not in supabase/column-types.json.`);
    for (const row of source.tables[table]) {
      for (const column of Object.keys(row)) {
        if (!columnTypes[table][column]) fail(`Column ${table}.${column} is in the export but not in the PostgreSQL contract.`);
      }
    }
  }
  const order = tableOrder(tables);
  console.log(`Source: ${source.kind} (exported ${source.created_at})`);
  console.log(`Target: ${maskUrl(databaseUrl)}${dryRun ? " [dry run, nothing will be committed]" : ""}`);
  console.log(`Tables: ${order.length}, rows: ${order.reduce((n, t) => n + source.tables[t].length, 0)}, evidence objects: ${source.evidence.length}`);

  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
  // The adapter's type handlers keep JSON text, booleans, numerics and timestamps
  // in the exact form the runtime uses, on both the write and the read side.
  const sql = postgres(databaseUrl, { max: 1, prepare: false, fetch_types: false, types: postgresTypes, ssl: local ? false : "require", onnotice: () => {} });
  const report = { source: source.kind, exported_at: source.created_at, dry_run: dryRun, tables: {}, evidence: { total: source.evidence.length, uploaded: 0, verified: 0, skipped: skipEvidence }, ok: true };

  const [{ n: existingRows }] = await sql.unsafe(
    `select coalesce(sum(c), 0)::int as n from (${order.map((t) => `select count(*) c from public.${t}`).join(" union all ")}) x`,
  );
  if (Number(existingRows) > 0 && !args.append) {
    await sql.end();
    fail(`The target already holds ${existingRows} rows in the migrated tables. Use an empty project (or pass --append after reviewing the plan).`);
  }

  class DryRunRollback extends Error {}
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("set constraints all deferred");
      if (disableTriggers) for (const table of order) await tx.unsafe(`alter table public.${table} disable trigger user`);
      for (const table of order) {
        const rows = source.tables[table];
        const types = columnTypes[table];
        const columns = Object.keys(types).filter((c) => rows.some((r) => c in r));
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize).map((row) => {
            const out = {};
            for (const column of columns) {
              try {
                out[column] = column in row ? transformValue(row[column], types[column]) : null;
              } catch (error) {
                throw new Error(`${table}.${column} (${row.id ?? "row " + i}): ${error.message}`);
              }
            }
            return out;
          });
          if (!chunk.length) continue;
          try {
            await tx.savepoint((sp) => sp`insert into ${sp("public." + table)} ${sp(chunk, ...columns)}`);
          } catch (chunkError) {
            // Pinpoint the offending row so the report names it.
            for (const row of chunk) {
              try {
                await tx.savepoint((sp) => sp`insert into ${sp("public." + table)} ${sp([row], ...columns)}`);
              } catch (rowError) {
                const preview = JSON.stringify(row).slice(0, 400);
                throw new Error(`${table} row ${row.id ?? "?"}: ${rowError.message}\n  ${preview}`);
              }
            }
            throw chunkError;
          }
        }
        process.stdout.write(`  loaded ${table}: ${rows.length}\n`);
      }
      if (disableTriggers) for (const table of order) await tx.unsafe(`alter table public.${table} enable trigger user`);

      // Reconcile inside the transaction using the application's own adapter so
      // values are normalized exactly as the runtime will see them.
      const reader = createPostgresDatabase(databaseUrl, { columnTypes, ssl: local ? false : "require", max: 1 });
      try {
        for (const table of order) {
          const types = columnTypes[table];
          const sourceRows = source.tables[table];
          const targetCount = Number((await tx.unsafe(`select count(*)::int as n from public.${table}`))[0].n);
          const columnsList = Object.keys(types).filter((c) => sourceRows.some((r) => c in r));
          const targetRows = columnsList.length
            ? await tx.unsafe(`select ${columnsList.join(",")} from public.${table}`)
            : [];
          const normalizedTarget = targetRows.map((row) => {
            const out = {};
            for (const column of columnsList) {
              let value = row[column];
              if (value instanceof Date) value = types[column] === "date" ? value.toISOString().slice(0, 10) : value.toISOString();
              else if (value !== null && typeof value === "object") value = JSON.stringify(value);
              out[column] = value;
            }
            return out;
          });
          const a = tableHash(sourceRows, types);
          const b = tableHash(normalizedTarget, types);
          const match = sourceRows.length === targetCount && a.hash === b.hash;
          const entry = { source_rows: sourceRows.length, target_rows: targetCount, source_hash: a.hash, target_hash: b.hash, match };
          if (!match) {
            const targetSet = new Set(b.lines);
            entry.sample_missing_in_target = a.lines.filter((l) => !targetSet.has(l)).slice(0, 5);
            report.ok = false;
          }
          report.tables[table] = entry;
        }
      } finally {
        await reader.end().catch(() => {});
      }
      if (!report.ok) throw new Error("Reconciliation failed; see report. The transaction was rolled back.");
      if (dryRun) throw new DryRunRollback("dry run");
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) {
      report.ok = false;
      report.error = error.message;
    }
  }
  await sql.end({ timeout: 5 });

  if (report.ok && !dryRun && !skipEvidence && source.evidence.length) {
    const supabaseUrl = String(args["supabase-url"] || process.env.SUPABASE_URL || "");
    const serviceKey = String(args["service-role-key"] || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
    const bucket = String(args.bucket || process.env.SUPABASE_EVIDENCE_BUCKET || "depi-evidence");
    if (!supabaseUrl || !serviceKey) {
      report.ok = false;
      report.error = "Rows were committed but evidence was not copied: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Re-run with --skip-rows to copy evidence only.";
    } else {
      const { createClient } = await import("@supabase/supabase-js");
      const storage = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(bucket);
      const failures = [];
      for (const file of source.evidence) {
        try {
          const bytes = file.read();
          const mime = (source.tables.attachments || []).find((a) => a.id === file.id)?.mime || "application/octet-stream";
          const { error } = await storage.upload(file.key, new Blob([bytes], { type: mime }), { contentType: mime, upsert: false });
          if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
          report.evidence.uploaded++;
          const { data, error: downloadError } = await storage.download(file.key);
          if (downloadError || !data) throw new Error(downloadError?.message || "download failed");
          const back = Buffer.from(await data.arrayBuffer());
          if (crypto.createHash("sha256").update(back).digest("hex") !== file.hash) throw new Error("hash mismatch after upload");
          report.evidence.verified++;
        } catch (error) {
          failures.push({ id: file.id, key: file.key, error: error.message });
        }
      }
      if (failures.length) {
        report.ok = false;
        report.evidence.failures = failures;
      }
    }
  }

  report.duration_ms = Date.now() - startedAt;
  const reportPath = args.report ? String(args.report) : null;
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log("");
  for (const [table, entry] of Object.entries(report.tables)) {
    console.log(`  ${entry.match ? "OK " : "DIFF"} ${table}: ${entry.source_rows} → ${entry.target_rows}`);
  }
  if (source.evidence.length) console.log(`  evidence: ${report.evidence.uploaded}/${report.evidence.total} uploaded, ${report.evidence.verified} verified${skipEvidence ? " (skipped)" : ""}`);
  if (report.error) console.error("ERROR: " + report.error);
  console.log(report.ok ? (dryRun ? "Dry run passed. No data was committed." : "Migration committed and reconciled.") : "Migration NOT complete.");
  if (reportPath) console.log("Report: " + reportPath);
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => fail(error.message));
