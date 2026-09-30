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
const importGet = async (query) => {
  const response = await importApi.GET(new Request("https://test.local/api/import?" + query));
  return await response.json();
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
  // The recorder owns the action, whatever name the form sent.
  const someoneElse = (await dbRow("SELECT id FROM users WHERE id<>'owner' AND active=1")).id;
  await check("task", { student_id: "S10001", title: "Owned by the recorder", owner: someoneElse, due: "2027-01-01T00:00:00Z", request_id: "task-owner" });
  assert.equal((await dbRow("SELECT owner FROM tasks WHERE title='Owned by the recorder'")).owner, "owner");
  assert.equal((await dbRow("SELECT owner FROM tasks WHERE title='Next contact'")).owner, "owner");
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
  // Whoever recorded the gig reviews none of it; a quality reviewer cannot
  // take the first check.
  r = await post("review", { id: "EV1", notes: "Looks complete" });
  assert.match(r.error, /You recorded this gig/);
  current = { id: "quality-login", email: "staff-quality@example.invalid" };
  r = await post("review", { id: "EV1", notes: "Looks complete" });
  assert.ok(r.error, "a quality reviewer does not take the first check");
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  await check("review", { id: "EV1", notes: "Coach confirms delivery" });
  // The coach who took the first check cannot take the second.
  r = await post("review", { id: "EV1", notes: "Completeness checked" });
  assert.ok(r.error, "one person, one step");
  current = { id: "supervisor-login", email: "staff-nour@example.invalid" };
  await check("review", { id: "EV1", notes: "Completeness checked" });
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  r = await post("review", { id: "EV1", decision: "Accept", notes: "Approve" });
  assert.ok(r.error, "a coach cannot take the quality stage");
  current = opsOnly;
  // Quality members see only the students whose services they were assigned,
  // so the evidence chain's quality stage is taken by the team leader here.
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
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
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
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
test("Depi Industry groups and their students are hidden from everyone", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const g = await dbRow("SELECT * FROM groups WHERE id='G101'");
  await dbExec(
    "INSERT INTO groups(id,name,track,provider,coordinator,supervisor,coach,pathway,delivery_model,start_date,status,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    "IND-HIDDEN", "IND-HIDDEN", g.track, g.provider, g.coordinator, g.supervisor, g.coach, g.pathway, "Industry", g.start_date, "Closed", g.policy_id,
  );
  const s = await dbRow("SELECT * FROM students LIMIT 1");
  await dbExec("UPDATE students SET group_id='IND-HIDDEN' WHERE id=?", s.id);
  try {
    const data = await (await api.GET()).json();
    assert.ok(data.groups.length > 0);
    assert.ok(!data.groups.some((x) => x.id === "IND-HIDDEN"), "the group is not listed");
    assert.ok(!data.students.some((x) => x.id === s.id), "nor are its students");
  } finally {
    await dbExec("UPDATE students SET group_id=? WHERE id=?", s.group_id, s.id);
    await dbExec("DELETE FROM groups WHERE id='IND-HIDDEN'");
  }
});
test("a coordinator schedules their own group's session and the group's coach confirms it", async () => {
  const group = await dbRow("SELECT g.id,u.id uid,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND g.id NOT IN (SELECT group_id FROM sessions WHERE week=7) LIMIT 1");
  const other = await dbRow("SELECT id FROM groups WHERE status='Active' AND coordinator<>? LIMIT 1", group.uid);
  current = { id: group.uid, email: group.email };
  const slot = { title: "Week 7 coaching", starts_at: new Date(Date.now() + 120 * 86400000).toISOString(), week: 7, duration_minutes: 180 };
  assert.match((await post("session", { ...slot, id: "SES-COORD-OTHER", group_id: other.id })).error, /only for your own groups/);
  await check("session", { ...slot, id: "SES-COORD-1", group_id: group.id });
  const created = await dbRow("SELECT * FROM sessions WHERE id='SES-COORD-1'");
  assert.equal(created.coach_id, null, "the coach can be named later");
  const kase = await dbRow("SELECT * FROM cases WHERE source='session-SES-COORD-1'");
  assert.equal(kase.owner, group.uid, "the case belongs to whoever scheduled it");
  assert.equal(kase.type, "Session");
  // Another coordinator does not see this group's session case.
  const outsider = await dbRow("SELECT id,email FROM users WHERE roles LIKE '%Operations Coordinator%' AND id<>?", group.uid);
  current = { id: outsider.id, email: outsider.email };
  const theirs = await (await api.GET()).json();
  if (!theirs.groups.some((g) => g.id === group.id))
    assert.ok(!theirs.cases.some((c) => c.source === "session-SES-COORD-1"), "a session case stays with its group");
  current = { id: group.uid, email: group.email };
  await check("session_confirm", { id: "SES-COORD-1" });
  await dbExec(
    "INSERT INTO group_coaches(id,group_id,user_id,coach_type,status,onboarding_status,assigned_by,assigned_at) VALUES(?,?,?,?,?,?,?,?)",
    "GC-COORD-1", group.id, "staff-support-coach", "Outcome Coach", "Active", "Pending", "owner", new Date().toISOString(),
  );
  current = { id: "support-coach-login", email: "staff-support-coach@example.invalid" };
  await check("session_confirm", { id: "SES-COORD-1" });
  const done = await dbRow("SELECT * FROM sessions WHERE id='SES-COORD-1'");
  assert.equal(done.status, "Confirmed");
  assert.equal(done.coach_id, "staff-support-coach", "the confirming coach is attached");
  await dbExec("DELETE FROM group_coaches WHERE id='GC-COORD-1'");
  current = { id: "owner", email: "owner@example.com" };
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
    title: "Coaching session 1",
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
    id: "SES-BAD-WEEK",
    group_id: "G101",
    coach_id: "staff-support-coach",
    title: "Week outside policy",
    starts_at: new Date(Date.now() + 94 * 86400000).toISOString(),
    week: 9,
    duration_minutes: 180,
  });
  assert.match(r.error, /weeks 1–8/);
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
  // Scheduling opened a case that follows the session until both confirm.
  const sessionCase = () => dbRow("SELECT * FROM cases WHERE source='session-SES-RULE-1'");
  assert.equal((await sessionCase()).status, "Open");
  assert.equal((await sessionCase()).group_id, "G101");
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  await check("session_confirm", { id: "SES-RULE-1" });
  let confirmed = await dbRow("SELECT * FROM sessions WHERE id='SES-RULE-1'");
  assert.ok(confirmed.coach_confirmed_at);
  assert.equal(confirmed.status, "Scheduled", "the coach alone does not confirm a session");
  assert.equal(confirmed.confirmed_at, null);
  assert.equal((await sessionCase()).status, "In Progress");
  assert.match((await post("session_confirm", { id: "SES-RULE-1" })).error, /already confirmed/);
  const coordinatorOf = async (groupId) =>
    (await dbRow("SELECT u.id,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.id=?", groupId));
  const otherCoordinator = await dbRow(
    "SELECT u.id,u.email FROM users u WHERE u.roles LIKE '%Operations Coordinator%' AND u.id<>(SELECT coordinator FROM groups WHERE id='G101')",
  );
  current = { id: otherCoordinator.id, email: otherCoordinator.email };
  assert.match((await post("session_confirm", { id: "SES-RULE-1" })).error, /coordinator or the session's coach/);
  current = await coordinatorOf("G101");
  await check("session_confirm", { id: "SES-RULE-1" });
  confirmed = await dbRow("SELECT * FROM sessions WHERE id='SES-RULE-1'");
  assert.equal(confirmed.status, "Confirmed", "confirmed once the coordinator and the coach both have");
  assert.ok(confirmed.confirmed_at && confirmed.coordinator_confirmed_at);
  assert.equal((await sessionCase()).status, "Resolved");
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
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
  const moved = (await dbRow("SELECT * FROM sessions WHERE id='SES-RULE-1'"));
  assert.equal(moved.status, "Scheduled");
  assert.equal(moved.confirmed_at, null);
  assert.equal(moved.coach_confirmed_at, null, "a new time needs both confirmations again");
  assert.equal(moved.coordinator_confirmed_at, null);
  assert.equal((await sessionCase()).status, "Open", "and the case reopens");
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
  assert.equal((await sessionCase()).status, "Closed");
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
  current = await coordinatorOf("G103");
  await check("session_confirm", { id: "SES-RULE-COMPLETE" });
  current = {
    id: "support-coach-login",
    email: "staff-support-coach@example.invalid",
  };
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
test("update-mode spreadsheets merge partial columns into existing records under the workflow rules", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM rate_limits");
  const inG101 = await dbRow("SELECT id, email FROM students WHERE group_id='G101' ORDER BY id LIMIT 1");
  const inG102 = await dbRow("SELECT id, email FROM students WHERE group_id='G102' ORDER BY id LIMIT 1");
  const other = await dbRow("SELECT id FROM students WHERE group_id='G103' ORDER BY id LIMIT 1");
  const untouched = await dbRow("SELECT id, name FROM students WHERE group_id='G104' ORDER BY id LIMIT 1");
  const fifth = await dbRow("SELECT id FROM students WHERE group_id='G105' ORDER BY id LIMIT 1");

  // Preview: matched by id and by email, governed fields refused, duplicates caught.
  const preview = await importPost({
    module: "students",
    mode: "update",
    rows: [
      { id: inG101.id, phone: "01000000001", national_id: "29901011234567", name_ar: "طالب", lifecycle: "", risk: "High" },
      { email: inG102.email.toUpperCase(), job_profile: "Frontend developer", group_id: "G101" },
      { id: other.id, national_id: "29901011234567" },
      { id: inG101.id, phone: "01000000001" },
      { id: "S-NOBODY", phone: "0100" },
      { id: untouched.id, name: untouched.name, phone: "" },
      { id: fifth.id, national_id: "1234" },
    ],
  });
  assert.equal(preview.mode, "update");
  assert.deepEqual(preview.ignored, ["risk"], "derived and foreign columns are ignored and reported");
  assert.equal(preview.rows[0].status, "Ready");
  assert.deepEqual(
    preview.rows[0].changes.map((c) => c.field).sort(),
    ["name_ar", "national_id", "phone"],
    "empty cells are not changes",
  );
  assert.equal(preview.rows[1].status, "Rejected");
  assert.match(preview.rows[1].errors[0].error, /Transfer action/, "group moves stay with the transfer workflow");
  assert.equal(preview.rows[2].status, "Rejected");
  assert.match(preview.rows[2].errors[0].error, /Already used/, "uniqueness is checked inside the batch");
  assert.equal(preview.rows[3].status, "Rejected");
  assert.match(preview.rows[3].errors[0].error, /appears twice/);
  assert.equal(preview.rows[4].status, "Rejected");
  assert.match(preview.rows[4].errors[0].error, /No existing record/);
  assert.equal(preview.rows[5].status, "Unchanged");
  assert.equal(preview.rows[6].status, "Rejected");
  assert.match(preview.rows[6].errors[0].error, /14 digits/);

  // Commit applies only the ready rows, audits each change and replays safely.
  const batch = "update-batch-" + Date.now();
  const rows = [
    { id: inG101.id, phone: "01000000001", national_id: "29901011234567", name_ar: "طالب" },
    { email: inG102.email, job_profile: "Frontend developer" },
    { id: untouched.id, name: untouched.name, phone: "" },
    { id: "S-NOBODY", phone: "0100" },
  ];
  const committed = await importPost({ module: "students", mode: "update", rows, confirm: true, batch_id: batch });
  assert.equal(committed.updated, 2);
  assert.equal(committed.skipped, 1);
  assert.equal(committed.rejected, 1);
  const after = await dbRow("SELECT phone, national_id, name_ar, lifecycle FROM students WHERE id=?", inG101.id);
  assert.equal(after.phone, "01000000001");
  assert.equal(after.national_id, "29901011234567");
  assert.equal(after.name_ar, "طالب");
  assert.equal(after.lifecycle, "Active");
  assert.equal((await dbRow("SELECT job_profile FROM students WHERE id=?", inG102.id)).job_profile, "Frontend developer");
  const audit = await dbRow(
    "SELECT value, previous FROM audit_events WHERE action='Spreadsheet update' AND entity_id=? ORDER BY created_at DESC LIMIT 1",
    inG101.id,
  );
  assert.equal(JSON.parse(audit.value).phone, "01000000001");
  assert.ok("phone" in JSON.parse(audit.previous));
  const replay = await importPost({ module: "students", mode: "update", rows, confirm: true, batch_id: batch });
  assert.equal(replay.updated, 2, "a replayed batch returns the recorded summary without applying again");
  assert.equal((await dbRow("SELECT count(*) n FROM import_rows WHERE import_id=?", batch)).n, 4);

  // Coordinators work on records in place: spreadsheets are for the leaders,
  // the supervisors and the administrators.
  current = { id: "coordinator-login", email: "staff-sara@example.invalid" };
  const byCoordinator = await importPost({ module: "students", mode: "update", rows: [{ id: inG101.id, phone: "01000000002" }] });
  assert.match(byCoordinator.error, /limited to leaders, supervisors and administrators/);

  // A supervisor may only touch students in the groups they supervise.
  await dbExec("UPDATE groups SET supervisor='staff-omar' WHERE id='G102'");
  current = { id: "supervisor-login", email: "staff-nour@example.invalid" };
  const scoped = await importPost({
    module: "students",
    mode: "update",
    rows: [
      { id: inG101.id, phone: "01000000002" },
      { id: inG102.id, phone: "01000000003" },
    ],
  });
  await dbExec("UPDATE groups SET supervisor='staff-nour' WHERE id='G102'");
  assert.equal(scoped.rows[0].status, "Ready");
  assert.equal(scoped.rows[1].status, "Rejected");
  assert.match(scoped.rows[1].errors[0].error, /outside your scope/);
  const groupsBySupervisor = await importPost({ module: "groups", mode: "update", rows: [{ id: "G101", name: "Renamed" }] });
  assert.match(groupsBySupervisor.error, /not permitted/, "group data is Project Operations work");

  // Groups: staff references must be active staff IDs; status stays with its actions.
  current = { id: "ops-only-login", email: "ops-only@example.com" };
  const groups = await importPost({
    module: "groups",
    mode: "update",
    rows: [
      { id: "G101", coordinator: "staff-omar@example.invalid", account_manager: "Nour El Din", start_date: "2026-10-01" },
      { id: "G102", coordinator: "Nobody Known" },
      { id: "G103", status: "Closed" },
      { id: "G104", pathway: "Elsewhere" },
    ],
  });
  assert.deepEqual(
    groups.rows[0].changes.map((c) => [c.field, c.to, c.stored]).sort(),
    [
      ["account_manager", "Nour El Din", "staff-nour"],
      ["coordinator", "staff-omar@example.invalid", "staff-omar"],
      ["start_date", "2026-10-01", "2026-10-01"],
    ],
    "an email or a name is shown as written and stored as the reference",
  );
  assert.equal(groups.rows[0].status, "Ready");
  assert.equal(groups.rows[0].changes.length, 3);
  assert.equal(groups.rows[1].status, "Rejected");
  assert.match(groups.rows[1].errors[0].error, /Not an active member of staff/);
  assert.equal(groups.rows[2].status, "Rejected");
  assert.match(groups.rows[2].errors[0].error, /close, gate and archive/);
  assert.equal(groups.rows[3].status, "Rejected");
  assert.match(groups.rows[3].errors[0].error, /Outcome or Support/);
  const groupBatch = "update-groups-" + Date.now();
  const groupCommit = await importPost({
    module: "groups",
    mode: "update",
    rows: [{ id: "G101", coordinator: "staff-omar@example.invalid", account_manager: "Nour El Din", start_date: "2026-10-01" }],
    confirm: true,
    batch_id: groupBatch,
  });
  assert.equal(groupCommit.updated, 1);
  const g = await dbRow("SELECT coordinator, account_manager, start_date FROM groups WHERE id='G101'");
  assert.equal(g.coordinator, "staff-omar");
  assert.equal(g.account_manager, "staff-nour");
  assert.equal(String(g.start_date).slice(0, 10), "2026-10-01");

  // Accounts: credits become numbers; status is an audited decision elsewhere.
  const accounts = await importPost({
    module: "accounts",
    mode: "update",
    rows: [
      { id: "ACC-101", credits: "75", label: "Renamed workspace" },
      { id: "ACC-102", status: "Blocked" },
      { id: "ACC-103", platform: "Fiverr" },
    ],
    confirm: true,
    batch_id: "update-accounts-" + Date.now(),
  });
  assert.equal(accounts.updated, 1);
  assert.equal(accounts.rejected, 2);
  assert.equal(Number((await dbRow("SELECT credits FROM accounts WHERE id='ACC-101'")).credits), 75);
  assert.equal((await dbRow("SELECT label FROM accounts WHERE id='ACC-101'")).label, "Renamed workspace");

  // Modules without update support and roles without the right are refused.
  const unsupported = await importPost({ module: "contacts", mode: "update", rows: [{ student_id: inG101.id }] });
  assert.match(unsupported.error, /students, groups and accounts/);
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  const coach = await importPost({ module: "students", mode: "update", rows: [{ id: inG101.id, phone: "0" }] });
  assert.match(coach.error, /limited to leaders, supervisors and administrators/);
  current = { id: "owner", email: "owner@example.com" };
});

