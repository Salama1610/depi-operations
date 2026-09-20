#!/usr/bin/env node
// Boots a local PostgreSQL workspace for hands-on testing, applies the real
// Supabase migrations and seeds one staff user, one group and one student.
//
// Nothing here touches the production Supabase project: the server listens on
// 127.0.0.1, the data directory lives under the OS temp folder, and the only
// shared resource is Supabase Auth, which still authenticates the tester.
//
//   node --experimental-strip-types scripts/local-qa-workspace.mjs --email <address>
//
// Options:
//   --email <address>   Email of the seeded student and staff user. It must
//                       match the Supabase Auth account used to sign in.
//   --name <name>       Display name for the seeded records.
//   --port <number>     Fixed port instead of an arbitrary free one.
//   --dir <path>        Reuse an existing data directory (keeps prior data).
//   --print-env         Also print the .env.local block for the local app.
//
// The process stays in the foreground until interrupted, then shuts the
// server down and, unless --dir was given, deletes the data directory.
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { policy } from "../lib/domain/rules.ts";
import { postgresTypes } from "../lib/data/postgres.ts";

const ROOT = new URL("../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, ROOT), "utf8");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
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

const args = parseArgs(process.argv.slice(2));
const email = String(args.email || "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Pass --email <address>; it must match the Supabase Auth account you sign in with.");
  process.exit(1);
}
const displayName = String(args.name || "QA Tester");
const reuseDir = args.dir ? String(args.dir) : null;
const databaseDir = reuseDir || fs.mkdtempSync(path.join(os.tmpdir(), "depi-qa-"));
const fresh = !reuseDir;
const port = Number(args.port || (await freePort()));

const server = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-c", "io_method=sync", "-c", "fsync=off", "-c", "synchronous_commit=off"],
  onLog: () => {},
  onError: () => {},
});

if (fresh) await server.initialise();
await server.start();
if (fresh) await server.createDatabase("depi");
const url = `postgres://postgres:postgres@127.0.0.1:${port}/depi`;

// postgresTypes stops the driver re-encoding already-serialized jsonb text,
// which would otherwise store a JSON string where an object is required.
const sql = postgres(url, { max: 1, prepare: false, fetch_types: false, types: postgresTypes, onnotice: () => {} });

async function applyMigrations() {
  await sql.unsafe(read("tests/helpers/supabase-stubs.sql"));
  const files = fs
    .readdirSync(new URL("supabase/migrations/", ROOT))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) await sql.unsafe(read("supabase/migrations/" + file));
  return files.length;
}

/**
 * Seeds the smallest workspace the student portal and the QC screen need. The
 * staff user and the student share one email so a single Supabase Auth account
 * can exercise both sides of the review loop.
 */
async function seed() {
  const at = new Date().toISOString();
  const staffId = "qa-staff";
  const studentId = "QA-STUDENT-1";
  await sql.unsafe(
    `insert into public.users (id, email, name, roles, scopes, active)
     values ($1, $2, $3, $4::jsonb, '[]'::jsonb, true)
     on conflict (id) do update set email = excluded.email, name = excluded.name, roles = excluded.roles`,
    [staffId, email, displayName, JSON.stringify(["Project Operations", "Operations Systems / Admin", "Quality Lead"])],
  );
  await sql.unsafe(
    `insert into public.policies (id, name, status, config, created_by, approved_by, created_at)
     values ('R5-v1', 'Round 5 · v1', 'Effective', $1::jsonb, $2, $2, $3)
     on conflict (id) do nothing`,
    [JSON.stringify(policy), staffId, at],
  );
  await sql.unsafe(
    `insert into public.tracks (id, name, provider, capacity, active, created_at)
     values ('QA-TRACK', 'Software Development', 'QA Provider', 50, true, $1)
     on conflict (id) do nothing`,
    [at],
  );
  await sql.unsafe(
    `insert into public.groups (id, name, track, provider, coordinator, supervisor, coach, pathway, delivery_model, start_date, status, policy_id)
     values ('QA-GROUP-1', 'QA-GROUP-1', 'Software Development', 'QA Provider', $1, $1, $1, 'Outcome', 'Regular', current_date, 'Active', 'R5-v1')
     on conflict (id) do nothing`,
    [staffId],
  );
  await sql.unsafe(
    `insert into public.students (id, tp_id, name, group_id, email, phone, job_profile, student_type, source_status, lifecycle, engagement, coaching, milestone, created_at)
     values ($1, 'QA-0001', $2, 'QA-GROUP-1', $3, '1000000000', 'Junior Developer', 'Student', 'ACTIVE', 'Active', 'Active', 'In Progress', 0, $4)
     on conflict (id) do update set email = excluded.email, name = excluded.name`,
    [studentId, displayName, email, at],
  );
  return { staffId, studentId };
}

let seeded;
try {
  if (fresh) {
    const count = await applyMigrations();
    console.log(`applied ${count} Supabase migrations to the local server`);
  }
  seeded = await seed();
} catch (error) {
  console.error("setup failed:", error.message);
  await sql.end({ timeout: 5 }).catch(() => {});
  await server.stop().catch(() => {});
  if (fresh) fs.rmSync(databaseDir, { recursive: true, force: true });
  process.exit(1);
}

const counts = (
  await sql.unsafe(
    "select (select count(*) from students) students, (select count(*) from groups) groups, (select count(*) from users) users",
  )
)[0];

console.log("");
console.log("Local QA workspace ready. This database is disposable and separate from production.");
console.log("  database   " + url);
console.log("  data dir   " + databaseDir);
console.log(`  seeded     student ${seeded.studentId}, staff ${seeded.staffId}, group QA-GROUP-1`);
console.log(`  identity   ${email} (must match a Supabase Auth account)`);
console.log(`  rows       ${counts.students} student, ${counts.groups} group, ${counts.users} user`);
if (args["print-env"]) {
  console.log("");
  console.log("Add to .env.local, keeping SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for Auth:");
  console.log("  SUPABASE_DB_TRANSPORT=postgres");
  console.log("  SUPABASE_DB_URL=" + url);
}
console.log("");
console.log("Leave this running while you test. Press Ctrl+C to stop and discard it.");

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nstopping the local QA workspace");
  await sql.end({ timeout: 5 }).catch(() => {});
  await server.stop().catch(() => {});
  if (fresh) fs.rmSync(databaseDir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
