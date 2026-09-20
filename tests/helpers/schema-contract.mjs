// The PostgreSQL schema as it exists after every migration has run, and the
// newest Drizzle snapshot to compare it against.
//
// The schema is no longer described by the core migration alone: later
// migrations add columns and tables, and PostgreSQL appends an added column at
// the end of the table, which is exactly what a positional INSERT depends on.
// Parsing only the first file would let the contract tests pass while the real
// database had drifted.
import fs from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const TYPE = String.raw`text|uuid|jsonb|boolean|date|timestamptz|bigint|integer|smallint|numeric\(\d+,\d+\)`;
const CREATE_TABLE = /create table (?:if not exists )?public\.([a-z_]+) \(([\s\S]*?)\n\);/gi;

export function migrationFiles() {
  return fs
    .readdirSync(new URL("supabase/migrations/", ROOT))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function readMigration(file) {
  return fs.readFileSync(new URL("supabase/migrations/" + file, ROOT), "utf8");
}

function addColumnMatches(sql, withType) {
  const pattern = withType
    ? String.raw`alter table public\.([a-z_]+)\s+add column (?:if not exists )?([a-z_][a-z0-9_]*)\s+(${TYPE})`
    : String.raw`alter table public\.([a-z_]+)\s+add column (?:if not exists )?([a-z_][a-z0-9_]*)`;
  return sql.matchAll(new RegExp(pattern, "gi"));
}

function columnsFromBody(body) {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[a-z_][a-z0-9_]*\s/i.test(line))
    .filter((line) => !/^(?:check|constraint|foreign|primary|unique)\b/i.test(line))
    .map((line) => line.match(/^([a-z_][a-z0-9_]*)/i)[1]);
}

/**
 * table -> ordered column names, after applying every `create table` and
 * `alter table ... add column` in migration order.
 */
export function effectiveColumns() {
  const tables = new Map();
  for (const file of migrationFiles()) {
    const sql = readMigration(file);
    for (const match of sql.matchAll(CREATE_TABLE)) {
      if (!tables.has(match[1])) tables.set(match[1], columnsFromBody(match[2]));
    }
    for (const match of addColumnMatches(sql, false)) {
      const columns = tables.get(match[1]);
      if (columns && !columns.includes(match[2])) columns.push(match[2]);
    }
  }
  return tables;
}

/**
 * table -> { column: postgres type }, after every migration. This is what
 * supabase/column-types.json must equal, because the runtime adapter binds and
 * transforms values from that contract.
 */
export function effectiveColumnTypes() {
  const tables = {};
  const typeInBody = new RegExp(String.raw`^\s{2}([a-z_][a-z0-9_]*)\s+(${TYPE})`, "i");
  for (const file of migrationFiles()) {
    const sql = readMigration(file);
    for (const match of sql.matchAll(CREATE_TABLE)) {
      const columns = tables[match[1]] ?? (tables[match[1]] = {});
      for (const line of match[2].split("\n")) {
        const column = line.match(typeInBody);
        if (column && !(column[1] in columns)) columns[column[1]] = column[2].toLowerCase();
      }
    }
    for (const match of addColumnMatches(sql, true)) {
      const columns = tables[match[1]];
      if (columns && !(match[2] in columns)) columns[match[2]] = match[3].toLowerCase();
    }
  }
  return tables;
}

/** Every table the migrations create, in any file. */
export function effectiveTables() {
  return new Set(effectiveColumns().keys());
}

/** The newest Drizzle snapshot, which is the deployed SQLite/D1 shape. */
export function latestSnapshot() {
  const files = fs
    .readdirSync(new URL("drizzle/meta/", ROOT))
    .filter((file) => /^\d+_snapshot\.json$/.test(file))
    .sort();
  return JSON.parse(fs.readFileSync(new URL("drizzle/meta/" + files[files.length - 1], ROOT), "utf8"));
}

export function columnTypes() {
  return JSON.parse(fs.readFileSync(new URL("supabase/column-types.json", ROOT), "utf8"));
}