test("a quality reviewer sees and decides only the work assigned to them", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM rate_limits");
  const member = await dbRow("SELECT id, email FROM users WHERE id='staff-quality'");
  const lead = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  const created = new Date().toISOString();

  // A service that nobody holds yet: the member may not take it themselves.
  const student = await dbRow("SELECT id FROM students WHERE group_id='G120' ORDER BY id LIMIT 1");
  await dbExec(
    "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,account_id,submitted_at,updated_at) VALUES(?,?,1,?,?,'Khamsat','Needs Review','{}',?,'Pending',NULL,NULL,NULL,1,NULL,?,?)",
    "SLK-UNASSIGNED", student.id, "https://khamsat.com/x/9001-a", "https://khamsat.com/x/9001-a", created, created, created,
  );
  current = { id: member.id, email: member.email };
  assert.match((await post("service_qc_review", { service_id: "SLK-UNASSIGNED", decision: "Lock" })).error, /not been assigned to you/);
  let view = await (await api.GET()).json();
  assert.ok(!view.students.some((s) => s.id === student.id), "an unassigned student is not in the reviewer's view");

  // The Quality Lead assigns the student; now the member sees and decides it.
  current = lead;
  await check("service_qc_assign", { student_id: student.id, reviewer_id: member.id, request_id: "quality-hand-over-1" });
  current = { id: member.id, email: member.email };
  view = await (await api.GET()).json();
  assert.ok(view.students.some((s) => s.id === student.id), "the assigned student appears");
  await check("service_qc_review", { service_id: "SLK-UNASSIGNED", decision: "Lock" });

  // Gig evidence works the same way, even for a student whose services sit elsewhere.
  current = { id: "owner", email: "owner@example.com" };
  const other = await dbRow("SELECT id FROM students WHERE group_id='G121' ORDER BY id LIMIT 1");
  await dbExec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)", "QA-PROOF-1", other.id, "qa-proof-1", "qa.png", "image/png", 120, "qahash1", "owner", created);
  await dbExec("INSERT INTO gigs(id,student_id,platform,title,value,currency,status,due,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "GIG-QA", other.id, "Upwork", "Assignment test", 15, "USD", "Paid", "2027-01-01T00:00:00Z", created);
  await dbExec("INSERT INTO evidence(id,student_id,gig_id,proof_id,source,status,rejections,code,requirements,recorder,stage_at,created_at,policy_id) VALUES(?,?,?,?,?, 'Quality Review',0,NULL,NULL,'owner',?,?,?)",
    "EV-QA", other.id, "GIG-QA", "QA-PROOF-1", "Platform", created, created, "R5-v1");
  current = { id: member.id, email: member.email };
  assert.match((await post("review", { id: "EV-QA", decision: "Escalate L3", notes: "Needs a second look" })).error, /not found within your assigned scope/);
  current = lead;
  await check("evidence_qc_assign", { item_id: "EV-QA", reviewer_id: member.id, request_id: "quality-hand-over-2" });
  current = { id: member.id, email: member.email };
  view = await (await api.GET()).json();
  assert.ok(view.students.some((s) => s.id === other.id), "a student whose evidence is assigned appears");
  await check("review", { id: "EV-QA", decision: "Escalate L3", notes: "Needs a second look" });
  assert.equal((await dbRow("SELECT status FROM evidence WHERE id='EV-QA'")).status, "L3 Review");

  // Evidence of the same student, assigned to someone else, stays out of reach.
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("INSERT INTO gigs(id,student_id,platform,title,value,currency,status,due,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "GIG-QA2", other.id, "Upwork", "Held by another reviewer", 15, "USD", "Paid", "2027-01-01T00:00:00Z", created);
  await dbExec("INSERT INTO evidence(id,student_id,gig_id,proof_id,source,status,rejections,code,requirements,recorder,stage_at,created_at,policy_id,qc_actor) VALUES(?,?,?,?,?, 'Quality Review',0,NULL,NULL,'owner',?,?,?,?)",
    "EV-QA2", other.id, "GIG-QA2", "QA-PROOF-1", "Platform", created, created, "R5-v1", lead.id);
  current = { id: member.id, email: member.email };
  assert.match((await post("review", { id: "EV-QA2", decision: "Escalate L3", notes: "x" })).error, /assigned to another reviewer/);
  current = { id: "owner", email: "owner@example.com" };
});

