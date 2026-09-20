// Boots a disposable PostgreSQL server, installs minimal Supabase platform
// stand-ins, applies the real Supabase migrations and returns the application's
// statement interface backed by lib/data/postgres.ts.
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createPostgresDatabase, prepareDialect } from "../../lib/data/postgres.ts";
import { createRpcDatabase, rpcError } from "../../lib/data/rpc.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, ROOT), "utf8");

export function columnTypes() {
  return JSON.parse(read("supabase/column-types.json"));
}

export function dialectOptions() {
  return prepareDialect(columnTypes());
}

export function migrationFiles() {
  return fs
    .readdirSync(new URL("supabase/migrations/", ROOT))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Applies the stubs and migrations to `url` using the simple query protocol so
 * multi-statement files with `$$` bodies run unchanged.
 */
export async function applySupabaseMigrations(url, { stubs = true } = {}) {
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (stubs) await admin.unsafe(read("tests/helpers/supabase-stubs.sql"));
    for (const file of migrationFiles()) await admin.unsafe(read("supabase/migrations/" + file));
    const [{ version }] = await admin.unsafe("select current_setting('server_version') as version");
    return version;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/**
 * Statement caller for the HTTPS transport, executed over the wire instead of
 * PostgREST: `public.depi_execute` is invoked exactly as the Worker's fetch
 * caller would, so the SQL function, literal inlining and row normalization
 * are exercised end to end without a Supabase API in the loop.
 */
export function createWireStatementCaller(url) {
  const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const caller = async (statements) => {
    try {
      const [{ result }] = await admin.unsafe("select public.depi_execute($1::text::jsonb) as result", [
        JSON.stringify(statements),
      ]);
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return parsed.map((entry) => ({ rows: entry.rows ?? [], changes: Number(entry.changes ?? 0) }));
    } catch (error) {
      // Mirror what PostgREST would report so the adapter maps it identically.
      throw rpcError(400, {
        code: error.code,
        message: error.message,
        details: error.detail,
      });
    }
  };
  caller.end = () => admin.end({ timeout: 5 });
  return caller;
}

export async function startPostgresTestDatabase({ applyMigrations = true, transport = "postgres" } = {}) {
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "depi-pg-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    // io_method=sync keeps PostgreSQL 18 from forking I/O worker processes that
    // outlive the hard shutdown on Windows and hold the test runner's pipes
    // open. The durability settings only speed up the disposable cluster.
    postgresFlags: [
      "-c", "io_method=sync",
      "-c", "fsync=off",
      "-c", "synchronous_commit=off",
      "-c", "full_page_writes=off",
      "-c", "max_connections=20",
    ],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("depi");
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/depi`;
  let version = null;
  try {
    if (applyMigrations) version = await applySupabaseMigrations(url);
  } catch (error) {
    await server.stop().catch(() => {});
    fs.rmSync(databaseDir, { recursive: true, force: true });
    throw error;
  }
  const wire = createPostgresDatabase(url, { columnTypes: columnTypes(), ssl: false, max: 2 });
  const caller = transport === "rpc" ? createWireStatementCaller(url) : null;
  const db = caller ? createRpcDatabase(caller, { columnTypes: columnTypes() }) : wire;
  return {
    db,
    wire,
    transport,
    url,
    port,
    version,
    databaseDir,
    async stop() {
      await caller?.end().catch(() => {});
      await wire.end().catch(() => {});
      await server.stop().catch(() => {});
      fs.rmSync(databaseDir, { recursive: true, force: true });
    },
  };
}
