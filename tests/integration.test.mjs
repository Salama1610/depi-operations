import test, { after } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { build } from "esbuild";
import { startPostgresTestDatabase } from "./helpers/postgres-test-db.mjs";
const testDirectory = fs.mkdtempSync(join(tmpdir(), "depi-test-"));
after(() => fs.rmSync(testDirectory, { recursive: true, force: true }));
// DEPI_TEST_BACKEND=postgres runs the same service tests against a disposable
// PostgreSQL server with the Supabase migrations applied; the default keeps the
// fast in-memory SQLite mirror of the D1 schema.
const backend = ["postgres", "postgres-rpc"].includes(process.env.DEPI_TEST_BACKEND)
  ? process.env.DEPI_TEST_BACKEND
  : "sqlite";
const onPostgres = backend !== "sqlite";
let sqlite = null;
let postgresHandle = null;
if (backend === "sqlite") {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of fs
    .readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(fs.readFileSync("drizzle/" + file, "utf8"));
} else {
  postgresHandle = await startPostgresTestDatabase({ transport: backend === "postgres-rpc" ? "rpc" : "postgres" });
  after(() => postgresHandle.stop());
}
let current = { id: "owner", email: "owner@example.com" };
globalThis.__testSupabaseUser = () => ({
  id: current.id,
  email: current.email,
  user_metadata: { full_name: current.email },
});
const supabaseAuthMock = {
  name: "test-supabase-auth",
  setup(build) {
    build.onResolve({ filter: /supabase\/server$/ }, () => ({
      path: "supabase-server",
      namespace: "auth-mock",
    }));
    build.onLoad({ filter: /.*/, namespace: "auth-mock" }, () => ({
      contents: "export const getSupabaseUser=async()=>globalThis.__testSupabaseUser()",
      loader: "js",
    }));
  },
};
const query = (sql, args = []) => ({
  sql,
  args,
  bind(...v) {
    return query(sql, v);
  },
  async first() {
    return sqlite.prepare(sql).get(...args) || null;
  },
  async all() {
    return { results: sqlite.prepare(sql).all(...args) };
  },
  async run() {
    const r = sqlite.prepare(sql).run(...args);
    return { success: true, meta: { changes: r.changes } };
  },
});
const sqliteDatabase = {
    prepare: query,
    async batch(jobs) {
      sqlite.exec("BEGIN");
      try {
        const r = [];
        for (const j of jobs)
          r.push(/^SELECT/i.test(j.sql.trim()) ? await j.all() : await j.run());
        sqlite.exec("COMMIT");
        return r;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
};
const DB = backend === "sqlite" ? sqliteDatabase : postgresHandle.db;
globalThis.__testEnv = { DB, BUCKET: {}, LOCAL_DATA_FALLBACK: "1" };
const dbRow = async (sql, ...args) => DB.prepare(sql).bind(...args).first();
const dbRows = async (sql, ...args) => (await DB.prepare(sql).bind(...args).all()).results;
const dbExec = async (sql, ...args) => DB.prepare(sql).bind(...args).run();
const ROWID = onPostgres ? "ctid" : "rowid";
globalThis.__testHeaders = () =>
  new Headers({
    "oai-authenticated-user-id": current.id,
    "oai-authenticated-user-email": current.email,
  });
await build({
  entryPoints: ["app/api/operations/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(testDirectory, "operations.mjs"),
  plugins: [
    supabaseAuthMock,
    {
      name: "test-bindings",
      setup(b) {
        b.onResolve(
          { filter: /^(cloudflare:workers|next\/headers)$/ },
          (a) => ({ path: a.path, namespace: "mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
          contents:
            a.path === "cloudflare:workers"
              ? "export const env=globalThis.__testEnv"
              : "export const headers=async()=>globalThis.__testHeaders()",
          loader: "js",
        }));
      },
    },
  ],
});
const api = await import(pathToFileURL(join(testDirectory, "operations.mjs")).href);
await build({
  entryPoints: ["app/api/program/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(testDirectory, "program.mjs"),
  plugins: [
    supabaseAuthMock,
    {
      name: "test-bindings",
      setup(b) {
        b.onResolve(
          { filter: /^(cloudflare:workers|next\/headers)$/ },
          (a) => ({ path: a.path, namespace: "mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
          contents:
            a.path === "cloudflare:workers"
              ? "export const env=globalThis.__testEnv"
              : "export const headers=async()=>globalThis.__testHeaders()",
          loader: "js",
        }));
      },
    },
  ],
});
const programApi = await import(pathToFileURL(join(testDirectory, "program.mjs")).href);
await build({
  entryPoints: ["app/api/import/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(testDirectory, "import.mjs"),
  plugins: [
    supabaseAuthMock,
    {
      name: "test-bindings",
      setup(b) {
        b.onResolve(
          { filter: /^(cloudflare:workers|next\/headers)$/ },
          (a) => ({ path: a.path, namespace: "mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
          contents:
            a.path === "cloudflare:workers"
              ? "export const env=globalThis.__testEnv"
              : "export const headers=async()=>globalThis.__testHeaders()",
          loader: "js",
        }));
      },
    },
  ],
});
const importApi = await import(pathToFileURL(join(testDirectory, "import.mjs")).href);
const post = async (action, x = {}) => {
  const r = await api.POST(
    new Request("https://test.local/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...x }),
    }),
  );
  return await r.json();
};
const check = async (action, x = {}) => {
  const r = await post(action, x);
  assert.equal(r.error, undefined, r.error);
  return r;
};
const programPost = async (action, x = {}) => {
  const response = await programApi.POST(
    new Request("https://test.local/api/program", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...x }),
    }),
  );
  return await response.json();
};
const programCheck = async (action, x = {}) => {
  const result = await programPost(action, x);
  assert.equal(result.error, undefined, result.error);
  return result;
};
const importPost = async (payload) => {
  const response = await importApi.POST(
    new Request("https://test.local/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return await response.json();
};
test("full seeded backend workflow and permission gates", async () => {
  await check("setup", { mode: "production" });
  assert.equal((await dbRow("SELECT count(*) n FROM students")).n, 0);
  await check("load_demo_data", { request_id: "load-synthetic-pilot-once" });
  await check("load_demo_data", { request_id: "load-synthetic-pilot-once" });
  assert.equal((await dbRow("SELECT count(*) n FROM students")).n, 1000);
  assert.equal((await dbRow("SELECT count(*) n FROM tasks")).n, 1000);
  const data = await (await api.GET()).json();
  assert.equal(data.students.length, 1000);
  assert.equal(data.workspaceMode, "demo");
  assert.equal(data.students[0].graduation, "0/3");
  assert.ok(data.students[0].next_task);
  let r = await post("contact", { student_id: "S10001" });
  assert.match(r.error, /incomplete/);
  await dbExec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)", 
      "PROOF-1",
      "S10001",
      "key1",
      "proof.png",
      "image/png",
      100,
      "hash1",
      "owner",
      new Date().toISOString(),
    );
  await dbExec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)", 
      "PROOF-2",
      "S10001",
      "key2",
      "payment.png",
      "image/png",
      100,
      "hash2",
      "owner",
      new Date().toISOString(),
    );
  await dbExec("INSERT INTO attachment_context VALUES(?,?,?,?,?,?,?,?,?,?)", 
      "PROOF-1",
      "G101",
      null,
      null,
      "Supporting evidence",
      "WhatsApp",
      new Date().toISOString(),
      "Test upload",
      "STAFF",
      null,
    );
  const c = {
    student_id: "S10001",
    outcome: "Responded",
    proof_id: "PROOF-1",
    next_action: "Next contact",
    owner: "owner",
    due: "2027-01-01T00:00:00Z",
    occurred_at: new Date().toISOString(),
    channel: "WhatsApp",
    request_id: "contact-once",
  };
  await check("contact", c);
  await check("contact", c);
  assert.equal(
    (await dbRow("SELECT count(*) n FROM contacts WHERE student_id='S10001'")).n,
    1,
  );
  assert.equal(
    (await dbRow("SELECT activity_type FROM attachment_context WHERE attachment_id='PROOF-1'")).activity_type,
    "Student contact",
  );
  await check("account_request", {
    id: "REQ1",
    student_id: "S10001",
    task_bank_id: "TB-DM-1",
    job_profile: "Digital marketing specialist",
    gig_number: 1,
  });
  // Role gates are probed with a Project Operations member who does not hold
  // the admin role, because Operations Systems / Admin may perform any action.
  await check("staff", {
    name: "Ops Only",
    email: "ops-only@example.com",
    roles: ["Project Operations"],
    reason: "Probe role gates without the admin role",
  });
  const opsOnly = { id: "ops-only-login", email: "ops-only@example.com" };
  current = opsOnly;
  r = await post("allocate", {
    request: "REQ1",
    account: "ACC-102",
    task_fit: true,
  });
  assert.match(r.error, /role/);
  current = { id: "owner", email: "owner@example.com" };
  await check("staff", {
    name: "Owner",
    email: "owner@example.com",
    roles: ["Project Operations", "Operations Systems / Admin", "Higher Board"],
    reason: "Explicit test allocation role",
  });
  await check("reserve_account", {
    request: "REQ1",
    account: "ACC-102",
  });
  await check("allocate", {
    request: "REQ1",
    task_fit: true,
  });
  assert.equal(
    (await dbRow("SELECT status FROM accounts WHERE id='ACC-102'"))
      .status,
    "Assigned",
  );
  await check("account_request", {
    id: "REQ2",
    student_id: "S10002",
    task_bank_id: "TB-DM-1",
    job_profile: "Digital marketing specialist",
    gig_number: 1,
  });
  r = await post("reserve_account", {
    request: "REQ2",
    account: "ACC-102",
  });
  assert.match(r.error, /unavailable|assigned/);
  const gig = (await dbRow("SELECT * FROM gigs WHERE student_id='S10001'"));
  r = await post("gig_transition", {
    id: gig.id,
    status: "Paid",
    proof_id: "PROOF-1",
    occurred_at: new Date().toISOString(),
  });
  assert.match(r.error, /transition/);
  for (const status of ["Gig Opened", "Work Submitted", "Delivered", "Paid"])
    await check("gig_transition", {
      id: gig.id,
      status,
      proof_id: "PROOF-1",
      occurred_at: new Date().toISOString(),
    });
  await check("evidence", {
    id: "EV1",
    gig_id: gig.id,
    proof_id: "PROOF-1",
    payment_proof_id: "PROOF-2",
    source: "WhatsApp",
  });
  current = opsOnly;
  r = await post("review", { id: "EV1", notes: "Looks complete" });
  assert.match(r.error, /role/);
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  await check("review", { id: "EV1", notes: "Coach confirms delivery" });
  current = { id: "owner", email: "owner@example.com" };
  await check("review", { id: "EV1", notes: "Completeness checked" });
  current = opsOnly;
  r = await post("review", { id: "EV1", decision: "Accept", notes: "Approve" });
  assert.match(r.error, /role/);
  current = { id: "quality-login", email: "staff-quality@example.invalid" };
  await check("review", {
    id: "EV1",
    decision: "Reject",
    code: "EV01",
    notes: "Need delivery screenshot",
    request_id: "reject-once",
  });
  await check("review", {
    id: "EV1",
    decision: "Reject",
    code: "EV01",
    notes: "Need delivery screenshot",
    request_id: "reject-once",
  });
  assert.equal(
    (await dbRow("SELECT count(*) n FROM tasks WHERE category='Correction'")).n,
    1,
  );
  current = { id: "owner", email: "owner@example.com" };
  await check("review", {
    id: "EV1",
    proof_id: "PROOF-1",
    payment_proof_id: "PROOF-2",
    notes: "Corrected package",
  });
  current = { id: "quality-login", email: "staff-quality@example.invalid" };
  await check("review", {
    id: "EV1",
    decision: "Accept",
    notes: "All seven checks passed",
    checklist: [
      "Completeness",
      "Identity",
      "Delivery",
      "Payment/value",
      "Authenticity",
      "Source consistency",
      "Duplicate checks",
    ],
  });
  assert.equal(
    (await dbRow("SELECT status FROM evidence WHERE id='EV1'")).status,
    "Accepted",
  );
  assert.equal(
    (await dbRow(`SELECT result FROM graduation_ledger WHERE student_id='S10001' ORDER BY ${ROWID} DESC LIMIT 1`)).result,
    "1/3",
  );
  current = { id: "coordinator-login", email: "staff-omar@example.invalid" };
  r = await post("contact", c);
  assert.ok(r.error);
  r = await post("review", {
    id: "EV1",
    decision: "Reopen",
    notes: "Unauthorized",
  });
  assert.ok(r.error);
  await assert.rejects(dbExec("UPDATE audit_events SET action='tampered'"), /immutable/);
  await assert.rejects(dbExec("DELETE FROM evidence_reviews"), /immutable/);
});
test("verified Supabase email recovers staff identity when the auth id changes", async () => {
  current = { id: "supabase-new-id", email: "owner@example.com" };
  const data = await (await api.GET()).json();
  assert.equal(data.user.email, "owner@example.com");
  assert.equal(data.error, undefined);
  current = { id: "owner", email: "owner@example.com" };
});
test("session delivery enforces model limits, coach coverage and lifecycle controls", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const startsAt = new Date(Date.now() + 90 * 86400000).toISOString();
  const rescheduledAt = new Date(Date.now() + 92 * 86400000).toISOString();
  await check("session", {
    id: "SES-RULE-1",
    group_id: "G101",
    coach_id: "staff-coach",
    title: "Industry coaching session 1",
    starts_at: startsAt,
    week: 1,
    duration_minutes: 180,
  });
  const created = (await dbRow("SELECT * FROM sessions WHERE id='SES-RULE-1'"));
  assert.equal(created.status, "Scheduled");
  assert.equal(created.coach_id, "staff-coach");
  assert.equal(created.duration_minutes, 180);
  let r = await post("session", {
    id: "SES-DUPLICATE-WEEK",
    group_id: "G101",
    coach_id: "staff-support-coach",
    title: "Duplicate week",
    starts_at: new Date(Date.now() + 91 * 86400000).toISOString(),
    week: 1,
    duration_minutes: 180,
  });
  assert.match(r.error, /already has an active session/);
  r = await post("session", {
    id: "SES-COACH-CONFLICT",
    group_id: "G102",
    coach_id: "staff-coach",
    title: "Conflicting coach day",
    starts_at: startsAt,
    week: 1,
    duration_minutes: 180,
  });
  assert.match(r.error, /already has a group session/);
  await check("session", {
    id: "SES-RULE-2",
    group_id: "G102",
    coach_id: "staff-support-coach",
    title: "Regular coaching session 1",
    starts_at: startsAt,
    week: 1,
    duration_minutes: 180,
  });
  r = await post("session", {
    id: "SES-BAD-INDUSTRY-WEEK",
    group_id: "G101",
    coach_id: "staff-support-coach",
    title: "Industry week outside policy",
    starts_at: new Date(Date.now() + 94 * 86400000).toISOString(),
    week: 6,
    duration_minutes: 180,
  });
  assert.match(r.error, /weeks 1–5/);
  r = await post("session", {
    id: "SES-BAD-DURATION",
    group_id: "G103",
    coach_id: "staff-support-coach",
    title: "Wrong duration",
    starts_at: new Date(Date.now() + 95 * 86400000).toISOString(),
    week: 1,
    duration_minutes: 60,
  });
  assert.match(r.error, /180 minutes/);
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  await check("session_confirm", { id: "SES-RULE-1" });
  assert.ok(
    (await dbRow("SELECT confirmed_at FROM sessions WHERE id='SES-RULE-1'")).confirmed_at,
  );
  r = await post("session_reschedule", {
    id: "SES-RULE-1",
    starts_at: rescheduledAt,
    reason: "Coach availability changed",
  });
  assert.match(r.error, /role/);
  current = { id: "owner", email: "owner@example.com" };
  await check("session_reschedule", {
    id: "SES-RULE-1",
    coach_id: "staff-coach",
    starts_at: rescheduledAt,
    reason: "Coach availability changed",
  });
  const moved = (await dbRow("SELECT status,confirmed_at,starts_at FROM sessions WHERE id='SES-RULE-1'"));
  assert.equal(moved.status, "Scheduled");
  assert.equal(moved.confirmed_at, null);
  assert.equal(moved.starts_at, rescheduledAt);
  await check("session_cancel", {
    id: "SES-RULE-1",
    reason: "Group requested a replacement date",
  });
  assert.equal(
    (await dbRow("SELECT status FROM sessions WHERE id='SES-RULE-1'"))
      .status,
    "Cancelled",
  );
  r = await post("attendance", {
    session_id: "SES-RULE-1",
    student_id: "S10001",
    status: "Present",
    source: "Coach roll call",
  });
  assert.match(r.error, /non-cancelled/);
  const deliveredAt = new Date(Date.now() - 86400000).toISOString();
  await check("session", {
    id: "SES-RULE-COMPLETE",
    group_id: "G103",
    coach_id: "staff-support-coach",
    title: "Completed delivery control",
    starts_at: deliveredAt,
    week: 2,
    duration_minutes: 180,
  });
  current = {
    id: "support-coach-login",
    email: "staff-support-coach@example.invalid",
  };
  await check("session_confirm", { id: "SES-RULE-COMPLETE" });
  r = await programPost("complete_session", {
    session_id: "SES-RULE-COMPLETE",
    notes: "Delivery completed with documented follow-up actions.",
  });
  assert.match(r.error, /attendance/i);
  current = { id: "owner", email: "owner@example.com" };
  const activeStudents = (await dbRows("SELECT id FROM students WHERE group_id='G103' AND lifecycle='Active'"));
  for (const student of activeStudents)
    await check("attendance", {
      session_id: "SES-RULE-COMPLETE",
      student_id: student.id,
      status: "Present",
      source: "Coach roll call",
    });
  current = {
    id: "support-coach-login",
    email: "staff-support-coach@example.invalid",
  };
  await programCheck("complete_session", {
    session_id: "SES-RULE-COMPLETE",
    notes: "Delivery completed with documented follow-up actions.",
  });
  assert.equal(
    (await dbRow("SELECT status FROM sessions WHERE id='SES-RULE-COMPLETE'")).status,
    "Completed",
  );
  assert.equal(
    (await dbRow("SELECT attendance_reconciled FROM session_reports WHERE session_id='SES-RULE-COMPLETE'")).attendance_reconciled,
    1,
  );
  current = { id: "owner", email: "owner@example.com" };
});
test("session spreadsheet preview and commit retain the governed controls", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const row = {
    id: "SES-IMPORT-1",
    group_id: "G104",
    coach_id: "staff-support-coach",
    title: "Imported governed session",
    starts_at: new Date(Date.now() + 110 * 86400000).toISOString(),
    week: 1,
    duration_minutes: 180,
  };
  const incomplete = await importPost({
    module: "sessions",
    rows: [{ ...row, coach_id: "" }],
  });
  assert.equal(incomplete.rows[0].status, "Rejected");
  assert.ok(
    incomplete.rows[0].errors.some((error) => error.field === "coach_id"),
  );
  const preview = await importPost({ module: "sessions", rows: [row] });
  assert.equal(preview.rows[0].status, "Ready");
  const committed = await importPost({
    module: "sessions",
    rows: [row],
    confirm: true,
    batch_id: "IMPORT-SESSION-CONTROL",
  });
  assert.equal(committed.created, 1);
  assert.equal(
    (await dbRow("SELECT coach_id FROM sessions WHERE id='SES-IMPORT-1'"))
      .coach_id,
    "staff-support-coach",
  );
  const replay = await importPost({
    module: "sessions",
    rows: [row],
    confirm: true,
    batch_id: "IMPORT-SESSION-CONTROL",
  });
  assert.deepEqual(replay, committed);
});
test("student roster preview reports missing and duplicate emails and handles 1,000 rows", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const invalid = await importPost({ module: "students", rows: [
    { id: "S-ROSTER-MISSING", name: "Missing Email", group_id: "G101", email: "" },
    { id: "S-ROSTER-DUP-1", name: "Duplicate One", group_id: "G101", email: "duplicate@example.com" },
    { id: "S-ROSTER-DUP-2", name: "Duplicate Two", group_id: "G101", email: "DUPLICATE@example.com" },
  ] });
  assert.equal(invalid.rows[0].status, "Rejected");
  assert.ok(invalid.rows[0].errors.some((error) => error.field === "email"));
  assert.equal(invalid.rows[2].status, "Rejected");
  assert.ok(invalid.rows[2].errors.some((error) => /Duplicate/.test(error.error)));
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    id: `S-ROSTER-${String(index + 1).padStart(4, "0")}`,
    name: `Roster Student ${index + 1}`,
    group_id: "G101",
    email: `roster-${index + 1}@example.com`,
    lifecycle: "Active",
  }));
  const preview = await importPost({ module: "students", rows });
  assert.equal(preview.rows.length, 1000);
  assert.equal(preview.rows.filter((row) => row.status === "Ready").length, 1000);
});
test("complete program flow governs intake, assessment, withdrawal, certificate and reporting", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await programCheck("application", {
    id: "APP-FLOW",
    external_ref: "MIN-R5-FLOW",
    name: "Flow Learner",
    email: "flow@example.invalid",
    preferred_track: "Digital Marketing",
    source: "Ministry intake",
    owner: "owner",
  });
  await programCheck("screen_application", {
    application_id: "APP-FLOW",
    decision: "Eligible",
    criteria: [
      "Identity and registration record checked",
      "Contact details confirmed",
      "Track prerequisites reviewed",
      "Program availability confirmed",
    ],
    reason: "All supplied screening checks passed",
  });
  await programCheck("admit_application", {
    application_id: "APP-FLOW",
    student_id: "S-FLOW",
    group_id: "G101",
  });
  assert.equal(
    (await dbRow("SELECT status FROM applications WHERE id='APP-FLOW'"))
      .status,
    "Admitted",
  );
  await programCheck("assessment", {
    id: "ASM-FLOW",
    group_id: "G101",
    title: "Final readiness",
    type: "Final",
    max_score: 100,
    pass_score: 60,
    due_at: "2027-01-01T00:00:00Z",
  });
  await programCheck("assessment_result", {
    id: "ASR-FLOW",
    assessment_id: "ASM-FLOW",
    student_id: "S-FLOW",
    score: 84,
    notes: "Final assessment completed",
  });
  assert.equal(
    (await dbRow("SELECT outcome FROM assessment_results WHERE id='ASR-FLOW'")).outcome,
    "Passed",
  );
  await programCheck("assessment_result", {
    id: "ASR-CERT",
    assessment_id: "ASM-FLOW",
    student_id: "S10001",
    score: 90,
    notes: "Certificate prerequisite completed",
  });
  const sessionResult = await programPost("complete_session", {
    session_id: "SES-101",
    notes: "Delivery completed with follow-up actions recorded.",
  });
  assert.match(sessionResult.error, /started|attendance/i);
  await programCheck("withdrawal_decision", {
    id: "WD-FLOW",
    student_id: "S-FLOW",
    ministry_reference: "MIN-WD-FLOW",
    decision: "Approved",
    decided_at: "2026-09-10",
    reason: "Approved withdrawal test",
  });
  assert.equal(
    (await dbRow("SELECT lifecycle FROM students WHERE id='S-FLOW'"))
      .lifecycle,
    "Withdrawn",
  );
  await dbExec("UPDATE students SET lifecycle='Graduate Closed' WHERE id='S10001'");
  await dbExec("INSERT INTO graduation_ledger VALUES(?,?,?,?,?,?)", 
      "GR-CERT",
      "S10001",
      "R5-v1",
      "Graduated",
      "[]",
      new Date().toISOString(),
    );
  await programCheck("issue_certificate", {
    id: "CERT-FLOW",
    student_id: "S10001",
    type: "Completion",
    external_ref: "CERT-R5-FLOW",
  });
  await programCheck("post_program_outcome", {
    id: "OUT-FLOW",
    student_id: "S10001",
    type: "Freelancing",
    title: "Verified freelance outcome",
    status: "Verified",
    proof_id: "PROOF-1",
    follow_up_at: "2027-02-01T00:00:00Z",
    owner: "owner",
  });
  await programCheck("report_definition", {
    id: "RDEF-FLOW",
    name: "Ministry Round 5 test format",
    columns: [
      "student_id",
      "name",
      "track",
      "lifecycle",
      "graduation",
      "certificate_status",
    ],
    reason: "Test-authorized reporting handoff",
  });
  assert.match(
    (await programPost("approve_report_definition", {
      id: "RDEF-FLOW",
      reason: "Self approval is not permitted",
    })).error,
    /cannot approve their own/i,
  );
  await check("staff", {
    name: "Independent report approver",
    email: "report-approver@example.com",
    roles: ["Project Operations"],
    reason: "Independent Ministry reporting approval",
  });
  const reportApprover = (await dbRow("SELECT id FROM users WHERE email='report-approver@example.com'")).id;
  current = { id: reportApprover, email: "report-approver@example.com" };
  await programCheck("approve_report_definition", {
    id: "RDEF-FLOW",
    reason: "Matched the Ministry-supplied field order",
  });
  current = { id: "owner", email: "owner@example.com" };
  const data = await (
    await programApi.GET(new Request("https://test.local/api/program"))
  ).json();
  assert.ok(
    data.readiness.some((r) => r.key === "withdrawal" && r.status === "Pass"),
  );
  assert.ok(data.groupCoaches.some((c) => c.coach_type === "Outcome Coach"));
  const exportResponse = await programApi.GET(
    new Request(
      "https://test.local/api/program?format=ministry_csv&definition=RDEF-FLOW",
    ),
  );
  assert.equal(exportResponse.status, 200);
  assert.match(await exportResponse.text(), /student_id/);
  const xlsxResponse = await programApi.GET(
    new Request("https://test.local/api/program?format=ministry_xlsx&definition=RDEF-FLOW"),
  );
  assert.equal(xlsxResponse.status, 200);
  assert.match(xlsxResponse.headers.get("content-type"), /spreadsheetml/);
  assert.equal((await dbRow("SELECT count(*) n FROM report_runs WHERE definition_id='RDEF-FLOW'")).n, 2);
  const lifecycleExport = await programApi.GET(
    new Request("https://test.local/api/program?format=xlsx&dataset=lifecycle"),
  );
  assert.equal(lifecycleExport.status, 200);
  assert.match(lifecycleExport.headers.get("content-disposition"), /program-lifecycle\.xlsx/);
});
test("safe bulk controls are atomic and dangerous approvals stay individual", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await programCheck("bulk_tasks", {
    student_ids: ["S10002", "S10003"],
    title: "Prepare weekly evidence package",
    owner: "staff-sara",
    due: "2027-01-15T10:00:00Z",
    priority: "High",
    reason: "Weekly readiness batch",
  });
  assert.equal(
    (await dbRow("SELECT count(*) n FROM tasks WHERE title='Prepare weekly evidence package'")).n,
    2,
  );
  await programCheck("bulk_classification", {
    student_ids: ["S10002", "S10003"],
    status: "At Risk",
    reason: "Shared progress threshold reached",
  });
  assert.equal(
    (await dbRow("SELECT count(*) n FROM students WHERE id IN ('S10002','S10003') AND engagement='At Risk'")).n,
    2,
  );
  await programCheck("bulk_group_owner", {
    group_ids: ["G101", "G102"],
    owner_type: "Coordinator",
    owner: "staff-sara",
    reason: "Approved workload rebalance",
  });
  assert.equal(
    (await dbRow("SELECT count(*) n FROM groups WHERE id IN ('G101','G102') AND coordinator='staff-sara'")).n,
    2,
  );
  const rejected = await programPost("bulk_classification", {
    student_ids: ["S10002", "missing-student"],
    status: "Critical",
    reason: "Atomic validation test",
  });
  assert.match(rejected.error, /not found|scope/i);
  assert.equal((await dbRow("SELECT engagement FROM students WHERE id='S10002'")).engagement, "At Risk");
});
test("track capacity blocks direct and admitted roster growth", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const enrolled = (await dbRow("SELECT count(*) n FROM students s JOIN groups g ON g.id=s.group_id WHERE g.track='Digital Marketing' AND s.lifecycle NOT IN ('Transferred','Withdrawn','Removed')")).n;
  await dbExec("UPDATE tracks SET capacity=? WHERE name='Digital Marketing'", enrolled);
  assert.match(
    (await post("student", { id: "S-CAPACITY", name: "Capacity Test", group_id: "G101" })).error,
    /capacity/,
  );
  assert.equal((await dbRow("SELECT count(*) n FROM students WHERE id='S-CAPACITY'")).n, 0);
  await dbExec("UPDATE tracks SET capacity=300 WHERE name='Digital Marketing'");
});
test("program roles enforce functional coach and approval boundaries", async () => {
  current = { id: "staff-support-coach", email: "staff-support-coach@example.invalid" };
  assert.match(
    (await programPost("post_program_outcome", {
      student_id: "S10001",
      type: "Freelancing",
      title: "Unauthorized support-coach outcome",
      status: "Reported",
      follow_up_at: "2027-03-01T00:00:00Z",
    })).error,
    /Outcome Coach/,
  );
  assert.match(
    (await programPost("screen_application", {
      application_id: "APP-FLOW",
      decision: "Eligible",
      criteria: ["Identity and registration record checked"],
      reason: "Unauthorized screening",
    })).error,
    /role/,
  );
  current = { id: "staff-coach", email: "staff-coach@example.invalid" };
  await programCheck("post_program_outcome", {
    student_id: "S10001",
    type: "Freelancing",
    title: "Outcome-coach follow-up",
    status: "Reported",
    follow_up_at: "2027-03-01T00:00:00Z",
  });
  current = { id: "quality-login", email: "staff-quality@example.invalid" };
  assert.match(
    (await programPost("bulk_tasks", {
      student_ids: ["S10002"],
      title: "Unauthorized batch",
      owner: "staff-sara",
      due: "2027-01-15T10:00:00Z",
      reason: "Unauthorized",
    })).error,
    /role/,
  );
  current = { id: "owner", email: "owner@example.com" };
});
test("second evidence rejection routes through L3 and closes correction work", async () => {
  const created = new Date().toISOString();
  for (const [id, key, hash] of [
    ["L3-DELIVERY-1", "l3-delivery-1", "l3hash1"],
    ["L3-PAYMENT-1", "l3-payment-1", "l3hash2"],
    ["L3-DELIVERY-2", "l3-delivery-2", "l3hash3"],
    ["L3-PAYMENT-2", "l3-payment-2", "l3hash4"],
  ]) {
    await dbExec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)", 
      id, "S10002", key, `${id}.png`, "image/png", 120, hash, "owner", created,
    );
  }
  await dbExec("INSERT INTO gigs(id,student_id,platform,title,value,currency,status,due,created_at) VALUES(?,?,?,?,?,?,?,?,?)", 
    "GIG-L3", "S10002", "Upwork", "L3 recovery test", 15, "USD", "Paid", "2027-01-01T00:00:00Z", created,
  );
  await dbExec("INSERT INTO evidence(id,student_id,gig_id,proof_id,source,status,rejections,code,requirements,recorder,stage_at,created_at,policy_id) VALUES(?,?,?,?,?, 'Quality Review',1,'EV01','First correction','owner',?,?,?)", 
    "EV-L3", "S10002", "GIG-L3", "L3-DELIVERY-1", "Platform", created, created, "R5-v1",
  );
  await dbExec("INSERT INTO evidence_packages VALUES(?,?,?,?,?,?)", "EPK-L3-1", "EV-L3", 1, "Submitted", "owner", created);
  await dbExec("INSERT INTO evidence_package_items VALUES(?,?,?,?,?)", "EPI-L3-1", "EPK-L3-1", "Delivery", "L3-DELIVERY-1", created);
  await dbExec("INSERT INTO evidence_package_items VALUES(?,?,?,?,?)", "EPI-L3-2", "EPK-L3-1", "Payment", "L3-PAYMENT-1", created);
  current = { id: "quality-login", email: "staff-quality@example.invalid" };
  await check("review", { id: "EV-L3", decision: "Reject", code: "EV07", notes: "Second rejection requires L3 review" });
  current = { id: "owner", email: "owner@example.com" };
  await check("review", {
    id: "EV-L3",
    proof_id: "L3-DELIVERY-2",
    payment_proof_id: "L3-PAYMENT-2",
    notes: "Corrected evidence package resubmitted",
  });
  assert.equal((await dbRow("SELECT status FROM evidence WHERE id='EV-L3'")).status, "L3 Review");
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  await check("review", { id: "EV-L3", decision: "Final resolution", notes: "Final non-qualifying resolution recorded" });
  assert.equal((await dbRow("SELECT status FROM evidence WHERE id='EV-L3'")).status, "Closed L3");
  assert.ok((await dbRow("SELECT id FROM cases WHERE source='L3-EV-L3'")));
  current = { id: "owner", email: "owner@example.com" };
});
test("database allocation guard protects stale concurrent eligibility", async () => {
  const now = new Date().toISOString();
  await assert.rejects(dbExec("INSERT INTO account_assignments VALUES(?,?,?,?,?,?)", "ASN-late", "ACC-102", "S10002", "G101", "REQ2", now),
    /eligibility/,
  );
});
test("policy versions require separate approval and apply to new groups", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await check("policy", {
    id: "P2",
    name: "Round 5 test policy",
    config: { contactDays: 3, failedAttempts: 3, failedWindowDays: 7 },
    reason: "Test configurable thresholds",
  });
  await check("policy_edit", {
    id: "P2",
    config: { contactDays: 2, failedAttempts: 3, failedWindowDays: 7 },
    reason: "Tighten contact cadence",
  });
  await check("policy_transition", {
    id: "P2",
    status: "Reviewed",
    reason: "Reviewed the change",
  });
  assert.match(
    (
      await post("policy_transition", {
        id: "P2",
        status: "Approved",
        reason: "Self approval",
      })
    ).error,
    /different/,
  );
  await check("staff", {
    name: "Independent approver",
    email: "approver@example.com",
    roles: ["Project Operations"],
    reason: "Independent policy approver",
  });
  current = { id: "approver", email: "approver@example.com" };
  await check("policy_transition", {
    id: "P2",
    status: "Approved",
    reason: "Independently approved",
  });
  await check("policy_transition", {
    id: "P2",
    status: "Effective",
    reason: "Effective for new groups",
  });
  current = { id: "owner", email: "owner@example.com" };
  assert.match(
    (
      await post("policy_edit", {
        id: "P2",
        config: { contactDays: 1 },
        reason: "Try changing effective policy",
      })
    ).error,
    /draft/,
  );
  await programCheck("track", {
    id: "TRK-DESIGN",
    name: "Design",
    provider: "Career180",
    capacity: 100,
    reason: "Approved track setup for the new group",
  });
  await check("group", {
    id: "GNEW",
    name: "New policy group",
    track: "Design",
    provider: "Career180",
    coordinator: "staff-sara",
    supervisor: "staff-nour",
    coach: "staff-coach",
    pathway: "Outcome",
    start_date: "2026-09-01",
    policy_id: "P2",
  });
  assert.equal(
    (await dbRow("SELECT policy_id FROM groups WHERE id='GNEW'"))
      .policy_id,
    "P2",
  );
  assert.equal(
    (await dbRow("SELECT policy_id FROM groups WHERE id='G101'"))
      .policy_id,
    "R5-v1",
  );
});
test("policy checks create recovery and supervisor actions without duplicates", async () => {
  current = { id: "owner", email: "owner@example.com" };
  let first = await check("policy_check");
  assert.ok(first.summary.processed > 0);
  let runs = 1;
  while (first.summary.remaining > 0) {
    assert.ok(runs++ < 30, "Policy batches must converge");
    first = await check("policy_check");
  }
  const n = (await dbRow("SELECT count(*) n FROM tasks WHERE source LIKE 'policy-%'")).n;
  const c = (await dbRow("SELECT count(*) n FROM cases WHERE source LIKE 'policy-critical:%'")).n;
  assert.ok(c > 0);
  const second = await check("policy_check");
  assert.equal(second.summary.processed, 0);
  assert.equal(
    (await dbRow("SELECT count(*) n FROM tasks WHERE source LIKE 'policy-%'")).n,
    n,
  );
  assert.equal(
    (await dbRow("SELECT count(*) n FROM cases WHERE source LIKE 'policy-critical:%'")).n,
    c,
  );
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  assert.match((await post("policy_check")).error, /role/);
});
test("controlled platforms and separately approved FX applications are enforced", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await assert.rejects(dbExec("INSERT INTO accounts(id,platform,label,status,credits) VALUES('BAD-PLATFORM','Fiverr','Invalid','Available',10)"),
    /platform/,
  );
  await dbExec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)", 
      "PROOF-FX",
      "S10003",
      "key-fx",
      "fx.png",
      "image/png",
      100,
      "hash-fx",
      "owner",
      new Date().toISOString(),
    );
  await check("gig", {
    id: "GIG-FX",
    student_id: "S10003",
    platform: "Fiverr",
    title: "Converted service",
    value: 300,
    currency: "EGP",
    order_ref: "fx-order-1",
    due: "2027-01-01T00:00:00Z",
  });
  for (const status of ["Gig Opened", "Work Submitted", "Delivered", "Paid"])
    await check("gig_transition", {
      id: "GIG-FX",
      status,
      proof_id: "PROOF-FX",
      occurred_at: new Date().toISOString(),
    });
  await dbExec("INSERT INTO evidence(id,student_id,gig_id,proof_id,source,status,rejections,recorder,stage_at,created_at,policy_id) VALUES(?,?,?,?,?,'Accepted',0,?,?,?,?)", 
      "EV-FX",
      "S10003",
      "GIG-FX",
      "PROOF-FX",
      "Platform",
      "quality-login",
      new Date().toISOString(),
      new Date().toISOString(),
      "R5-v1",
    );
  await check("fx_rate", {
    id: "FX-EGP-1",
    currency: "EGP",
    usd_rate: 0.02,
    effective_date: "2026-01-01",
    source: "Approved finance bulletin",
  });
  assert.match(
    (await post("fx_rate_approve", { id: "FX-EGP-1", reason: "Self approval" }))
      .error,
    /different/,
  );
  current = { id: "approver", email: "approver@example.com" };
  await check("fx_rate_approve", {
    id: "FX-EGP-1",
    reason: "Checked against the approved finance bulletin",
  });
  await check("fx_apply", { gig_id: "GIG-FX", fx_rate_id: "FX-EGP-1" });
  assert.equal(
    (await dbRow("SELECT usd_value FROM gig_fx_applications WHERE gig_id='GIG-FX'")).usd_value,
    6,
  );
  assert.equal(
    (await dbRow(`SELECT result FROM graduation_ledger WHERE student_id='S10003' ORDER BY ${ROWID} DESC LIMIT 1`)).result,
    "1/3",
  );
  await assert.rejects(dbExec("UPDATE fx_rates SET usd_rate=1 WHERE id='FX-EGP-1'"),
    /immutable/,
  );
});
async function route(name) {
  const output = join(testDirectory, "route-" + name + ".mjs");
  await build({
    entryPoints: ["app/api/" + name + "/route.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    plugins: [
      supabaseAuthMock,
      {
        name: "test-bindings",
        setup(b) {
          b.onResolve(
            { filter: /^(cloudflare:workers|next\/headers)$/ },
            (a) => ({ path: a.path, namespace: "mock" }),
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents:
              a.path === "cloudflare:workers"
                ? "export const env=globalThis.__testEnv"
                : "export const headers=async()=>globalThis.__testHeaders()",
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(pathToFileURL(output).href);
}
test("student service resubmissions preserve completion and QC errors return JSON", async () => {
  const servicesApi = await route("student-services");
  const student = (await dbRow("SELECT id,email FROM students WHERE id='S10903'"));
  current = { id: student.id, email: student.email };
  const call = (body) => servicesApi.POST(new Request("https://test.local/api/student-services", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  const links = (await dbRows("SELECT url FROM service_links WHERE student_id=? ORDER BY slot", student.id));
  const response = await call({ action: "submit_services", services: links.map((link) => link.url) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.submission.status, "Complete");
  assert.ok(result.submission.qc_completed_at);
  const denied = await call({ action: "qc_review", service_id: "missing", decision: "Lock" });
  assert.equal(denied.status, 400);
  assert.ok((await denied.json()).error);
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  const missing = await call({ action: "qc_review", service_id: "missing", decision: "Lock" });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /not found/);
  current = { id: "owner", email: "owner@example.com" };
});
test("student service records are identity-isolated and QC review is single-decision per revision", async () => {
  const servicesApi = await route("student-services");
  const first = (await dbRow("SELECT id,email FROM students WHERE id='S10902'"));
  const second = (await dbRow("SELECT id,email FROM students WHERE id='S10903'"));
  current = { id: first.id, email: first.email };
  const firstView = await (await servicesApi.GET()).json();
  assert.equal(firstView.student.id, first.id);
  for (const link of firstView.services) {
    if (!link.id) continue;
    assert.equal((await dbRow("SELECT student_id FROM service_links WHERE id=?", link.id)).student_id, first.id);
  }
  current = { id: second.id, email: second.email };
  const secondView = await (await servicesApi.GET()).json();
  assert.equal(secondView.student.id, second.id);
  assert.notDeepEqual(firstView.services.map((link) => link.id), secondView.services.map((link) => link.id));
  const pending = (await dbRow("SELECT * FROM service_links WHERE student_id='S10902' AND qc_status='Pending' LIMIT 1"));
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  const request = () => servicesApi.POST(new Request("https://test.local/api/student-services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "qc_review", service_id: pending.id, decision: "Needs Correction", comment: "Submit the direct active service page." }) }));
  const reviewed = await request();
  assert.equal(reviewed.status, 200, await reviewed.clone().text());
  const duplicate = await request();
  assert.equal(duplicate.status, 400);
  assert.match((await duplicate.json()).error, /already|UNIQUE/i);
  assert.equal((await dbRow("SELECT count(*) n FROM service_link_reviews WHERE service_link_id=? AND revision=?", pending.id,pending.revision)).n,1);
  current = { id: "owner", email: "owner@example.com" };
});
test("service QC and student identity lookups use their production indexes", async () => {
  if (onPostgres) {
    const queueIndexes = await dbRows("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='service_links'");
    assert.match(queueIndexes.map((r) => r.indexname).join(" "), /idx_service_links_qc_status/);
    const emailIndexes = await dbRows("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='students'");
    assert.match(emailIndexes.map((r) => r.indexname).join(" "), /student_email_identity/);
    return;
  }
  const queuePlan = (await dbRows("EXPLAIN QUERY PLAN SELECT id FROM service_links WHERE qc_status=? ORDER BY updated_at", "Pending"));
  assert.match(queuePlan.map((row) => row.detail).join(" "), /idx_service_links_qc_status/);
  const emailPlan = (await dbRows("EXPLAIN QUERY PLAN SELECT id FROM students WHERE email IS NOT NULL AND trim(email)<>'' AND lower(email)=?", "student@example.com"));
  assert.match(emailPlan.map((row) => row.detail).join(" "), /student_email_identity/);
});
test("signed automation rejects tampering and replays without duplicate execution", async () => {
  const { createHash, createHmac } = await import("node:crypto");
  globalThis.__testEnv.AUTOMATION_HMAC_SECRET =
    "test-only-secret-0000000000000000000000";
  globalThis.__testEnv.AUTOMATION_ACTOR_EMAIL = "owner@example.com";
  const api = await route("automation");
  async function call(body, event = "machine-test-0001", old = false) {
    const timestamp = String(Date.now() - (old ? 600000 : 0));
    const signature = createHmac(
      "sha256",
      globalThis.__testEnv.AUTOMATION_HMAC_SECRET,
    )
      .update(
        timestamp +
          "\n" +
          event +
          "\n" +
          createHash("sha256").update(body).digest("hex"),
      )
      .digest("hex");
    return api.POST(
      new Request("https://test.local/api/automation", {
        method: "POST",
        headers: {
          "x-depi-timestamp": timestamp,
          "x-depi-event-id": event,
          "x-depi-signature": signature,
        },
        body,
      }),
    );
  }
  const body = JSON.stringify({ action: "weekly_report" });
  let r = await (await call(body)).json();
  assert.equal(r.ok, true);
  r = await (await call(body)).json();
  assert.equal(r.replayed, true);
  r = await (await call(JSON.stringify({ action: "policy_check" }))).json();
  assert.match(r.error, /different contents/);
  r = await (await call(body, "machine-expired-1", true)).json();
  assert.match(r.error, /expired/);
});
test("notifications are recipient-scoped and preserve read state", async () => {
  const api = await route("notifications");
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  let result = await (await api.GET()).json();
  assert.ok(result.notifications.length > 0);
  const n = result.notifications[0];
  await api.POST(
    new Request("https://test.local/api/notifications", {
      method: "POST",
      body: JSON.stringify({ id: n.id }),
    }),
  );
  result = await (await api.GET()).json();
  assert.ok(result.notifications.find((x) => x.id === n.id).read_at);
  current = { id: "other", email: "staff-omar@example.invalid" };
  result = await (await api.GET()).json();
  assert.ok(!result.notifications.some((x) => x.id === n.id));
});
test("global search is bounded to the signed-in staff scope", async () => {
  const api = await route("search");
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  let result = await (
    await api.GET(new Request("https://test.local/api/search?q=S10001"))
  ).json();
  assert.ok(
    result.results.some((x) => x.type === "student" && x.id === "S10001"),
  );
  current = { id: "other", email: "staff-omar@example.invalid" };
  result = await (
    await api.GET(new Request("https://test.local/api/search?q=S10001"))
  ).json();
  assert.ok(
    !result.results.some((x) => x.type === "student" && x.id === "S10001"),
  );
  current = { id: "owner", email: "owner@example.com" };
  result = await (
    await api.GET(new Request("https://test.local/api/search?q=MIN-R5-FLOW"))
  ).json();
  assert.ok(result.results.some((x) => x.type === "application" && x.id === "APP-FLOW"));
  result = await (
    await api.GET(new Request("https://test.local/api/search?q=CERT-R5-FLOW"))
  ).json();
  assert.ok(result.results.some((x) => x.type === "certificate" && x.id === "CERT-FLOW"));
});
test("retention policy records approved periods without deleting data", async () => {
  const api = await route("retention");
  current = { id: "owner", email: "owner@example.com" };
  const before = (await dbRow("SELECT count(*) n FROM attachments")).n;
  let result = await (
    await api.POST(
      new Request("https://test.local/api/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "attachments",
          retention_action: "archive",
          days: 365,
          authority: "Approved test policy",
          reason: "Exercise controlled retention configuration",
        }),
      }),
    )
  ).json();
  assert.equal(result.ok, true);
  result = await (await api.GET()).json();
  assert.ok(
    result.configurations.some((x) => x.key === "retention:attachments"),
  );
  assert.equal(
    (await dbRow("SELECT count(*) n FROM attachments")).n,
    before,
  );
});
test("vault access is role restricted and never logs returned credentials", async () => {
  const api = await route("credentials");
  const call = (x) =>
    api.POST(
      new Request("https://test.local/api/credentials", {
        method: "POST",
        body: JSON.stringify(x),
      }),
    );
  // A coach has no business with marketplace logins, whatever group they are on.
  current = { id: "staff-coach", email: "staff-coach@example.invalid" };
  let result = await (
    await call({
      action: "reveal",
      account_id: "ACC-102",
      purpose: "Resolve the assigned client task",
    })
  ).json();
  assert.match(result.error, /not used by a group you are responsible for|role/);
  // Storing a credential is a custodian act, not a coordinator one.
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  result = await (
    await call({
      action: "set_credential",
      account_id: "ACC-102",
      purpose: "Record the marketplace login",
      username: "depi.kafeel@example.invalid",
      password: "stored-secret-never-log",
    })
  ).json();
  assert.match(result.error, /role/);
  current = { id: "owner", email: "owner@example.com" };
  await call({
    action: "set_reference",
    account_id: "ACC-102",
    purpose: "Connect the approved account vault",
    reference: "depi/test-account",
  });
  globalThis.__testEnv.VAULT_URL = "https://vault.example.invalid/secrets";
  globalThis.__testEnv.VAULT_TOKEN = "test-token";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ username: "test-user", password: "test-secret-never-log" });
  try {
    result = await (
      await call({
        action: "reveal",
        account_id: "ACC-102",
        purpose: "Resolve the assigned client task",
      })
    ).json();
    assert.equal(result.password, "test-secret-never-log");
    assert.equal(
      (await dbRow("SELECT count(*) n FROM audit_events WHERE value LIKE '%test-secret-never-log%'")).n,
      0,
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  // The workspace can also hold the credential itself, encrypted. That path
  // takes precedence over the vault and is what a coordinator uses day to day.
  globalThis.__testEnv.CREDENTIAL_ENCRYPTION_KEY = "a".repeat(64);
  result = await (
    await call({
      action: "set_credential",
      account_id: "ACC-102",
      purpose: "Record the marketplace login",
      username: "depi.kafeel@example.invalid",
      password: "stored-secret-never-log",
    })
  ).json();
  assert.equal(result.ok, true);
  const rawRow = await dbRow("SELECT username,secret FROM account_secrets WHERE account_id='ACC-102'");
  assert.ok(!JSON.stringify(rawRow).includes("stored-secret-never-log"), "the stored row must be encrypted");
  assert.ok(!JSON.stringify(rawRow).includes("depi.kafeel@example.invalid"));

  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  result = await (
    await call({
      action: "reveal",
      account_id: "ACC-102",
      purpose: "Hand the login to the assigned student",
    })
  ).json();
  assert.equal(result.password, "stored-secret-never-log", "a coordinator responsible for the group may reveal it: " + JSON.stringify(result));
  assert.equal(result.username, "depi.kafeel@example.invalid");
  assert.equal(
    (await dbRow("SELECT count(*) n FROM audit_events WHERE value LIKE '%stored-secret-never-log%'")).n,
    0,
    "the credential must never reach the audit log",
  );
  assert.ok(
    Number((await dbRow("SELECT count(*) n FROM audit_events WHERE action='Credential access granted'")).n) >= 1,
    "every reveal is recorded",
  );
  current = { id: "owner", email: "owner@example.com" };
});
test("encrypted database and evidence backup restores to a fresh isolated directory", async () => {
  const { createHash } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");
  const bytes = new TextEncoder().encode(
    "synthetic evidence bytes for restore test",
  );
  await dbExec("UPDATE attachments SET size=?,hash=?", bytes.length, createHash("sha256").update(bytes).digest("hex"));
  globalThis.__testEnv.BUCKET.get = async () => ({
    body: new Response(bytes).body,
  });
  globalThis.__testEnv.BACKUP_ENCRYPTION_KEY = "11".repeat(32);
  current = { id: "owner", email: "owner@example.com" };
  const api = await route("backup");
  const response = await api.POST(
    new Request("https://test.local/api/backup", { method: "POST" }),
  );
  assert.equal(response.status, 200);
  const archive = new Uint8Array(await response.arrayBuffer());
  assert.ok(archive.length > 1000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "depi-restore-"));
  const zip = path.join(folder, "backup.zip"),
    out = path.join(folder, "restored");
  fs.writeFileSync(zip, archive);
  const log = execFileSync(
    process.execPath,
    ["scripts/restore/restore-backup.mjs", zip, out],
    {
      env: {
        ...process.env,
        BACKUP_ENCRYPTION_KEY: globalThis.__testEnv.BACKUP_ENCRYPTION_KEY,
      },
      encoding: "utf8",
    },
  );
  assert.match(log, /Restore verified/);
  const restored = new DatabaseSync(path.join(out, "database.sqlite"));
  assert.equal(
    restored.prepare("SELECT count(*) n FROM students").get().n,
    1001,
  );
  assert.equal(restored.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(
    restored.prepare("SELECT count(*) n FROM service_links").get().n,
    (await dbRow("SELECT count(*) n FROM service_links")).n,
  );
  assert.equal(
    restored.prepare("SELECT count(*) n FROM service_link_reviews").get().n,
    (await dbRow("SELECT count(*) n FROM service_link_reviews")).n,
  );
  assert.throws(
    () => restored.exec("UPDATE audit_events SET action='tamper'"),
    /immutable/,
  );
  restored.close();
  assert.deepEqual(
    fs.readFileSync(path.join(out, "evidence", "PROOF-1")),
    Buffer.from(bytes),
  );
});
test("migration script loads a full export into Supabase PostgreSQL and reconciles", async () => {
  const { backupTables } = await import("../lib/domain/backup.ts");
  const tables = {};
  for (const table of backupTables) tables[table] = await dbRows(`SELECT * FROM ${table}`);
  const exportPath = join(testDirectory, "export.json");
  fs.writeFileSync(exportPath, JSON.stringify({ format: "depi-backup-v1", created_at: new Date().toISOString(), tables }));
  const reportPath = join(testDirectory, "migration-report.json");
  const target = await startPostgresTestDatabase();
  try {
    const { spawnSync } = await import("node:child_process");
    const run = (extra) =>
      spawnSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/migrate-d1-to-supabase.mjs", "--json", exportPath, "--database", target.url, "--skip-evidence", "--report", reportPath, ...extra],
        { encoding: "utf8" },
      );
    const dry = run(["--dry-run"]);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.equal((await target.db.prepare("SELECT count(*) n FROM students").first()).n, 0, "dry run must not commit");
    const real = run([]);
    assert.equal(real.status, 0, real.stdout + real.stderr);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.ok(report.ok);
    assert.ok(Object.values(report.tables).every((entry) => entry.match));
    assert.equal((await target.db.prepare("SELECT count(*) n FROM students").first()).n, tables.students.length);
    assert.equal((await target.db.prepare("SELECT count(*) n FROM audit_events").first()).n, tables.audit_events.length);
    const again = run([]);
    assert.notEqual(again.status, 0, "a second run against a populated project must refuse");
  } finally {
    await target.stop();
  }
});