test("Program flow and its downloads are for the leaders and administrators", async () => {
  await dbExec("DELETE FROM rate_limits");
  const view = () => programApi.GET(new Request("https://test.local/api/program"));
  const download = () => programApi.GET(new Request("https://test.local/api/program?format=csv&dataset=lifecycle"));
  // Coordinators, quality reviewers and supervisors do not reach the programme view at all.
  for (const who of [
    { id: "coordinator-login", email: "staff-sara@example.invalid" },
    { id: "quality-login", email: "staff-quality@example.invalid" },
    { id: "supervisor-login", email: "staff-nour@example.invalid" },
  ]) {
    current = who;
    assert.match((await (await view()).json()).error, /role/, who.email + " sees Program flow");
    assert.match((await (await download()).json()).error, /role/, who.email + " downloads from Program flow");
  }
  // A leader does, and may download it.
  current = { id: "coach-ops-login", email: "staff-coach-ops@example.invalid" };
  assert.equal((await view()).status, 200);
  const allowed = await download();
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers.get("content-type") || "", /csv/);
  current = { id: "owner", email: "owner@example.com" };
});
test("only administrators create groups and record the weekly gate", async () => {
  await dbExec("DELETE FROM rate_limits");
  const ops = await dbRow("SELECT id, email FROM users WHERE email='ops-only@example.com'");
  current = { id: ops.id, email: ops.email };
  assert.match((await post("group", { id: "G-NEW", name: "New group", track: "Web Development", provider: "YAT" })).error, /role/);
  assert.match((await post("group_gate", { group_id: "G101", week: 1, check_key: "Current statuses recorded", status: "Pass" })).error, /role/);
  current = { id: "supervisor-login", email: "staff-nour@example.invalid" };
  assert.match((await post("group_gate", { group_id: "G101", week: 1, check_key: "Current statuses recorded", status: "Pass" })).error, /role/);
  current = { id: "owner", email: "owner@example.com" };
});

test("a supervisor adds no students, sessions or groups", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "supervisor-login", email: "staff-nour@example.invalid" };
  assert.match((await post("student", { id: "S-SUP", name: "Supervisor Added", group_id: "G101", email: "sup-added@example.invalid" })).error, /role/);
  assert.match((await post("session", { group_id: "G101", title: "Session", starts_at: "2027-01-07T17:00:00Z", week: 1 })).error, /role/);
  const session = await dbRow("SELECT id FROM sessions WHERE status IN ('Scheduled','Confirmed') LIMIT 1");
  if (session) {
    assert.match((await post("session_reschedule", { id: session.id, starts_at: "2027-01-08T17:00:00Z", reason: "Supervisor move" })).error, /role/);
    assert.match((await post("session_cancel", { id: session.id, reason: "Supervisor cancel" })).error, /role/);
  }
  assert.match((await post("group", { id: "G-SUP", name: "Supervisor group", track: "Web Development", provider: "YAT" })).error, /role/);
  current = { id: "owner", email: "owner@example.com" };
});

test("coaches and backup coaches are assigned by Coach Operations, who assign no coordinators", async () => {
  await dbExec("DELETE FROM rate_limits");
  const coach = { group_id: "G101", user_id: "staff-support-coach", coach_type: "Support Coach", checklist: [] };
  // Project Operations no longer matches coaches, neither directly nor in bulk.
  current = { id: "ops-only-login", email: "ops-only@example.com" };
  assert.match((await programPost("assign_coach", coach)).error, /role/);
  assert.match((await programPost("bulk_group_owner", { group_ids: ["G101"], owner_type: "Coach", owner: "staff-coach", reason: "Cover" })).error, /role/);
  // Coach Operations does, for a main coach and a backup (Support) coach.
  current = { id: "coach-ops-login", email: "staff-coach-ops@example.invalid" };
  const assigned = await programPost("assign_coach", coach);
  assert.equal(assigned.error, undefined, assigned.error);
  // But hands no group to a coordinator.
  assert.match((await programPost("bulk_group_owner", { group_ids: ["G101"], owner_type: "Coordinator", owner: "staff-omar", reason: "Swap" })).error, /role/);
  current = { id: "owner", email: "owner@example.com" };
});

test("a sheet from another source links on the national ID through a saved mapping", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM rate_limits");
  const NID = "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0642\u0648\u0645\u064a";
  const [one, two, three] = await dbRows(
    "SELECT id, email FROM students WHERE group_id='G101' ORDER BY id LIMIT 3",
  );
  // The roster carries no national IDs yet, so they are set the way an export
  // is edited and sent back: matched on the record reference.
  const seeded = await importPost({
    module: "students",
    mode: "update",
    rows: [
      { id: one.id, national_id: "29911260104731" },
      { id: two.id, national_id: "30105120102345" },
    ],
    confirm: true,
    batch_id: "seed-national-ids",
  });
  assert.equal(seeded.updated, 2);

  // The ministry sheet: Arabic headings, an ID damaged by Excel, one for a
  // student nobody has registered, and a column this workspace has no field for.
  const sheet = [
    { [NID]: "2.9911260104731E+13", "\u0627\u0644\u0627\u0633\u0645": "Updated Name", "\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0628\u0627\u064a\u0644": "01000000111", "\u0645\u0644\u0627\u062d\u0638\u0627\u062a": "ignore" },
    { [NID]: "\u0663\u0660\u0661\u0660\u0665\u0661\u0662\u0660\u0661\u0660\u0662\u0663\u0664\u0665", "\u0627\u0644\u0627\u0633\u0645": "", "\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0628\u0627\u064a\u0644": "01000000222", "\u0645\u0644\u0627\u062d\u0638\u0627\u062a": "" },
    { [NID]: "29900000000000", "\u0627\u0644\u0627\u0633\u0645": "Unknown Person", "\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0628\u0627\u064a\u0644": "0100", "\u0645\u0644\u0627\u062d\u0638\u0627\u062a": "" },
    { [NID]: "123", "\u0627\u0644\u0627\u0633\u0645": "Broken Key", "\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0628\u0627\u064a\u0644": "", "\u0645\u0644\u0627\u062d\u0638\u0627\u062a": "" },
  ];
  const mapping = { [NID]: "national_id", "\u0627\u0644\u0627\u0633\u0645": "name", "\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0628\u0627\u064a\u0644": "phone" };
  const preview = await importPost({
    module: "students",
    mode: "update",
    rows: sheet,
    mapping,
    key_field: "national_id",
  });
  assert.equal(preview.key_field, "national_id");
  assert.deepEqual(preview.ignored, ["\u0645\u0644\u0627\u062d\u0638\u0627\u062a"], "an unmapped column is reported, not rejected");
  assert.equal(preview.rows[0].status, "Ready");
  assert.equal(preview.rows[0].id, one.id, "Excel's scientific notation still finds the student");
  assert.deepEqual(preview.rows[0].changes.map((c) => c.field).sort(), ["name", "phone"]);
  assert.equal(preview.rows[1].status, "Ready");
  assert.equal(preview.rows[1].id, two.id, "Arabic-Indic digits still find the student");
  assert.deepEqual(preview.rows[1].changes.map((c) => c.field), ["phone"], "the empty name cell changes nothing");
  assert.equal(preview.rows[2].status, "Rejected");
  assert.match(preview.rows[2].errors[0].error, /No student has this national ID/);
  assert.equal(preview.rows[3].status, "Rejected");
  assert.match(preview.rows[3].errors[0].error, /14 digits/);

  const applied = await importPost({
    module: "students",
    mode: "update",
    rows: sheet,
    mapping,
    key_field: "national_id",
    confirm: true,
    batch_id: "ministry-sheet-1",
  });
  assert.equal(applied.updated, 2);
  assert.equal(applied.rejected, 2);
  assert.equal((await dbRow("SELECT name, phone FROM students WHERE id=?", one.id)).phone, "01000000111");
  assert.equal((await dbRow("SELECT name FROM students WHERE id=?", one.id)).name, "Updated Name");
  assert.equal((await dbRow("SELECT phone FROM students WHERE id=?", two.id)).phone, "01000000222");
  assert.equal((await dbRow("SELECT national_id FROM students WHERE id=?", three.id)).national_id, null, "an untouched student is untouched");

  // The same sheet arrives every month, so the mapping is kept by source name.
  const saved = await importPost({
    action: "save_mapping",
    module: "students",
    name: "Ministry monthly list",
    key_field: "national_id",
    mapping,
  });
  assert.equal(saved.ok, true);
  const listed = await importGet("module=students");
  assert.equal(listed.mappings.length, 1);
  assert.equal(listed.mappings[0].name, "Ministry monthly list");
  assert.equal(listed.mappings[0].key_field, "national_id");
  assert.deepEqual(listed.mappings[0].mapping, mapping);
  assert.ok(listed.fields.includes("phone"), "the fields a sheet may fill come back with it");
  const renamed = await importPost({
    action: "save_mapping",
    module: "students",
    name: "Ministry monthly list",
    key_field: "national_id",
    mapping: { ...mapping, "\u0645\u0644\u0627\u062d\u0638\u0627\u062a": "job_profile" },
  });
  assert.equal(renamed.ok, true);
  assert.equal((await importGet("module=students")).mappings.length, 1, "saving again replaces the mapping");
  assert.match(
    (await importPost({ action: "save_mapping", module: "students", name: "Bad", mapping: { A: "made_up" } })).error,
    /not a field/,
  );
  assert.equal((await importPost({ action: "delete_mapping", module: "students", name: "Ministry monthly list" })).removed, "Ministry monthly list");
  assert.equal((await importGet("module=students")).mappings.length, 0);

  // Mapping mistakes are refused before anything is written.
  assert.match(
    (await importPost({ module: "students", mode: "update", rows: sheet, mapping: { [NID]: "national_id", "\u0627\u0644\u0627\u0633\u0645": "national_id" } })).error,
    /same field/,
  );
  assert.match(
    (await importPost({ module: "students", mode: "update", rows: sheet, mapping, key_field: "phone" })).error,
    /cannot be matched/,
  );
});

test("a student's services go to one quality reviewer, spread evenly, and the leader can move them", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM rate_limits");
  const servicesApi = await route("student-services");
  const submit = (services) =>
    servicesApi.POST(
      new Request("https://test.local/api/student-services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit_services", services }),
      }),
    );

  // A team of four reviewers under one leader: the seeded Quality Member plus
  // three more. The leader hands work out and carries none of it.
  for (const [name, email] of [
    ["Sagda Saad", "sagda.test@example.org"],
    ["Dunia Hekal", "dunia.test@example.org"],
    ["Marwa Hammam", "marwa.test@example.org"],
  ])
    await check("staff", { name, email, roles: ["Quality Member"], reason: "Round 5 quality team" });
  const pool = (
    await dbRows(
      "SELECT id FROM users WHERE active=1 AND roles LIKE '%Quality Member%' AND roles NOT LIKE '%Quality Lead%' ORDER BY id",
    )
  ).map((r) => r.id);
  assert.equal(pool.length, 4);

  const students = await dbRows("SELECT id, email FROM students WHERE group_id='G110' ORDER BY id LIMIT 4");
  assert.equal(students.length, 4);
  const ids = students.map((s) => s.id);
  const list = ids.map(() => "?").join(",");
  for (const [index, student] of students.entries()) {
    current = { id: student.id, email: student.email };
    const response = await submit(
      [1, 2, 3].map((slot) => `https://khamsat.com/marketing/social-media/${8100 + index * 10 + slot}-service-${slot}`),
    );
    assert.equal(response.status, 200, await response.clone().text());
  }
  current = { id: "owner", email: "owner@example.com" };

  // Each student is one piece of work: three links, one reviewer, never the leader.
  const perStudent = await dbRows(
    `SELECT student_id, count(*) links, count(DISTINCT qc_actor) reviewers, min(qc_actor) actor
       FROM service_links WHERE student_id IN (${list}) GROUP BY student_id`,
    ...ids,
  );
  assert.equal(perStudent.length, 4);
  for (const row of perStudent) {
    assert.equal(Number(row.links), 3, "three services");
    assert.equal(Number(row.reviewers), 1, "one reviewer holds all three");
    assert.ok(pool.includes(row.actor), `${row.actor} is on the team`);
  }

  // Evenly: nobody holds two more open students than anybody else.
  const loads = await Promise.all(
    pool.map(async (id) =>
      Number(
        (await dbRow("SELECT count(DISTINCT student_id) n FROM service_links WHERE qc_actor=? AND qc_status<>'Locked'", id)).n,
      ),
    ),
  );
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 1, `load spread ${JSON.stringify(loads)}`);

  // The reviewer who holds the student decides; another member cannot.
  const subject = perStudent[0];
  const holder = await dbRow("SELECT id, email FROM users WHERE id=?", subject.actor);
  const other = await dbRow("SELECT id, email FROM users WHERE id=? ", pool.find((id) => id !== subject.actor));
  const firstLink = await dbRow(
    "SELECT id, slot FROM service_links WHERE student_id=? AND qc_status='Pending' ORDER BY slot LIMIT 1",
    subject.student_id,
  );
  current = { id: other.id, email: other.email };
  assert.match(
    (await post("service_qc_review", { service_id: firstLink.id, decision: "Lock" })).error,
    /assigned to another reviewer/,
  );
  current = { id: holder.id, email: holder.email };
  await check("service_qc_review", {
    service_id: firstLink.id,
    decision: "Needs Correction",
    comment: "Send the direct public service page.",
    request_id: "quality-correction-1",
  });
  assert.equal((await dbRow("SELECT qc_status FROM service_links WHERE id=?", firstLink.id)).qc_status, "Needs Correction");

  // A resubmission goes back to the reviewer who asked for the correction.
  const student = students.find((s) => s.id === subject.student_id);
  current = { id: student.id, email: student.email };
  const again = await submit(
    [1, 2, 3].map((slot) =>
      slot === Number(firstLink.slot)
        ? "https://kafiil.com/service/8199-corrected-service"
        : `https://khamsat.com/marketing/social-media/${8100 + slot}-service-${slot}`,
    ),
  );
  assert.equal(again.status, 200, await again.clone().text());
  current = { id: "owner", email: "owner@example.com" };
  const returned = await dbRows(
    "SELECT DISTINCT qc_actor FROM service_links WHERE student_id=? AND qc_status<>'Locked'",
    subject.student_id,
  );
  assert.deepEqual(returned.map((r) => r.qc_actor), [subject.actor], "the same reviewer keeps the student");

  // The leader moves a student; the member cannot.
  current = { id: holder.id, email: holder.email };
  assert.match(
    (await post("service_qc_assign", { student_id: subject.student_id, reviewer_id: other.id })).error,
    /role/,
  );
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  await check("service_qc_assign", {
    student_id: subject.student_id,
    reviewer_id: other.id,
    request_id: "quality-reassign-1",
  });
  const moved = await dbRows(
    "SELECT DISTINCT qc_actor FROM service_links WHERE student_id=? AND qc_status<>'Locked'",
    subject.student_id,
  );
  assert.deepEqual(moved.map((r) => r.qc_actor), [other.id], "every open service moves with the student");
  assert.match(
    (await post("service_qc_assign", { student_id: subject.student_id, reviewer_id: "staff-quality-lead" })).error,
    /active Quality reviewer/,
    "the leader is not in the pool",
  );

  // An unheld student is picked up by the leader's even distribution.
  const orphan = ids.find((id) => id !== subject.student_id);
  await dbExec("UPDATE service_links SET qc_actor=NULL WHERE student_id=?", orphan);
  await check("service_qc_assign", { request_id: "quality-distribute-1" });
  const adopted = await dbRows(
    "SELECT DISTINCT qc_actor FROM service_links WHERE student_id=? AND qc_status<>'Locked'",
    orphan,
  );
  assert.equal(adopted.length, 1);
  assert.ok(pool.includes(adopted[0].qc_actor));
  assert.match((await post("service_qc_assign", {})).error, /already has a reviewer/);

  // A reviewer's workspace is the students they hold and nothing else.
  current = { id: holder.id, email: holder.email };
  const holderResponse = await api.GET();
  const holderView = await holderResponse.json();
  assert.equal(holderResponse.status, 200, "reviewer workspace: " + JSON.stringify(holderView).slice(0, 300));
  const mine = await dbRows(
    "SELECT DISTINCT student_id FROM service_links WHERE qc_actor=? AND qc_status<>'Locked'",
    holder.id,
  );
  assert.ok(holderView.students.length > 0, "the reviewer sees their own students");
  assert.equal(
    holderView.students.length,
    mine.length,
    "and only those: one row per student they were assigned",
  );
  assert.deepEqual(
    holderView.students.map((s) => s.id).sort(),
    mine.map((r) => r.student_id).sort(),
  );
  assert.ok(
    holderView.serviceLinks.every((l) => l.qc_actor === holder.id),
    "the queue they load is their own",
  );
  assert.ok(
    holderView.groups.every((g) => holderView.students.some((s) => s.group_id === g.id)),
    "the groups they see are the ones those students are in",
  );
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  const leadView = await (await api.GET()).json();
  assert.ok(leadView.students.length > holderView.students.length, "the leader still sees the whole programme");

  // A link the automatic gate failed can only go back for correction: there is
  // no override, for the reviewer or the leader.
  const failing = await dbRow(
    "SELECT id FROM service_links WHERE student_id=? AND qc_status='Pending' ORDER BY slot DESC LIMIT 1",
    orphan,
  );
  await dbExec("UPDATE service_links SET auto_status='Failed' WHERE id=?", failing.id);
  const holder2 = await dbRow("SELECT id, email FROM users WHERE id=?", adopted[0].qc_actor);
  current = { id: holder2.id, email: holder2.email };
  assert.match(
    (await post("service_qc_review", { service_id: failing.id, decision: "Lock" })).error,
    /automatic check failed/,
  );
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  assert.match(
    (await post("service_qc_review", { service_id: failing.id, decision: "Lock" })).error,
    /automatic check failed/,
    "not even the leader can lock a failed link",
  );
  await check("service_qc_review", {
    service_id: failing.id,
    decision: "Needs Correction",
    comment: "Publish the service page, then submit the direct link.",
    request_id: "quality-failed-correction-1",
  });
  current = { id: "owner", email: "owner@example.com" };
});

test("a staff sheet grants and withdraws access, and groups are handed over by email or name", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM rate_limits");
  const sheet = [
    { name: "Mona Fathy", email: "Mona.Fathy@example.org", roles: "Operations Coordinator", national_id: "29811181400282", phone: "01027958791", reason: "Round 5 intake" },
    { name: "Hany Adel", email: "hany.adel@example.org", roles: "Team Supervisor, Coach Operations", national_id: "2.9909302301864E+13", phone: "01284098001" },
    { name: "Broken Roles", email: "broken@example.org", roles: "Chief Wizard" },
    { name: "No Email", email: "not-an-email", roles: "Coach" },
    { name: "No Roles", email: "noroles@example.org", roles: "" },
    { name: "Twice", email: "mona.fathy@example.org", roles: "Coach" },
    { name: "Bad ID", email: "badid@example.org", roles: "Coach", national_id: "12345" },
  ];
  const preview = await importPost({ module: "staff", rows: sheet });
  assert.equal(preview.rows[0].status, "Ready");
  assert.equal(preview.rows[1].status, "Ready", "several roles in one cell");
  assert.match(preview.rows[2].errors[0].error, /Not a role/);
  assert.match(preview.rows[3].errors[0].error, /valid work email/);
  assert.match(preview.rows[4].errors[0].error, /at least one role/);
  assert.match(preview.rows[5].errors[0].error, /appears twice/);
  assert.match(preview.rows[6].errors[0].error, /14 digits/);

  const applied = await importPost({ module: "staff", rows: sheet, confirm: true, batch_id: "staff-sheet-1" });
  assert.equal(applied.created, 2);
  assert.equal(applied.rejected, 5);
  const mona = await dbRow("SELECT id, name, email, roles, active, national_id, phone FROM users WHERE email='mona.fathy@example.org'");
  // The identifier and the phone number are kept with the record: the ID is
  // what the person signs in with, and the number is how they are reached.
  assert.equal(mona.national_id, "29811181400282");
  assert.equal(mona.phone, "01027958791");
  assert.equal(
    (await dbRow("SELECT national_id FROM users WHERE email='hany.adel@example.org'")).national_id,
    "29909302301864",
    "an ID Excel turned into a float is recovered",
  );
  assert.match(
    (await post("staff", { name: "Clash", email: "clash@example.org", roles: ["Coach"], national_id: "29811181400282", reason: "probe" })).error,
    /already recorded|Another member of staff/,
  );
  assert.ok(mona, "the email is stored in lower case, the way sign-in looks it up");
  assert.equal(mona.active, 1);
  assert.deepEqual(JSON.parse(mona.roles), ["Operations Coordinator"]);
  assert.deepEqual(
    JSON.parse((await dbRow("SELECT roles FROM users WHERE email='hany.adel@example.org'")).roles),
    ["Team Supervisor", "Coach Operations"],
  );

  // The same sheet again changes the roles it carries instead of duplicating.
  await importPost({
    module: "staff",
    rows: [{ name: "Mona Fathy", email: "mona.fathy@example.org", roles: "Operations Coordinator, Team Supervisor", reason: "Took over a second team" }],
    confirm: true,
    batch_id: "staff-sheet-2",
  });

  assert.equal((await dbRow("SELECT count(*) n FROM users WHERE email='mona.fathy@example.org'")).n, 1);
  assert.equal(
    (await dbRow("SELECT national_id FROM users WHERE email='mona.fathy@example.org'")).national_id,
    "29811181400282",
    "a later sheet without the ID column keeps the stored one",
  );
  assert.deepEqual(
    JSON.parse((await dbRow("SELECT roles FROM users WHERE email='mona.fathy@example.org'")).roles),
    ["Operations Coordinator", "Team Supervisor"],
  );

  // A group is handed over by naming the person, not their reference.
  const handover = await importPost({
    module: "groups",
    mode: "update",
    rows: [{ id: "G105", coordinator: "Mona.Fathy@example.org", supervisor: "Hany Adel" }],
    confirm: true,
    batch_id: "handover-1",
  });
  assert.equal(handover.updated, 1);
  const g105 = await dbRow("SELECT coordinator, supervisor FROM groups WHERE id='G105'");
  assert.equal(g105.coordinator, mona.id);
  assert.equal(g105.supervisor, (await dbRow("SELECT id FROM users WHERE email='hany.adel@example.org'")).id);
  // She now owns the group's operational work: her students are in her scope,
  // and the workspace tells her about their submissions. Reviewing published
  // services is the quality team's, so that stays closed to her.
  const inHerGroup = await dbRow("SELECT count(*) n FROM students WHERE group_id='G105'");
  assert.ok(Number(inHerGroup.n) > 0);
  current = { id: mona.id, email: mona.email };
  const scoped = await (await api.GET()).json();
  assert.ok(
    scoped.students.every((s) => s.group_id === "G105"),
    "a coordinator sees their own groups only",
  );
  assert.match(
    (await post("service_qc_review", { service_id: "missing", decision: "Lock" })).error,
    /role/,
    "published services are reviewed by the quality team",
  );

  // Access is withdrawn the same way it was granted, and the workspace keeps
  // at least one administrator and never lets one lock themselves out.
  current = { id: "owner", email: "owner@example.com" };
  // "Withdrawn" is what the directory shows, so it is what the form sends.
  await check("staff", { name: "Hany Adel", email: "hany.adel@example.org", roles: ["Team Supervisor"], active: "Withdrawn", reason: "Left the programme" });
  assert.equal((await dbRow("SELECT active FROM users WHERE email='hany.adel@example.org'")).active, 0);
  const locked = await post("staff", { name: "Owner", email: "owner@example.com", roles: ["Operations Systems / Admin"], active: "Withdrawn", reason: "Trying to remove myself" });
  assert.match(locked.error, /your own access/);
  // Someone else's access can be withdrawn, and the person doing it keeps theirs.
  await check("staff", { name: "Second Admin", email: "second.admin@example.org", roles: ["Operations Systems / Admin"], reason: "Cover during leave" });
  await check("staff", { name: "Second Admin", email: "second.admin@example.org", roles: ["Operations Systems / Admin"], active: "Withdrawn", reason: "Cover ended" });
  assert.equal((await dbRow("SELECT active FROM users WHERE email='second.admin@example.org'")).active, 0);
  assert.equal((await dbRow("SELECT active FROM users WHERE id='owner'")).active, 1);
  // A withdrawn person can no longer be handed a group.
  const refused = await importPost({
    module: "groups",
    mode: "update",
    rows: [{ id: "G106", supervisor: "hany.adel@example.org" }],
  });
  assert.equal(refused.rows[0].status, "Rejected");
  assert.match(refused.rows[0].errors[0].error, /Not an active member of staff/);
  current = { id: "owner", email: "owner@example.com" };
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
  // Coach Operations own the coaching tier: they may hand groups to a coach,
  // and doing so creates the functional assignment a session needs, so the
  // coach is not merely named on the record.
  current = { id: "staff-coach-ops", email: "staff-coach-ops@example.invalid" };
  assert.match(
    (await programPost("bulk_group_owner", { group_ids: ["G103"], owner_type: "Coordinator", owner: "staff-sara", reason: "Not their tier" })).error,
    /role/,
    "coaching operations do not reassign coordinators",
  );
  await programCheck("bulk_group_owner", {
    group_ids: ["G103", "G104"],
    owner_type: "Coach",
    owner: "staff-coach",
    reason: "Coaching cover for the term",
  });
  assert.equal(
    (await dbRow("SELECT count(*) n FROM groups WHERE id IN ('G103','G104') AND coach='staff-coach'")).n,
    2,
  );
  assert.equal(
    (await dbRow(
      "SELECT count(*) n FROM group_coaches WHERE group_id IN ('G103','G104') AND user_id='staff-coach' AND status='Active'",
    )).n,
    2,
    "the functional assignment is created with it",
  );
  assert.match(
    (await programPost("bulk_group_owner", { group_ids: ["G103"], owner_type: "Coach", owner: "staff-sara", reason: "Wrong role" })).error,
    /active Coach/,
  );
  current = { id: "owner", email: "owner@example.com" };

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
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
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
test("a gig is recorded once, paid, with its delivery and payment proof going straight into review", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM rate_limits");
  const created = new Date().toISOString();
  const [mine, theirs] = await dbRows("SELECT id FROM students WHERE group_id='G122' ORDER BY id LIMIT 2");
  for (const [id, student] of [["GIG-DELIVERY", mine.id], ["GIG-PAYMENT", mine.id], ["GIG-OTHER", theirs.id], ["GIG-DELIVERY-2", mine.id], ["GIG-PAYMENT-2", mine.id], ["GIG-DELIVERY-3", mine.id], ["GIG-PAYMENT-3", mine.id]])
    await dbExec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)", id, student, id.toLowerCase(), id + ".png", "image/png", 120, id + "-hash", "owner", created);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const gig = { student_id: mine.id, title: "Logo design", platform: "Khamsat", value: 25, currency: "USD", order_ref: "KH-84211", paid_on: today };

  assert.match((await post("gig", { ...gig, id: "GIG-1" })).error, /Upload the delivery proof and the payment proof/);
  assert.match((await post("gig", { ...gig, id: "GIG-1", proof_id: "GIG-DELIVERY", payment_proof_id: "GIG-DELIVERY" })).error, /separate/);
  assert.ok((await post("gig", { ...gig, id: "GIG-1", proof_id: "GIG-DELIVERY", payment_proof_id: "GIG-OTHER" })).error, "another student's screenshot is refused");

  // When the client paid: required, not in the future, not before the group started.
  const proofs = { proof_id: "GIG-DELIVERY", payment_proof_id: "GIG-PAYMENT" };
  assert.match((await post("gig", { ...gig, ...proofs, id: "GIG-1", paid_on: "" })).error, /date the client paid/);
  assert.match((await post("gig", { ...gig, ...proofs, id: "GIG-1", paid_on: "2999-01-01" })).error, /cannot be in the future/);
  const group = await dbRow("SELECT g.start_date FROM groups g JOIN students s ON s.group_id=g.id WHERE s.id=?", mine.id);
  await dbExec("UPDATE groups SET start_date=? WHERE id=(SELECT group_id FROM students WHERE id=?)", today, mine.id);
  assert.match((await post("gig", { ...gig, ...proofs, id: "GIG-1", paid_on: "2020-01-01" })).error, /on or after the day the group started/);
  await dbExec("UPDATE groups SET start_date=? WHERE id=(SELECT group_id FROM students WHERE id=?)", group.start_date, mine.id);

  await check("gig", { ...gig, ...proofs, id: "GIG-1" });
  assert.equal((await dbRow("SELECT paid_on FROM gigs WHERE id='GIG-1'")).paid_on.slice(0, 10), today);
  assert.equal((await dbRow("SELECT status FROM gigs WHERE id='GIG-1'")).status, "Paid");
  const evidence = await dbRow("SELECT * FROM evidence WHERE gig_id='GIG-1'");
  assert.equal(evidence.status, "Coach Review", "the proof enters review at once");
  assert.equal(evidence.proof_id, "GIG-DELIVERY");
  const items = await dbRows(
    "SELECT i.item_type, i.attachment_id FROM evidence_package_items i JOIN evidence_packages p ON p.id=i.package_id WHERE p.evidence_id=? ORDER BY i.item_type",
    evidence.id,
  );
  assert.deepEqual(items.map((i) => [i.item_type, i.attachment_id]), [["Delivery", "GIG-DELIVERY"], ["Payment", "GIG-PAYMENT"]]);
  assert.equal((await dbRow("SELECT status FROM gig_events WHERE gig_id='GIG-1'")).status, "Paid");

  // A screenshot proves one gig: reusing it, even as a fresh upload of the same image, is refused.
  assert.match((await post("gig", { ...gig, id: "GIG-2", order_ref: "KH-99999", proof_id: "GIG-DELIVERY", payment_proof_id: "GIG-PAYMENT-2" })).error, /already proof for another gig/);
  await dbExec("UPDATE attachments SET hash=(SELECT hash FROM attachments WHERE id='GIG-PAYMENT') WHERE id='GIG-PAYMENT-3'");
  assert.match((await post("gig", { ...gig, id: "GIG-2", order_ref: "KH-99999", proof_id: "GIG-DELIVERY-3", payment_proof_id: "GIG-PAYMENT-3" })).error, /already proof for another gig/);
  // The same order on the same platform is the same gig.
  assert.match((await post("gig", { ...gig, id: "GIG-2", proof_id: "GIG-DELIVERY-2", payment_proof_id: "GIG-PAYMENT-2" })).error, /already recorded/);
  // Its evidence is already in review; a second submission is refused.
  assert.match((await post("evidence", { gig_id: "GIG-1", source: "Form", proof_id: "GIG-DELIVERY", payment_proof_id: "GIG-PAYMENT" })).error, /already has its evidence/);

  // The chain: three different people, the last of them from the QC team.
  const evidenceId = evidence.id;
  current = { id: "coordinator-login", email: "staff-sara@example.invalid" };
  assert.ok((await post("review", { id: evidenceId, notes: "Delivered" })).error, "a coordinator does not take the first check");
  current = { id: "coach-ops-login", email: "staff-coach-ops@example.invalid" };
  await check("review", { id: evidenceId, notes: "Delivery confirmed" });
  assert.match((await post("review", { id: evidenceId, notes: "Complete" })).error, /already acted on an earlier step/);
  current = { id: "supervisor-login", email: "staff-nour@example.invalid" };
  await check("review", { id: evidenceId, notes: "Complete and consistent" });
  const atQuality = await dbRow("SELECT status, qc_actor FROM evidence WHERE id=?", evidenceId);
  assert.equal(atQuality.status, "Quality Review");
  const reviewer = await dbRow("SELECT id, email, roles FROM users WHERE id=?", atQuality.qc_actor);
  assert.ok(reviewer && reviewer.roles.includes("Quality Member") && !reviewer.roles.includes("Quality Lead"), "assigned to a QC member on arrival");
  current = { id: "ops-only-login", email: "ops-only@example.com" };
  assert.match((await post("review", { id: evidenceId, decision: "Accept", notes: "x" })).error, /role/, "the Quality step is the QC team's");
  current = { id: reviewer.id, email: reviewer.email };
  await check("review", {
    id: evidenceId,
    decision: "Accept",
    notes: "All seven checks passed",
    checklist: ["Completeness", "Identity", "Delivery", "Payment/value", "Authenticity", "Source consistency", "Duplicate checks"],
  });
  assert.equal((await dbRow("SELECT status FROM evidence WHERE id=?", evidenceId)).status, "Accepted");
  current = { id: "owner", email: "owner@example.com" };
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
  // A paid non-USD gig already in the workspace; how it was recorded is covered elsewhere.
  await dbExec("INSERT INTO gigs(id,student_id,platform,title,value,currency,order_ref,status,due,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    "GIG-FX", "S10003", "Fiverr", "Converted gig", 300, "EGP", "fx-order-1", "Paid", "2027-01-01T00:00:00Z", new Date().toISOString());
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
  // The student's own coordinator does not review published services.
  const coordinator = await dbRow(
    "SELECT u.id, u.email FROM students s JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=g.coordinator WHERE s.id='S10902'",
  );
  current = { id: coordinator.id, email: coordinator.email };
  const refused = await servicesApi.POST(new Request("https://test.local/api/student-services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "qc_review", service_id: pending.id, decision: "Lock" }) }));
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /role/);
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

test("a supervisor assigns coordinators only within their own team", async () => {
  const base = await dbRow("SELECT * FROM groups WHERE id='G101'");
  await dbExec("INSERT INTO users(id,email,name,roles,scopes,active) VALUES(?,?,?,?,?,?)", "sup-two", "sup-two@example.invalid", "Second Supervisor", JSON.stringify(["Team Supervisor"]), "[]", 1);
  await dbExec("INSERT INTO users(id,email,name,roles,scopes,active) VALUES(?,?,?,?,?,?)", "coord-two", "coord-two@example.invalid", "Other Team Coordinator", JSON.stringify(["Operations Coordinator"]), "[]", 1);
  await dbExec(
    "INSERT INTO groups(id,name,track,provider,coordinator,supervisor,coach,pathway,delivery_model,start_date,status,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    "G-TEAM2", "Other team group", base.track, base.provider, "coord-two", "sup-two", base.coach, base.pathway, "Regular", base.start_date, "Active", base.policy_id,
  );
  const mine = await dbRow("SELECT id,coordinator FROM groups WHERE supervisor='staff-nour' AND status='Active' LIMIT 1");
  current = { id: "supervisor-login", email: "staff-nour@example.invalid" };
  const data = await (await api.GET()).json();
  assert.ok(Array.isArray(data.teamCoordinators), "a supervisor is given their team");
  assert.ok(!data.teamCoordinators.includes("coord-two"), "another supervisor's coordinator is not on it");
  assert.match(
    (await programPost("bulk_group_owner", { group_ids: [mine.id], owner_type: "Coordinator", owner: "coord-two", reason: "Borrow a coordinator" })).error,
    /your own team/,
  );
  assert.match(
    (await programPost("bulk_group_owner", { group_ids: ["G-TEAM2"], owner_type: "Coordinator", owner: "staff-omar", reason: "Take their group" })).error,
    /outside your scope/,
  );
  const teammate = data.teamCoordinators.find((id) => id !== mine.coordinator);
  await programCheck("bulk_group_owner", { group_ids: [mine.id], owner_type: "Coordinator", owner: teammate, reason: "Rebalance inside the team" });
  assert.equal((await dbRow("SELECT coordinator FROM groups WHERE id=?", mine.id)).coordinator, teammate);
  // Project Operations still assigns across teams.
  current = { id: "owner", email: "owner@example.com" };
  assert.equal((await (await api.GET()).json()).teamCoordinators, null);
  // A coordinator adds students only to their own groups.
  current = { id: teammate, email: (await dbRow("SELECT email FROM users WHERE id=?", teammate)).email };
  assert.match((await post("student", { id: "S-TEAM-1", name: "Out of scope", group_id: "G-TEAM2" })).error, /your own groups/);
  current = { id: "owner", email: "owner@example.com" };
  await programCheck("bulk_group_owner", { group_ids: [mine.id], owner_type: "Coordinator", owner: mine.coordinator, reason: "Restore" });
  await dbExec("DELETE FROM groups WHERE id='G-TEAM2'");
});
