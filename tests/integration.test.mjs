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
    notes: "Talked about the first gig",
    request_id: "contact-once",
  };
  // A comment is required; the screenshot is not (10 Oct 2026).
  assert.match((await post("contact", { ...c, notes: "", request_id: "contact-no-comment" })).error, /comment/);
  const noShot = { ...c, proof_id: "", request_id: "contact-no-screenshot" };
  await check("contact", noShot);
  assert.equal((await dbRow("SELECT proof_id FROM contacts WHERE notes=? AND proof_id IS NULL LIMIT 1", "Talked about the first gig")).proof_id, null);
  await check("contact", c);
  await check("contact", c);
  assert.equal(
    (await dbRow("SELECT count(*) n FROM contacts WHERE student_id='S10001'")).n,
    2,
    "the contact without a screenshot, then the one with it, recorded once despite the retry",
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
  // What happens next: the group's coordinator gets a task to place the order.
  const handover = await dbRow("SELECT t.owner,t.status,g.coordinator FROM tasks t JOIN students s ON s.id=t.student_id JOIN groups g ON g.id=s.group_id WHERE t.source='account-assigned:REQ1'");
  assert.ok(handover, "the coordinator gets a task once an account is assigned");
  assert.equal(handover.owner, handover.coordinator);
  assert.equal(handover.status, "Open");
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
  // Whoever recorded the gig reviews none of it; neither a quality reviewer
  // nor a coach takes the coordinator check.
  r = await post("review", { id: "EV1", notes: "Looks complete" });
  assert.match(r.error, /You recorded this gig/);
  current = { id: "quality-login", email: "staff-quality@example.invalid" };
  r = await post("review", { id: "EV1", notes: "Looks complete" });
  assert.ok(r.error, "a quality reviewer does not take the coordinator check");
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  r = await post("review", { id: "EV1", notes: "Coach confirms delivery" });
  assert.ok(r.error, "coaches no longer check services");
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
test("a leader schedules a group's session; its coordinator and coach confirm it", async () => {
  const group = await dbRow("SELECT g.id,u.id uid,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND g.id NOT IN (SELECT group_id FROM sessions WHERE week=7) LIMIT 1");
  const slot = { title: "Week 7 coaching", starts_at: new Date(Date.now() + 120 * 86400000).toISOString(), week: 7, duration_minutes: 180 };
  // The schedule is the leaders': the group's own coordinator may not set or cancel it.
  current = { id: group.uid, email: group.email };
  assert.match((await post("session", { ...slot, id: "SES-COORD-1", group_id: group.id })).error, /role/);
  current = { id: "coach-ops-login", email: "staff-coach-ops@example.invalid" };
  await check("session", { ...slot, id: "SES-COORD-1", group_id: group.id });
  const created = await dbRow("SELECT * FROM sessions WHERE id='SES-COORD-1'");
  assert.equal(created.coach_id, null, "the coach can be named later");
  const kase = await dbRow("SELECT * FROM cases WHERE source='session-SES-COORD-1'");
  assert.equal(kase.owner, "staff-coach-ops", "the case belongs to whoever scheduled it");
  current = { id: group.uid, email: group.email };
  assert.match((await post("session_cancel", { id: "SES-COORD-1", reason: "Coordinator cancel" })).error, /role/);
  assert.equal(kase.type, "Session");
  // Another coordinator does not see this group's session case.
  const outsider = await dbRow("SELECT id,email FROM users WHERE roles LIKE '%Operations Coordinator%' AND id<>?", group.uid);
  current = { id: outsider.id, email: outsider.email };
  const theirs = await (await api.GET()).json();
  if (!theirs.groups.some((g) => g.id === group.id))
    assert.ok(!theirs.cases.some((c) => c.source === "session-SES-COORD-1"), "a session case stays with its group");
  current = { id: group.uid, email: group.email };
  assert.match((await post("session_confirm", { id: "SES-COORD-1" })).error, /48 hours before/, "a session months away cannot be confirmed yet");
  // Confirming opens 48 hours before the session.
  await dbExec("UPDATE sessions SET starts_at=? WHERE id=?", new Date(Date.now() + 24 * 3600000).toISOString(), "SES-COORD-1");
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
  // Confirming opens 48 hours before the session.
  await dbExec("UPDATE sessions SET starts_at=? WHERE id=?", new Date(Date.now() + 24 * 3600000).toISOString(), "SES-RULE-1");
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
  // Only the leaders move a session: not the group's coordinator, not a supervisor.
  for (const who of [
    { id: "coordinator-login", email: "staff-sara@example.invalid" },
    { id: "supervisor-login", email: "staff-nour@example.invalid" },
  ]) {
    current = who;
    r = await post("session_reschedule", { id: "SES-RULE-1", starts_at: rescheduledAt, reason: "Coach availability changed" });
    assert.match(r.error, /role/, who.email + " rescheduled a session");
  }
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
  r = await post("session_attendance", { id: "SES-RULE-1", marks: { S10001: "Present" } });
  assert.match(r.error, /once a session has started/);
  assert.match((await post("attendance", { session_id: "SES-RULE-1", student_id: "S10001", status: "Present" })).error, /not supported/, "the per-student action is gone");
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
  await check("session_attendance", {
    id: "SES-RULE-COMPLETE",
    marks: Object.fromEntries(activeStudents.map((student) => [student.id, "Present"])),
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

test("coordinators, coaches and reviewers know only themselves and the people around their work", async () => {
  await dbExec("DELETE FROM rate_limits");
  const everyone = Number((await dbRow("SELECT count(*) n FROM users")).n);
  const peopleIn = (view) => {
    const ids = new Set([view.user.id]);
    const add = (...v) => v.forEach((x) => x && ids.add(String(x)));
    for (const g of view.groups) add(g.coordinator, g.supervisor, g.coach, g.account_manager);
    for (const c of view.groupCoaches) add(c.user_id);
    for (const t of view.tasks) add(t.owner);
    for (const c of view.cases) add(c.owner);
    for (const c of view.contacts) add(c.owner, c.recorder);
    for (const e of view.evidence) add(e.qc_actor, e.recorder);
    for (const l of view.serviceLinks) add(l.qc_actor);
    for (const r of view.serviceLinkReviews) add(r.reviewed_by);
    for (const x of view.sessions) add(x.coach_id);
    return ids;
  };
  for (const who of [
    { id: "coordinator-login", email: "staff-sara@example.invalid" },
    { id: "coach-login", email: "staff-coach@example.invalid" },
  ]) {
    current = who;
    const view = await (await api.GET()).json();
    const allowed = peopleIn(view);
    assert.ok(view.staff.length < everyone, who.email + " receives the whole staff directory");
    assert.ok(view.staff.every((p) => allowed.has(p.id)), who.email + " sees someone their work does not involve");
    assert.ok(view.staff.some((p) => p.id === view.user.id), "they still see themselves");
    assert.ok(view.staff.every((p) => !("national_id" in p)), "no national IDs");
  }
  // A quality reviewer also knows their leader.
  current = { id: "quality-login", email: "staff-quality@example.invalid" };
  const reviewer = await (await api.GET()).json();
  assert.ok(reviewer.staff.some((p) => p.id === "staff-quality-lead"));
  // A supervisor keeps the directory they hand work out from.
  current = { id: "supervisor-login", email: "staff-nour@example.invalid" };
  const supervisor = await (await api.GET()).json();
  assert.equal(supervisor.staff.length, everyone);
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

// A service link for a slot: 1 is Nafezly, 2 and 3 Kafiil, which together meet
// the three Kafiil or Nafezly links a submission needs.
const slotLink = (slot, id) =>
  slot === 1
    ? `https://nafezly.com/service/${id}-service-${slot}`
    : `https://kafiil.com/service/${id}-service-${slot}`;
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
      [1, 2, 3].map((slot) => slotLink(slot, 8100 + index * 10 + slot)),
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
        ? slotLink(slot, 8199)
        : slotLink(slot, 8100 + slot),
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
  assert.equal(evidence.status, "Coordinator L1", "the proof goes straight to the coordinator check");
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

  // The chain: the coordinator side checks, then the QC team decides.
  const evidenceId = evidence.id;
  current = { id: "coach-ops-login", email: "staff-coach-ops@example.invalid" };
  assert.ok((await post("review", { id: evidenceId, notes: "Delivery confirmed" })).error, "Coach Operations no longer checks services");
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
  // Passwords are saved by the people who keep the accounts, not a coordinator.
  assert.match(result.error, /keep the accounts/);
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
  // The Accounts list shows each password the person may see, beside its email.
  let listed = await (await call({ action: "list" })).json();
  assert.equal(listed.credentials["ACC-102"]?.password, "stored-secret-never-log", "the responsible coordinator sees it in the list");
  current = { id: "staff-coach", email: "staff-coach@example.invalid" };
  assert.match((await (await call({ action: "list" })).json()).error, /does not show account passwords/);
  current = { id: "owner", email: "owner@example.com" };
  listed = await (await call({ action: "list" })).json();
  assert.ok(listed.credentials["ACC-102"], "a keeper sees every password");
  assert.equal(
    (await dbRow("SELECT count(*) n FROM audit_events WHERE value LIKE '%stored-secret-never-log%'")).n,
    0,
    "listing never writes a password to the audit log",
  );

  // The team uploads its own accounts sheet: counted first, then applied, and
  // uploading it again changes nothing.
  const sheetApi = await route("accounts-sheet");
  const upload = async (apply) =>
    (await sheetApi.POST(new Request("https://test.local/api/accounts-sheet", {
      method: "POST",
      body: JSON.stringify({
        apply,
        rows: [
          { sheet: "Accounts", cells: ["Account", "Password", "Coordinator", "Account on", "Active or Not", "Credits", "Pending", "Comments"] },
          { sheet: "Accounts", cells: ["sheet.one@example.invalid", "pass-one-1", "Some Coordinator", "Kafeel ", "Active", "$5.50", "$0.00", ""] },
          { sheet: "Not Active", cells: ["sheet.two@example.invalid", "pass-two-2", "Some Coordinator", "Nafezly", "Not Active", "", "-", "Locked out"] },
          { sheet: "Not Active", cells: ["", "", "", "", "", "", "", ""] },
        ],
      }),
    }))).json();
  let sheet = await upload(false);
  assert.equal(sheet.applied, false);
  assert.equal(sheet.summary.new, 2);
  assert.equal(await dbRow("SELECT id FROM accounts WHERE label='sheet.one@example.invalid'"), null, "a check writes nothing");
  sheet = await upload(true);
  assert.equal(sheet.applied, true);
  const one = await dbRow("SELECT * FROM accounts WHERE label='sheet.one@example.invalid'");
  assert.deepEqual([one.platform, one.status, Number(one.credits)], ["Kafeel", "Available", 5.5]);
  assert.equal((await dbRow("SELECT status FROM accounts WHERE label='sheet.two@example.invalid'")).status, "Access Issue");
  listed = await (await call({ action: "list" })).json();
  assert.equal(listed.credentials[one.id]?.password, "pass-one-1", "the sheet's password is stored, encrypted");
  // Uploads only add: an account already in the app keeps its state, credit and password.
  await dbExec("UPDATE accounts SET credits=9,status='Blocked' WHERE id=?", one.id);
  sheet = await upload(true);
  assert.equal(sheet.summary.new, 0);
  assert.equal(sheet.summary.already_in_app, 2, "uploading the same sheet again changes nothing");
  const kept = await dbRow("SELECT status,credits FROM accounts WHERE id=?", one.id);
  assert.deepEqual([kept.status, Number(kept.credits)], ["Blocked", 9], "an existing account is left as it is");
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  assert.match((await upload(false)).error, /keep the accounts/);
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

test("a client account is requested for any student's gig, three at most", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const learner = await dbRow("SELECT s.id FROM students s JOIN groups g ON g.id=s.group_id WHERE g.pathway='Outcome' AND g.status='Active' AND s.lifecycle='Active' AND s.id NOT IN (SELECT student_id FROM account_requests) LIMIT 1");
  const ask = (n, extra = {}) => post("account_request", { id: `REQ-CLIENT-${n}`, student_id: learner.id, platform: "Khamsat", title: `Logo order ${n}`, value: 20, ...extra });
  assert.match((await ask(0, { platform: "Fiverr" })).error, /marketplace/);
  assert.match((await ask(0, { title: "" })).error, /gig the client account will order/);
  assert.match((await ask(0, { value: 0 })).error, /credit/);
  for (const n of [1, 2, 3]) assert.equal((await ask(n)).error, undefined, "an Outcome-path student without an approved task may ask");
  const saved = await dbRow("SELECT r.task,r.platform,r.value,d.task_bank_id,d.gig_number FROM account_requests r JOIN account_request_details d ON d.request_id=r.id WHERE r.id='REQ-CLIENT-3'");
  assert.equal(saved.task, "Logo order 3");
  assert.equal(Number(saved.value), 20);
  assert.equal(saved.task_bank_id, null);
  assert.equal(saved.gig_number, 3);
  assert.match((await ask(4)).error, /three client-account requests/);
});

test("a student submits at least three Kafiil or Nafezly links together, with other sites optional", async () => {
  await dbExec("DELETE FROM rate_limits");
  const servicesApi = await route("student-services");
  const send = (body) =>
    servicesApi.POST(new Request("https://test.local/api/student-services", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
  const submit = (services) => send({ action: "submit_services", services });
  const kafiil = (id) => `https://kafiil.com/service/${id}-service`;
  const nafezly = (id) => `https://nafezly.com/service/${id}-service`;
  const other = "https://www.behance.net/gallery/7709/brand-work";
  const [first, second] = await dbRows("SELECT id,email FROM students WHERE id NOT IN (SELECT student_id FROM service_links) AND lifecycle='Active' ORDER BY id LIMIT 2");
  current = { id: first.id, email: first.email };
  // Fewer than three Kafiil or Nafezly links is refused, whatever else is added.
  let r = await submit([kafiil(7701), nafezly(7702), other]);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /at least 3 Kafiil or Nafezly/);
  r = await submit([nafezly(7701), kafiil(7702), "https://khamsat.com/design/logo/7703-logo"]);
  assert.match((await r.json()).error, /at least 3 Kafiil or Nafezly/, "Khamsat counts as Other");
  assert.equal((await dbRow("SELECT count(*) n FROM service_links WHERE student_id=?", first.id)).n, 0, "nothing is saved from a refused submission");
  assert.equal((await submit(["x"])).status, 400, "the old one-at-a-time action is gone");
  assert.match((await (await send({ action: "submit_service", url: kafiil(7701) })).json()).error, /Choose a service-link action/);
  // Two Nafezly and one Kafiil, with an optional link elsewhere.
  r = await submit([nafezly(7701), nafezly(7702), kafiil(7703), other]);
  assert.equal(r.status, 200, await r.clone().text());
  let view = await r.json();
  assert.equal(view.services.length, 4);
  assert.equal(view.progress.required, 3);
  assert.equal(view.progress.perCategory.Other, 1);
  assert.equal(view.submission.status, "Pending QC");
  const saved = await dbRows("SELECT slot,platform,account_id FROM service_links WHERE student_id=? ORDER BY slot", first.id);
  assert.deepEqual(saved.map((x) => x.platform), ["Nafezly", "Nafezly", "Kafiil", "External service"]);
  assert.ok(saved.every((x) => x.account_id === null), "a service is the student's own, not a client account's");
  // A link sent back for correction is replaced; the others are sent unchanged and stay as they are.
  await dbExec("UPDATE service_links SET qc_status='Needs Correction',qc_comment='Wrong page' WHERE student_id=? AND slot=2", first.id);
  r = await submit([nafezly(7701), nafezly(7712), kafiil(7703), other]);
  assert.equal(r.status, 200, await r.clone().text());
  const fixed = await dbRows("SELECT slot,revision,qc_status FROM service_links WHERE student_id=? ORDER BY slot", first.id);
  assert.deepEqual(fixed.map((x) => x.revision), [1, 2, 1, 1], "only the corrected link is a new revision");
  assert.equal(fixed[1].qc_status, "Pending", "the corrected link is back with QC as new work");
  const reviewer = (await dbRow("SELECT qc_actor FROM service_links WHERE student_id=? AND slot=2", first.id)).qc_actor;
  assert.ok(reviewer, "and it has a reviewer");
  assert.ok(
    await dbRow("SELECT id FROM notifications WHERE recipient=? AND entity_id=? AND title LIKE 'A student corrected a service link%'", reviewer, first.id),
    "who is told it came back",
  );
  assert.match((await (await submit([nafezly(7799), nafezly(7712), kafiil(7703), other])).json()).error, /awaiting QC/);
  // Another student cannot submit the same listing or the same other link.
  current = { id: second.id, email: second.email };
  assert.match((await (await submit(["https://nafezly.com/service/7701-renamed", kafiil(7721), kafiil(7722)])).json()).error, /already submitted by another student/);
  assert.match((await (await submit([kafiil(7723), kafiil(7724), kafiil(7725), "https://behance.net/gallery/7709/brand-work"])).json()).error, /already submitted by another student/);
  // Three approved Kafiil or Nafezly links complete it; the other link is not needed.
  await dbExec("UPDATE service_links SET qc_status='Locked',qc_at=? WHERE student_id=? AND slot IN (1,3)", new Date().toISOString(), first.id);
  await dbExec("UPDATE service_links SET qc_status='Needs Correction' WHERE student_id=? AND slot=4", first.id);
  const last = await dbRow("SELECT id FROM service_links WHERE student_id=? AND slot=2", first.id);
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  r = await send({ action: "qc_review", service_id: last.id, decision: "Lock", comment: "Verified" });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await dbRow("SELECT status FROM service_submissions WHERE student_id=?", first.id)).status, "Complete");
  current = { id: "owner", email: "owner@example.com" };
});





test("the coordinator and coach answer attending or unavailable, and the leaders hear about an absence", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const group = await dbRow("SELECT g.id,g.supervisor,u.id uid,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND g.id NOT IN (SELECT group_id FROM sessions WHERE week=6) LIMIT 1");
  await check("session", { id: "SES-ANSWER-1", group_id: group.id, title: "Week 6 coaching", starts_at: new Date(Date.now() + 130 * 86400000).toISOString(), week: 6, duration_minutes: 180 });
  await dbExec(
    "INSERT OR IGNORE INTO group_coaches(id,group_id,user_id,coach_type,status,onboarding_status,assigned_by,assigned_at) VALUES(?,?,?,?,?,?,?,?)",
    "GC-ANSWER-1", group.id, "staff-coach", "Outcome Coach", "Active", "Pending", "owner", new Date().toISOString(),
  );
  current = { id: group.uid, email: group.email };
  assert.match((await post("session_unavailable", { id: "SES-ANSWER-1", reason: "" })).error, /why you cannot attend/i);
  await check("session_unavailable", { id: "SES-ANSWER-1", reason: "Ministry visit that day" });
  let row = await dbRow("SELECT * FROM sessions WHERE id='SES-ANSWER-1'");
  assert.equal(row.coordinator_unavailable, "Ministry visit that day");
  assert.equal(row.status, "Scheduled");
  const kase = await dbRow("SELECT * FROM cases WHERE source='session-SES-ANSWER-1'");
  assert.equal(kase.status, "Waiting");
  assert.equal(kase.severity, "S2 High");
  const told = (await dbRows("SELECT recipient,title FROM notifications WHERE entity_id='SES-ANSWER-1'"));
  const recipients = new Set(told.map((n) => n.recipient));
  assert.ok(recipients.has(group.supervisor), "the group's supervisor is told");
  assert.ok(recipients.has("staff-coach-ops"), "Coach Operations is told");
  assert.ok(recipients.has("owner"), "Project Operations is told");
  assert.ok(!recipients.has(group.uid), "not the person who said it");
  assert.match(told[0].title, /cannot attend .* Week 6 .*Ministry visit/);
  // Plans change: the coordinator can attend after all, and the coach confirms.
  // Confirming opens 48 hours before the session.
  await dbExec("UPDATE sessions SET starts_at=? WHERE id=?", new Date(Date.now() + 24 * 3600000).toISOString(), "SES-ANSWER-1");
  await check("session_confirm", { id: "SES-ANSWER-1" });
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  await check("session_confirm", { id: "SES-ANSWER-1" });
  row = await dbRow("SELECT * FROM sessions WHERE id='SES-ANSWER-1'");
  assert.equal(row.coordinator_unavailable, null);
  assert.equal(row.status, "Confirmed");
  // The coach dropping out afterwards reopens it.
  await check("session_unavailable", { id: "SES-ANSWER-1", reason: "Family emergency" });
  row = await dbRow("SELECT * FROM sessions WHERE id='SES-ANSWER-1'");
  assert.equal(row.status, "Scheduled");
  assert.equal(row.coach_confirmed_at, null);
  assert.equal(row.coach_unavailable, "Family emergency");
  // Someone outside the session cannot answer for it.
  current = { id: "support-coach-login", email: "staff-support-coach@example.invalid" };
  assert.match((await post("session_unavailable", { id: "SES-ANSWER-1", reason: "Not my session" })).error, /coordinator or the session's coach/);
  // A reschedule asks both again.
  current = { id: "owner", email: "owner@example.com" };
  await check("session_reschedule", { id: "SES-ANSWER-1", starts_at: new Date(Date.now() + 131 * 86400000).toISOString(), reason: "Coach unavailable that day" });
  row = await dbRow("SELECT * FROM sessions WHERE id='SES-ANSWER-1'");
  assert.equal(row.coach_unavailable, null);
  assert.equal(row.coordinator_confirmed_at, null);
  await dbExec("DELETE FROM group_coaches WHERE id='GC-ANSWER-1'");
});

test("the coordinator's checklist: instructor confirmed before, instructor entered during, attendance taken after", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const group = await dbRow("SELECT g.id,u.id uid,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND g.id NOT IN (SELECT group_id FROM sessions WHERE week=7) LIMIT 1");
  await check("session", { id: "SES-CHECK-1", group_id: group.id, title: "Week 7 coaching", starts_at: new Date(Date.now() + 140 * 86400000).toISOString(), week: 7, duration_minutes: 180, coach_id: "staff-coach" });
  const ticks = async () => (await dbRows("SELECT item FROM session_checks WHERE session_id='SES-CHECK-1' ORDER BY item")).map((r) => r.item);
  current = { id: group.uid, email: group.email };
  assert.match((await post("session_check", { id: "SES-CHECK-1", item: "instructor_confirmed" })).error, /48 hours before/, "nor ticked as the coach confirmed");
  // Confirming opens 48 hours before the session.
  await dbExec("UPDATE sessions SET starts_at=? WHERE id=?", new Date(Date.now() + 24 * 3600000).toISOString(), "SES-CHECK-1");
  await check("session_check", { id: "SES-CHECK-1", item: "instructor_confirmed" });
  await check("session_check", { id: "SES-CHECK-1", item: "instructor_entered" });
  assert.deepEqual(await ticks(), ["instructor_confirmed", "instructor_entered"]);
  await check("session_check", { id: "SES-CHECK-1", item: "instructor_entered", done: false });
  assert.deepEqual(await ticks(), ["instructor_confirmed"]);
  assert.match((await post("session_check", { id: "SES-CHECK-1", item: "attendance_taken" })).error, /filled in by the app/);
  assert.match((await post("session_check", { id: "SES-CHECK-1", item: "trainer_notified" })).error, /Unknown checklist step/, "the old steps are gone");
  // The steps are the coordinator's, not the coach's or another coordinator's.
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  assert.match((await post("session_check", { id: "SES-CHECK-1", item: "instructor_entered" })).error, /group's coordinator/);
  const other = await dbRow("SELECT u.id,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.coordinator<>? LIMIT 1", group.uid);
  if (other) {
    current = { id: other.id, email: other.email };
    assert.ok((await post("session_check", { id: "SES-CHECK-1", item: "instructor_entered" })).error);
  }
  const audit = await dbRow("SELECT action FROM audit_events WHERE action='session_check' LIMIT 1");
  assert.ok(audit, "every tick is audited");
  current = { id: "owner", email: "owner@example.com" };
});

test("confirmations: the checklist tick is the coach's confirmation, leaders answer on behalf, and undo clears it", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const group = await dbRow("SELECT g.id,u.id uid,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND g.id NOT IN (SELECT group_id FROM sessions WHERE week=8) LIMIT 1");
  await check("session", { id: "SES-UNDO-1", group_id: group.id, title: "Week 8 coaching", starts_at: new Date(Date.now() + 150 * 86400000).toISOString(), week: 8, duration_minutes: 180, coach_id: "staff-coach" });
  const row = () => dbRow("SELECT * FROM sessions WHERE id='SES-UNDO-1'");
  // The coordinator ticks "Coach confirmed": the coach is confirmed on the session too.
  current = { id: group.uid, email: group.email };
  // Confirming opens 48 hours before the session.
  await dbExec("UPDATE sessions SET starts_at=? WHERE id=?", new Date(Date.now() + 24 * 3600000).toISOString(), "SES-UNDO-1");
  await check("session_check", { id: "SES-UNDO-1", item: "instructor_confirmed" });
  assert.ok((await row()).coach_confirmed_at, "the tick confirms the coach");
  // Undo clears both, including when the coach had confirmed themselves.
  await check("session_check", { id: "SES-UNDO-1", item: "instructor_confirmed", done: false });
  assert.equal((await row()).coach_confirmed_at, null);
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  await check("session_confirm", { id: "SES-UNDO-1" });
  current = { id: group.uid, email: group.email };
  await check("session_check", { id: "SES-UNDO-1", item: "instructor_confirmed", done: false });
  assert.equal((await row()).coach_confirmed_at, null, "undoing the step undoes the coach's own confirmation");
  // An administrator (a session leader) confirms for the coordinator and the coach.
  current = { id: "owner", email: "owner@example.com" };
  await check("session_confirm", { id: "SES-UNDO-1", for: "coordinator" });
  await check("session_confirm", { id: "SES-UNDO-1", for: "coach" });
  let r = await row();
  assert.ok(r.coordinator_confirmed_at && r.coach_confirmed_at);
  assert.equal(r.status, "Confirmed");
  assert.equal(r.coach_id, "staff-coach", "confirming for the coach keeps the session's coach");
  // And undoes either answer; the session goes back to Scheduled.
  await check("session_unconfirm", { id: "SES-UNDO-1", for: "coordinator" });
  r = await row();
  assert.equal(r.coordinator_confirmed_at, null);
  assert.equal(r.status, "Scheduled");
  // The coordinator undoes only their own answer; the coach cannot undo the coordinator's.
  current = { id: group.uid, email: group.email };
  await check("session_confirm", { id: "SES-UNDO-1" });
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  assert.match((await post("session_unconfirm", { id: "SES-UNDO-1", for: "coordinator" })).error, /person who answered or a session leader/);
  await check("session_unconfirm", { id: "SES-UNDO-1", for: "coach" });
  assert.equal((await row()).coach_confirmed_at, null);
  assert.ok((await row()).coordinator_confirmed_at, "the coordinator's answer stays");
  current = { id: "owner", email: "owner@example.com" };
});

test("attendance is taken from the session itself, each student attended or absent", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const group = await dbRow("SELECT g.id,u.id uid,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND g.id NOT IN (SELECT group_id FROM sessions WHERE week IN (5,6)) AND (SELECT count(*) FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active')>=2 LIMIT 1");
  const roster = (await dbRows("SELECT id FROM students WHERE group_id=? AND lifecycle='Active' ORDER BY id", group.id)).map((r) => r.id);
  await check("session", { id: "SES-REG-1", group_id: group.id, title: "Week 5 coaching", starts_at: new Date(Date.now() - 2 * 3600000).toISOString(), week: 5, duration_minutes: 180 });
  await check("session", { id: "SES-REG-LATER", group_id: group.id, title: "Week 6 coaching", starts_at: new Date(Date.now() + 150 * 86400000).toISOString(), week: 6, duration_minutes: 180 });
  current = { id: group.uid, email: group.email };
  assert.match((await post("session_attendance", { id: "SES-REG-LATER", marks: { [roster[0]]: "Present" } })).error, /once a session has started/);
  assert.match((await post("session_attendance", { id: "SES-REG-1", marks: { [roster[0]]: "Late" } })).error, /attended or absent/);
  assert.match((await post("session_attendance", { id: "SES-REG-1", marks: { S10001: "Present" } })).error, /belong to the session's group/);
  const marks = Object.fromEntries(roster.map((id, i) => [id, i === 0 ? "Absent" : "Present"]));
  await check("session_attendance", { id: "SES-REG-1", marks });
  const saved = await dbRows("SELECT student_id,status FROM attendance WHERE session_id='SES-REG-1' ORDER BY student_id");
  assert.equal(saved.length, roster.length);
  assert.equal(saved.find((r) => r.student_id === roster[0]).status, "Absent");
  assert.ok(saved.slice(1).every((r) => r.status === "Present"));
  // Marking again corrects it rather than adding a second row.
  await check("session_attendance", { id: "SES-REG-1", marks: { [roster[0]]: "Present" } });
  assert.equal((await dbRow("SELECT count(*) n FROM attendance WHERE session_id='SES-REG-1'")).n, roster.length);
  // Another group's coordinator cannot take it.
  const other = await dbRow("SELECT u.id,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.coordinator<>? LIMIT 1", group.uid);
  current = { id: other.id, email: other.email };
  assert.match((await post("session_attendance", { id: "SES-REG-1", marks: { [roster[0]]: "Absent" } })).error, /coordinator or the session's coach/);
  current = { id: "owner", email: "owner@example.com" };
});


test("rescheduling a session moves the group from it on, and only Coach Operations does it", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const group = await dbRow("SELECT id FROM groups WHERE status='Active' AND id NOT IN (SELECT group_id FROM sessions WHERE week IN (2,3,4)) LIMIT 1");
  const day = (n) => new Date(Date.UTC(2027, 2, 7 + n * 7, 15, 0, 0)).toISOString(); // Sundays 5pm Cairo
  for (const week of [2, 3, 4])
    await check("session", { id: `SES-MOVE-${week}`, group_id: group.id, title: `Week ${week} coaching`, starts_at: day(week), week, duration_minutes: 180 });
  const sevenPm = new Date(Date.parse(day(3)) + 2 * 3600000).toISOString();
  // Project Operations no longer moves sessions; Coach Operations does.
  const opsOnly = await dbRow("SELECT id,email FROM users WHERE roles LIKE '%Project Operations%' AND roles NOT LIKE '%Admin%' LIMIT 1");
  if (opsOnly) {
    current = { id: opsOnly.id, email: opsOnly.email };
    assert.match((await post("session_reschedule", { id: "SES-MOVE-3", starts_at: sevenPm, reason: "Group asked for 7pm" })).error, /role/);
  }
  current = { id: "staff-coach-ops", email: "staff-coach-ops@example.invalid" };
  await check("session_reschedule", { id: "SES-MOVE-3", starts_at: sevenPm, reason: "Group asked for 7pm" });
  const at = async (week) => (await dbRow(`SELECT starts_at FROM sessions WHERE id='SES-MOVE-${week}'`)).starts_at;
  assert.equal(new Date(await at(2)).toISOString(), day(2), "the earlier session stays as it was");
  assert.equal(new Date(await at(3)).toISOString(), sevenPm);
  assert.equal(new Date(await at(4)).toISOString(), new Date(Date.parse(day(4)) + 2 * 3600000).toISOString(), "the later session moves to 7pm too");
  const audit = await dbRow("SELECT value FROM audit_events WHERE action='session_reschedule' AND entity_id='SES-MOVE-3' ORDER BY created_at DESC LIMIT 1");
  assert.equal(JSON.parse(audit.value).moved.length, 2);
  current = { id: "owner", email: "owner@example.com" };
});

test("students give feedback after each session, once, and the group's people see it", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const group = await dbRow("SELECT g.id,u.id uid,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND g.id NOT IN (SELECT group_id FROM sessions WHERE week IN (7,8)) AND EXISTS (SELECT 1 FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active' AND s.email IS NOT NULL) LIMIT 1");
  const learner = await dbRow("SELECT id,email FROM students WHERE group_id=? AND lifecycle='Active' AND email IS NOT NULL LIMIT 1", group.id);
  await check("session", { id: "SES-FB-DONE", group_id: group.id, title: "Week 7 coaching", starts_at: new Date(Date.now() - 5 * 3600000).toISOString(), week: 7, duration_minutes: 180 });
  await check("session", { id: "SES-FB-LATER", group_id: group.id, title: "Week 8 coaching", starts_at: new Date(Date.now() + 160 * 86400000).toISOString(), week: 8, duration_minutes: 180 });
  const servicesApi = await route("student-services");
  const send = (body) => servicesApi.POST(new Request("https://test.local/api/student-services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const answers = { satisfaction: 5, clarity: 4, searched_gig: true, usefulness: 5, liked: "Pricing a first gig", comments: "More time on proposals" };
  current = { id: learner.id, email: learner.email };
  const view = await (await servicesApi.GET()).json();
  const listed = view.feedback_sessions.map((s) => s.id);
  assert.ok(listed.includes("SES-FB-DONE"), "an ended session asks for feedback");
  assert.ok(!listed.includes("SES-FB-LATER"), "a future one does not");
  assert.match((await (await send({ action: "session_feedback", session_id: "SES-FB-LATER", ...answers })).json()).error, /once the session has ended/);
  assert.match((await (await send({ action: "session_feedback", session_id: "SES-FB-DONE", ...answers, clarity: 7 })).json()).error, /from 1 to 5/);
  assert.match((await (await send({ action: "session_feedback", session_id: "SES-FB-DONE", ...answers, searched_gig: undefined })).json()).error, /search for a gig/);
  const r = await send({ action: "session_feedback", session_id: "SES-FB-DONE", ...answers });
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok((await r.json()).sessions.find((s) => s.id === "SES-FB-DONE").given);
  assert.match((await (await send({ action: "session_feedback", session_id: "SES-FB-DONE", ...answers })).json()).error, /already given feedback/);
  const row = await dbRow("SELECT * FROM session_feedback WHERE session_id='SES-FB-DONE'");
  assert.equal(row.student_id, learner.id);
  assert.equal(Number(row.searched_gig), 1);
  assert.equal(row.comments, "More time on proposals");
  // The group's coordinator sees it in their workspace.
  current = { id: group.uid, email: group.email };
  const data = await (await api.GET()).json();
  assert.ok(data.sessionFeedback.some((f) => f.session_id === "SES-FB-DONE"));
  current = { id: "owner", email: "owner@example.com" };
});

test("services (paid gigs) are recorded by the coordinators of Service Team groups only", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM rate_limits");
  const group = await dbRow("SELECT g.id,g.supervisor,g.coordinator,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND EXISTS (SELECT 1 FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active') LIMIT 1");
  const learner = await dbRow("SELECT id FROM students WHERE group_id=? AND lifecycle='Active' LIMIT 1", group.id);
  const created = new Date().toISOString();
  for (const id of ["ST-DELIVERY", "ST-PAYMENT"])
    await dbExec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)", id, learner.id, id.toLowerCase(), id + ".png", "image/png", 120, id + "-hash", "owner", created);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  await dbExec("UPDATE groups SET start_date=? WHERE id=?", "2020-01-01", group.id);
  const gig = { student_id: learner.id, title: "Banner design", platform: "Khamsat", value: 20, currency: "USD", order_ref: "KH-ST-1", paid_on: today, proof_id: "ST-DELIVERY", payment_proof_id: "ST-PAYMENT" };
  const title = (await dbRow("SELECT title FROM users WHERE id=?", group.supervisor)).title;
  current = { id: group.coordinator, email: group.email };
  await dbExec("UPDATE users SET team='Target Team' WHERE id=?", group.supervisor);
  assert.match((await post("gig", { ...gig, id: "GIG-ST-1" })).error, /Service Team groups only/);
  await dbExec("UPDATE users SET team='Service Team' WHERE id=?", group.supervisor);
  await check("gig", { ...gig, id: "GIG-ST-1" });
  assert.ok(await dbRow("SELECT id FROM gigs WHERE id='GIG-ST-1'"));
  await dbExec("UPDATE users SET title=? WHERE id=?", title, group.supervisor);
  current = { id: "owner", email: "owner@example.com" };
});

test("the Service Team supervisor records account top-ups, each a new row in the credit history", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await check("account", { id: "ACC-TOPUP-1", label: "Nafezly client 1", platform: "Nafezly", credits: 40 });
  const supervisor = await dbRow("SELECT id,email,title FROM users WHERE id='staff-nour'");
  current = { id: "supervisor-login", email: "staff-nour@example.invalid" };
  await dbExec("UPDATE users SET team='Target Team' WHERE id='staff-nour'");
  assert.match((await post("account_topup", { id: "ACC-TOPUP-1", amount: 25, reference: "TRX-1001" })).error, /Service Team's supervisor/);
  await dbExec("UPDATE users SET team='Service Team' WHERE id='staff-nour'");
  assert.match((await post("account_topup", { id: "ACC-TOPUP-1", amount: 0, reference: "TRX-1001" })).error, /top-up amount/);
  assert.match((await post("account_topup", { id: "ACC-TOPUP-1", amount: 25, reference: "" })).error, /reference/);
  await check("account_topup", { id: "ACC-TOPUP-1", amount: 25, reference: "TRX-1001", note: "October budget" });
  await check("account_topup", { id: "ACC-TOPUP-1", amount: 10.5, reference: "TRX-1002" });
  assert.equal(Number((await dbRow("SELECT credits FROM accounts WHERE id='ACC-TOPUP-1'")).credits), 75.5);
  const history = await dbRows("SELECT delta,balance_after,reason,actor FROM account_credit_ledger WHERE account_id='ACC-TOPUP-1' ORDER BY created_at, balance_after");
  assert.deepEqual(history.map((h) => Number(h.delta)), [40, 25, 10.5], "opening balance, then each top-up");
  assert.equal(Number(history[2].balance_after), 75.5);
  assert.equal(history[1].reason, "Top-up · TRX-1001 · October budget");
  assert.equal(history[1].actor, "staff-nour");
  // The supervisor sees the pool and the history in the workspace.
  const data = await (await api.GET()).json();
  assert.ok(data.accounts.some((a) => a.id === "ACC-TOPUP-1"));
  assert.ok(data.creditLedger.some((e) => e.account_id === "ACC-TOPUP-1"));
  await dbExec("UPDATE users SET title=? WHERE id='staff-nour'", supervisor.title);
  current = { id: "owner", email: "owner@example.com" };
});

test("groups keep a WhatsApp link, accounts can have a second coordinator, and the keepers unblock them", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM rate_limits");
  const group = await dbRow("SELECT g.id,g.coordinator,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' LIMIT 1");
  assert.match((await post("group_whatsapp", { id: group.id, whatsapp_link: "https://example.com/not-whatsapp" })).error, /invite link/);
  // An administrator pastes the link as a phone copies it into an Arabic page:
  // invisible direction marks, share text around it and the "?mode=…" tail.
  await check("group_whatsapp", { id: group.id, whatsapp_link: "‏‪Join my group: https://chat.whatsapp.com/AbCdEfGhIjKlMnOp?mode=ems_copy_t‬" });
  assert.equal((await dbRow("SELECT whatsapp_link FROM groups WHERE id=?", group.id)).whatsapp_link, "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp");
  const other = await dbRow("SELECT id,email FROM users WHERE roles LIKE '%Operations Coordinator%' AND roles NOT LIKE '%Admin%' AND id<>? AND active=1 LIMIT 1", group.coordinator);
  current = { id: "other-login", email: other.email };
  assert.match((await post("group_whatsapp", { id: group.id, whatsapp_link: "" })).error, /coordinator or supervisor/);
  current = { id: "coordinator-login", email: group.email };
  await check("group_whatsapp", { id: group.id, whatsapp_link: "" });
  assert.equal((await dbRow("SELECT whatsapp_link FROM groups WHERE id=?", group.id)).whatsapp_link, null, "an empty link clears it");

  // Two coordinators share one account; both see it.
  current = { id: "owner", email: "owner@example.com" };
  await check("account", { id: "ACC-SHARE-1", label: "shared.client@example.com", platform: "Kafeel", credits: 20 });
  await check("account_coordinator", { id: "ACC-SHARE-1", account_ids: ["ACC-SHARE-1"], coordinator_id: group.coordinator });
  assert.match((await post("account_coordinator", { id: "ACC-SHARE-1", account_ids: ["ACC-SHARE-1"], coordinator_id: group.coordinator, slot: "second" })).error, /already works/);
  await check("account_coordinator", { id: "ACC-SHARE-1", account_ids: ["ACC-SHARE-1"], coordinator_id: other.id, slot: "second" });
  current = { id: "other-login", email: other.email };
  assert.ok((await (await api.GET()).json()).accounts.some((a) => a.id === "ACC-SHARE-1"), "the second coordinator sees the account");
  current = { id: "owner", email: "owner@example.com" };
  await check("account_coordinator", { id: "ACC-SHARE-1", account_ids: ["ACC-SHARE-1"], coordinator_id: "" });
  const shared = await dbRow("SELECT coordinator_id,coordinator_2_id FROM accounts WHERE id='ACC-SHARE-1'");
  assert.deepEqual([shared.coordinator_id, shared.coordinator_2_id], [other.id, null], "removing the first moves the second up");

  // Project Operations (Taha) tops up and unblocks; a coordinator cannot.
  await check("staff", { name: "Accounts Keeper", email: "keeper@example.com", roles: ["Project Operations", "Team Supervisor"], reason: "Probe the account keepers" });
  current = { id: "keeper-login", email: "keeper@example.com" };
  await check("account_topup", { id: "ACC-SHARE-1", amount: 5, reference: "TRX-2001" });
  await check("account_status", { id: "ACC-SHARE-1", status: "Blocked", reason: "The platform suspended it" });
  await check("account_status", { id: "ACC-SHARE-1", status: "Available", reason: "The platform restored it" });
  assert.equal((await dbRow("SELECT status FROM accounts WHERE id='ACC-SHARE-1'")).status, "Available");
  current = { id: "other-login", email: other.email };
  assert.match((await post("account_status", { id: "ACC-SHARE-1", status: "Blocked", reason: "Trying without the right" })).error, /role|Project Operations/);
  current = { id: "owner", email: "owner@example.com" };
});

test("session join logins are encrypted and shown only to the group's own people", async () => {
  const api = await route("join-accounts");
  const call = async (x) =>
    (await api.POST(new Request("https://test.local/api/join-accounts", { method: "POST", body: JSON.stringify(x) }))).json();
  globalThis.__testEnv.CREDENTIAL_ENCRYPTION_KEY = "b".repeat(64);
  const group = await dbRow(
    "SELECT g.id,g.supervisor,c.id cid,c.email cemail,s.email semail FROM groups g JOIN users c ON c.id=g.coordinator JOIN users s ON s.id=g.supervisor WHERE g.status='Active' AND g.coach<>'staff-support-coach' AND NOT EXISTS (SELECT 1 FROM group_coaches x WHERE x.group_id=g.id AND x.user_id='staff-support-coach' AND x.status='Active') LIMIT 1",
  );
  await dbExec("UPDATE groups SET provider='YAT', coach='staff-coach' WHERE id=?", group.id);
  // Only an administrator stores them.
  current = { id: group.cid, email: group.cemail };
  assert.match((await call({ action: "set", kind: "coach", provider: "YAT", group_id: group.id, username: "g@yat.example", password: "coach-pass-1" })).error, /role/);
  current = { id: "owner", email: "owner@example.com" };
  assert.equal((await call({ action: "set", kind: "coach", provider: "YAT", group_id: group.id, username: "g@yat.example", password: "coach-pass-1" })).ok, true);
  assert.equal((await call({ action: "set", kind: "coordinator", provider: "YAT", username: "coord@yat.example", password: "coord-pass-1" })).ok, true);
  const raw = JSON.stringify(await dbRows("SELECT * FROM join_accounts"));
  assert.ok(!raw.includes("coach-pass-1") && !raw.includes("g@yat.example"), "stored encrypted");

  // The group's coach and Coach Operations see the coach login.
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  assert.equal((await call({ action: "reveal", kind: "coach", group_id: group.id })).password, "coach-pass-1");
  assert.match((await call({ action: "reveal", kind: "coordinator", group_id: group.id })).error, /not yours/);
  current = { id: "coach-ops-login", email: "staff-coach-ops@example.invalid" };
  assert.equal((await call({ action: "reveal", kind: "coach", group_id: group.id })).username, "g@yat.example");
  assert.match((await call({ action: "reveal", kind: "coordinator", group_id: group.id })).error, /not yours/);
  // Another coach does not.
  current = { id: "support-coach-login", email: "staff-support-coach@example.invalid" };
  assert.match((await call({ action: "reveal", kind: "coach", group_id: group.id })).error, /not yours/);

  // The coordinator and their supervisor see the coordinators' login, not the coach's.
  current = { id: group.cid, email: group.cemail };
  assert.equal((await call({ action: "reveal", kind: "coordinator", group_id: group.id })).password, "coord-pass-1");
  assert.match((await call({ action: "reveal", kind: "coach", group_id: group.id })).error, /not yours/);
  current = { id: group.supervisor, email: group.semail };
  assert.equal((await call({ action: "reveal", kind: "coordinator", group_id: group.id })).username, "coord@yat.example");
  // A coordinator of another group does not.
  const other = await dbRow("SELECT u.id,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.coordinator<>? AND g.supervisor<>? LIMIT 1", group.cid, group.supervisor);
  if (other) {
    current = { id: other.id, email: other.email };
    assert.match((await call({ action: "reveal", kind: "coordinator", group_id: group.id })).error, /not yours/);
  }
  current = { id: "owner", email: "owner@example.com" };
  const audit = await dbRows("SELECT value FROM audit_events WHERE action='Join login shown'");
  assert.ok(audit.length >= 4, "every look is recorded");
  assert.ok(!JSON.stringify(audit).includes("pass-1"), "and the password never reaches the audit log");
});

test("leaders upload the portal's students and gigs sheets, which replace the last upload and link to our students", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const portal = await route("portal");
  const post = (body) => portal.POST(new Request("https://test.local/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const get = async (query = "") => (await portal.GET(new Request("https://test.local/api/portal" + query))).json();
  const ours = await dbRow("SELECT s.id,s.email,g.coordinator FROM students s JOIN groups g ON g.id=s.group_id WHERE s.email IS NOT NULL AND s.lifecycle='Active' LIMIT 1");
  const coordinator = await dbRow("SELECT id,email FROM users WHERE id=?", ours.coordinator);
  const studentsMapping = { ID: "portal_id", Email: "email", "Full Name": "full_name", "Final Status": "final_status", "Total Gigs": "total_gigs" };
  const send = async (sheet, mapping, rows) => {
    const begun = await (await post({ action: "begin", sheet, mapping, total: rows.length, file_name: sheet + ".xlsx" })).json();
    assert.ok(begun.batch, JSON.stringify(begun));
    for (let i = 0; i < rows.length; i += 2) assert.equal((await post({ action: "chunk", batch: begun.batch, rows: rows.slice(i, i + 2) })).status, 200);
    return (await post({ action: "commit", batch: begun.batch })).json();
  };
  // A mapping without the key is refused.
  assert.match((await (await post({ action: "begin", sheet: "gigs", mapping: { Title: "title" }, total: 1 })).json()).error, /Map these columns first/);
  let done = await send("students", studentsMapping, [
    { portal_id: "P-1", email: ours.email.toUpperCase(), full_name: "Linked student", final_status: "Graduated", total_gigs: "3" },
    { portal_id: "P-2", email: "someone-else@example.org", full_name: "Portal only", final_status: "Started", total_gigs: "1" },
    { portal_id: "P-3", email: "third@example.org", full_name: "Third", final_status: "Not Started", total_gigs: "0" },
  ]);
  assert.equal(done.rows, 3);
  assert.equal(done.linked, 1, "linked by email, whatever its case");
  done = await send("gigs", { ID: "portal_gig_id", "Student ID": "portal_student_id", Title: "title", Price: "price", Status: "status", "Auditor Status": "auditor_status", "Created On": "created_on" }, [
    { portal_gig_id: "G-1", portal_student_id: "P-1", title: "Logo", price: "5", status: "Approved", auditor_status: "Approved", created_on: "46050" },
    { portal_gig_id: "G-2", portal_student_id: "P-1", title: "Banner", price: "5", status: "Rejected", auditor_status: "Pending", created_on: "2026-05-01" },
    { portal_gig_id: "G-3", portal_student_id: "P-2", title: "Deck", price: "10", status: "Approved", auditor_status: "Approved", created_on: "" },
  ]);
  assert.equal(done.rows, 3);
  let view = await get();
  assert.equal(view.students.length, 3);
  const linked = view.students.find((s) => s.portal_id === "P-1");
  assert.equal(linked.student_id, ours.id);
  // Our active students the sheet does not have are listed apart; the linked one is not among them.
  assert.ok(Array.isArray(view.notInSheet) && view.notInSheet.length > 0, "students missing from the sheet are listed");
  assert.ok(!view.notInSheet.some((r) => r.id === ours.id), "a student the sheet links to is not missing");
  assert.ok(view.notInSheet.every((r) => !String(r.id).startsWith("DEMO-")), "no demo students");
  assert.deepEqual(
    (({ total, approved, rejected, audit_pending }) => ({ total: Number(total), approved: Number(approved), rejected: Number(rejected), audit_pending: Number(audit_pending) }))(view.gigCounts.find((g) => g.portal_student_id === "P-1")),
    { total: 2, approved: 1, rejected: 1, audit_pending: 1 },
  );
  assert.ok(view.mappings.students, "the mapping is remembered");
  const gigs = (await get("?student=P-1")).gigs;
  assert.equal(gigs.length, 2);
  assert.ok(gigs.find((g) => g.portal_gig_id === "G-1").created_on.startsWith("2026-01-28"), "an Excel day number is read as a date");
  // A new upload replaces the last one.
  await send("students", studentsMapping, [{ portal_id: "P-1", email: ours.email, full_name: "Linked student", final_status: "Graduated", total_gigs: "4" }]);
  view = await get();
  assert.equal(view.students.length, 1);
  assert.equal((await dbRow("SELECT count(*) n FROM portal_students")).n, 1, "the replaced rows are gone");
  assert.equal(view.active.students.status, "Active");
  // A coordinator sees only their own linked students, and cannot upload.
  current = { id: coordinator.id, email: coordinator.email };
  view = await get();
  assert.ok(view.students.every((s) => s.student_id === ours.id));
  assert.equal(view.canUpload, false);
  assert.match((await (await post({ action: "begin", sheet: "students", mapping: studentsMapping, total: 1 })).json()).error, /uploaded by supervisors/);
  current = { id: "owner", email: "owner@example.com" };
});

test("the portal flags a gig as a possible duplicate by its proof, or by its link on the same day", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const portal = await route("portal");
  const post = (body) => portal.POST(new Request("https://test.local/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const send = async (sheet, mapping, rows) => {
    const begun = await (await post({ action: "begin", sheet, mapping, total: rows.length, file_name: sheet + ".xlsx" })).json();
    assert.ok(begun.batch, JSON.stringify(begun));
    assert.equal((await post({ action: "chunk", batch: begun.batch, rows })).status, 200);
    return (await post({ action: "commit", batch: begun.batch })).json();
  };
  await send("students", { ID: "portal_id", Email: "email", "Full Name": "full_name" }, [
    { portal_id: "D-1", email: "d1@example.org", full_name: "Dup One" },
    { portal_id: "D-2", email: "d2@example.org", full_name: "Dup Two" },
    { portal_id: "D-3", email: "d3@example.org", full_name: "Dup Three" },
  ]);
  const gig = (id, student, link, day, proof) => ({ portal_gig_id: id, portal_student_id: student, title: "Gig " + id, url: link, created_on: day, proof_url: proof, status: "Pending" });
  await send("gigs", { ID: "portal_gig_id", "Student ID": "portal_student_id", Title: "title", Link: "url", "Created On": "created_on", Proof: "proof_url", Status: "status" }, [
    gig("DG-1", "D-1", "https://nafezly.com/service/1", "2026-05-01", "https://proof/a"),
    gig("DG-2", "D-1", "https://nafezly.com/service/1", "2026-05-01", "https://proof/b"),
    // The same service sold again another day is a repeat sale, not a duplicate.
    gig("DG-3", "D-1", "https://nafezly.com/service/1", "2026-05-09", "https://proof/c"),
    // One proof on two rows, whatever the links.
    gig("DG-4", "D-2", "https://kafiil.com/service/9", "2026-05-02", "https://proof/a"),
    // One general site address for two students on one day, and again another day.
    gig("DG-5", "D-2", "https://outlier.ai", "2026-05-03", "https://proof/e"),
    gig("DG-6", "D-3", "https://outlier.ai", "2026-05-03", "https://proof/f"),
    gig("DG-7", "D-3", "https://outlier.ai", "2026-05-04", "https://proof/g"),
  ]);
  const found = await (await portal.GET(new Request("https://test.local/api/portal?duplicates=1"))).json();
  assert.ok(!found.error, found.error);
  assert.equal(found.repeats.length, 1, JSON.stringify(found.repeats));
  assert.deepEqual([found.repeats[0].portal_id, found.repeats[0].day, found.repeats[0].count], ["D-1", "2026-05-01", 2]);
  assert.deepEqual(found.repeats[0].gig_ids.sort(), ["DG-1", "DG-2"]);
  assert.equal(found.proofs.length, 1);
  assert.deepEqual(found.proofs[0].gig_ids.sort(), ["DG-1", "DG-4"]);
  assert.equal(found.shared.length, 1);
  assert.deepEqual([found.shared[0].day, found.shared[0].students.map((x) => x.name).sort()], ["2026-05-03", ["Dup Three", "Dup Two"]]);
});

test("a backup coach takes one session, and a group's new coach or coordinator takes only the sessions to come", async () => {
  current = { id: "owner", email: "owner@example.com" };
  // The group with the most free weeks, and three of them.
  const groups = await dbRows("SELECT g.id,g.coordinator,(SELECT count(*) FROM sessions t WHERE t.group_id=g.id AND t.status<>'Cancelled') n FROM groups g WHERE g.status='Active' ORDER BY n, g.id LIMIT 1");
  const group = groups[0];
  const taken = new Set((await dbRows("SELECT week FROM sessions WHERE group_id=? AND status<>'Cancelled'", group.id)).map((r) => Number(r.week)));
  const [w1, w2, w3] = [1, 2, 3, 4, 5, 6, 7, 8].filter((w) => !taken.has(w));
  const at = (days) => new Date(Date.now() + days * 86400000).toISOString();
  await check("session", { id: "SES-PAY-PAST", group_id: group.id, title: "Held", starts_at: at(-10), week: w1, duration_minutes: 180, coach_id: "staff-coach" });
  await check("session", { id: "SES-PAY-NEXT", group_id: group.id, title: "Next", starts_at: at(170), week: w2, duration_minutes: 180, coach_id: "staff-coach" });
  await check("session", { id: "SES-PAY-LATER", group_id: group.id, title: "Later", starts_at: at(177), week: w3, duration_minutes: 180, coach_id: "staff-coach" });
  assert.equal((await dbRow("SELECT coordinator_id FROM sessions WHERE id='SES-PAY-PAST'")).coordinator_id, group.coordinator, "a session remembers its coordinator");
  // A backup coach for one session, created on the spot by Coach Operations.
  current = { id: "staff-coach-ops", email: "staff-coach-ops@example.invalid" };
  // A held session can be given to whoever actually held it (21 October 2026), still with a reason.
  assert.match((await post("session_coach", { id: "SES-PAY-PAST", coach_id: "staff-support-coach", reason: "x" })).error, /Say why/);
  assert.match((await post("session_coach", { id: "SES-PAY-NEXT", new_name: "Backup Coach", new_email: "backup.coach@example.org", new_national_id: "123", reason: "Mariam is travelling" })).error, /national ID/i);
  await check("session_coach", { id: "SES-PAY-NEXT", new_name: "Backup Coach", new_email: "backup.coach@example.org", new_national_id: "29901011234567", new_phone: "1012345678", reason: "Mariam is travelling" });
  // Any other member of staff can stand in for one session, a quality reviewer for one.
  await check("session_coach", { id: "SES-PAY-LATER", coach_id: "staff-quality", reason: "The coach is ill today" });
  assert.equal((await dbRow("SELECT coach_id FROM sessions WHERE id='SES-PAY-LATER'")).coach_id, "staff-quality");
  await check("session_coach", { id: "SES-PAY-LATER", coach_id: "staff-coach", reason: "The coach is back" });
  const backup = await dbRow("SELECT * FROM users WHERE email='backup.coach@example.org'");
  assert.ok(JSON.parse(backup.roles).includes("Coach"));
  assert.equal(backup.title, "Backup Coach");
  assert.equal((await dbRow("SELECT coach_id FROM sessions WHERE id='SES-PAY-NEXT'")).coach_id, backup.id, "the backup holds that session");
  assert.equal((await dbRow("SELECT coach_id FROM sessions WHERE id='SES-PAY-LATER'")).coach_id, "staff-coach", "the next one keeps its coach");
  assert.ok(await dbRow("SELECT id FROM group_coaches WHERE group_id=? AND user_id=? AND coach_type='Backup Coach'", group.id, backup.id), "and can see the group to take attendance");
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  assert.match((await post("session_coach", { id: "SES-PAY-LATER", coach_id: "staff-support-coach", reason: "Swap" })).error, /role/);
  // A new group coach and coordinator take the sessions to come; the held session keeps both.
  current = { id: "owner", email: "owner@example.com" };
  const coordinator = await dbRow("SELECT id FROM users WHERE roles LIKE '%Operations Coordinator%' AND id<>? AND active=1 LIMIT 1", group.coordinator);
  await programCheck("bulk_group_owner", { group_ids: [group.id], owner_type: "Coordinator", owner: coordinator.id, reason: "New coordinator for the group" });
  await programCheck("bulk_group_owner", { group_ids: [group.id], owner_type: "Coach", owner: "staff-support-coach", reason: "New coach for the group" });
  const past = await dbRow("SELECT coach_id,coordinator_id FROM sessions WHERE id='SES-PAY-PAST'");
  assert.equal(past.coach_id, "staff-coach", "the held session keeps the coach who held it");
  assert.equal(past.coordinator_id, group.coordinator, "and its coordinator");
  const later = await dbRow("SELECT coach_id,coordinator_id FROM sessions WHERE id='SES-PAY-LATER'");
  assert.equal(later.coach_id, "staff-support-coach");
  assert.equal(later.coordinator_id, coordinator.id);
  await programCheck("bulk_group_owner", { group_ids: [group.id], owner_type: "Coordinator", owner: group.coordinator, reason: "Restore" });
});

test("a group's new coach starts on a chosen day; earlier sessions keep the coach who had them", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const group = (await dbRows("SELECT g.id,(SELECT count(*) FROM sessions t WHERE t.group_id=g.id AND t.status<>'Cancelled') n FROM groups g WHERE g.status='Active' ORDER BY n, g.id LIMIT 1"))[0];
  const taken = new Set((await dbRows("SELECT week FROM sessions WHERE group_id=? AND status<>'Cancelled'", group.id)).map((r) => Number(r.week)));
  const [w1, w2, w3] = [1, 2, 3, 4, 5, 6, 7, 8].filter((w) => !taken.has(w));
  await dbExec("UPDATE groups SET coach='staff-coach' WHERE id=?", group.id);
  const at = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const cairo = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  // Sessions that only follow the group's coach: no coach is written on them.
  await check("session", { id: "SES-FROM-HELD", group_id: group.id, title: "Held", starts_at: at(-12), week: w1, duration_minutes: 180 });
  await check("session", { id: "SES-FROM-BEFORE", group_id: group.id, title: "Before the change", starts_at: at(201), week: w2, duration_minutes: 180 });
  await check("session", { id: "SES-FROM-AFTER", group_id: group.id, title: "After the change", starts_at: at(208), week: w3, duration_minutes: 180 });
  const from = cairo(at(205));
  assert.match(
    (await programPost("bulk_group_owner", { group_ids: [group.id], owner_type: "Coach", owner: "staff-support-coach", reason: "Change", from: cairo(at(-3)) })).error,
    /today or later/,
  );
  await programCheck("bulk_group_owner", { group_ids: [group.id], owner_type: "Coach", owner: "staff-support-coach", reason: "New coach from the next block", from });
  const coachOf = async (id) => (await dbRow("SELECT coach_id FROM sessions WHERE id=?", id))?.coach_id;
  assert.equal(await coachOf("SES-FROM-HELD"), "staff-coach", "the held session records the coach who held it");
  assert.equal(await coachOf("SES-FROM-BEFORE"), "staff-coach", "a session before the chosen day keeps the old coach");
  assert.equal(await coachOf("SES-FROM-AFTER"), "staff-support-coach", "sessions from the chosen day move");
  assert.equal((await dbRow("SELECT coach FROM groups WHERE id=?", group.id)).coach, "staff-support-coach");
  // One session can still be changed on its own afterwards.
  current = { id: "staff-coach-ops", email: "staff-coach-ops@example.invalid" };
  await check("session_coach", { id: "SES-FROM-BEFORE", coach_id: "staff-support-coach", reason: "Old coach is away that day" });
  assert.equal(await coachOf("SES-FROM-BEFORE"), "staff-support-coach");
  // Coach Operations can also take the coach off the group from a day: those sessions have no coach,
  // and the coach stops seeing the group once no session of it is left to them.
  await programCheck("bulk_group_owner", { group_ids: [group.id], owner_type: "Coach", remove: true, reason: "Coach left the programme", from: cairo(at(206)) });
  assert.equal(await coachOf("SES-FROM-AFTER"), null, "the session after the day has no coach");
  assert.equal(await coachOf("SES-FROM-HELD"), "staff-coach", "the held session keeps its coach");
  assert.equal((await dbRow("SELECT coach FROM groups WHERE id=?", group.id)).coach, "system-unassigned-coach");
  assert.equal(
    (await dbRow("SELECT status FROM group_coaches WHERE group_id=? AND user_id='staff-support-coach' AND coach_type='Outcome Coach'", group.id))?.status,
    "Active",
    "they keep the group while a session before the day is still theirs",
  );
  await dbExec("DELETE FROM sessions WHERE id='SES-FROM-BEFORE'");
  await programCheck("bulk_group_owner", { group_ids: [group.id], owner_type: "Coach", owner: "staff-support-coach", reason: "Back", from: cairo(at(0)) });
  await programCheck("bulk_group_owner", { group_ids: [group.id], owner_type: "Coach", remove: true, reason: "Coach left the programme", from: cairo(at(0)) });
  assert.equal(
    (await dbRow("SELECT status FROM group_coaches WHERE group_id=? AND user_id='staff-support-coach' AND coach_type='Outcome Coach'", group.id)).status,
    "Removed",
    "and lose it once none is left",
  );
  assert.match((await programPost("bulk_group_owner", { group_ids: [group.id], owner_type: "Coach", remove: true, reason: "Again" })).error, /no coach to remove/);
  current = { id: "owner", email: "owner@example.com" };
  for (const id of ["SES-FROM-HELD", "SES-FROM-BEFORE", "SES-FROM-AFTER"]) await dbExec("DELETE FROM sessions WHERE id=?", id);
});


test("attendance is Present or Absent, and a coach cannot change what the coordinator saved", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const group = (await dbRows("SELECT g.id,g.coordinator,(SELECT count(*) FROM sessions t WHERE t.group_id=g.id AND t.status<>'Cancelled') n FROM groups g WHERE g.status='Active' AND (SELECT count(*) FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active')>=2 ORDER BY n, g.id LIMIT 1"))[0];
  const taken = new Set((await dbRows("SELECT week FROM sessions WHERE group_id=? AND status<>'Cancelled'", group.id)).map((r) => Number(r.week)));
  const week = [1, 2, 3, 4, 5, 6, 7, 8].find((w) => !taken.has(w));
  await check("session", { id: "SES-TRUTH-1", group_id: group.id, title: "Register", starts_at: new Date(Date.now() - 3 * 3600000).toISOString(), week, duration_minutes: 180 });
  await dbExec(
    "INSERT OR IGNORE INTO group_coaches(id,group_id,user_id,coach_type,status,onboarding_status,assigned_by,assigned_at) VALUES(?,?,?,?,?,?,?,?)",
    "GC-TRUTH-1", group.id, "staff-coach", "Outcome Coach", "Active", "Pending", "owner", new Date().toISOString(),
  );
  const [a, b] = (await dbRows("SELECT id FROM students WHERE group_id=? AND lifecycle='Active' ORDER BY id LIMIT 2", group.id)).map((r) => r.id);
  const coordinator = await dbRow("SELECT id,email FROM users WHERE id=?", group.coordinator);
  current = { id: coordinator.id, email: coordinator.email };
  assert.match((await post("session_attendance", { id: "SES-TRUTH-1", marks: { [a]: "Late" } })).error, /attended or absent/);
  await check("session_attendance", { id: "SES-TRUTH-1", marks: { [a]: "Absent" } });
  // The coach marks both present; the coordinator's Absent stands.
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  await check("session_attendance", { id: "SES-TRUTH-1", marks: { [a]: "Present", [b]: "Present" } });
  assert.equal((await dbRow("SELECT status FROM attendance WHERE session_id='SES-TRUTH-1' AND student_id=?", a)).status, "Absent");
  assert.equal((await dbRow("SELECT status FROM attendance WHERE session_id='SES-TRUTH-1' AND student_id=?", b)).status, "Present");
  // The coordinator can still change their own mark.
  current = { id: coordinator.id, email: coordinator.email };
  await check("session_attendance", { id: "SES-TRUTH-1", marks: { [a]: "Present" } });
  assert.equal((await dbRow("SELECT status FROM attendance WHERE session_id='SES-TRUTH-1' AND student_id=?", a)).status, "Present");
  current = { id: "owner", email: "owner@example.com" };
});

test("staff carry a title and a team chosen from two, set in the staff form and audited", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await check("staff", { name: "Team Probe", email: "team.probe@example.org", roles: ["Operations Coordinator"], title: "Operations Coordinator", team: "Service Team", reason: "New coordinator" });
  let row = await dbRow("SELECT title,team FROM users WHERE email='team.probe@example.org'");
  assert.deepEqual([row.title, row.team], ["Operations Coordinator", "Service Team"]);
  assert.match((await post("staff", { name: "Team Probe", email: "team.probe@example.org", roles: ["Operations Coordinator"], team: "Sales Team", reason: "Typo" })).error, /Target Team or the Service Team/);
  await check("staff", { name: "Team Probe", email: "team.probe@example.org", roles: ["Operations Coordinator"], team: "Target Team", reason: "Moved to the Target Team" });
  row = await dbRow("SELECT title,team FROM users WHERE email='team.probe@example.org'");
  assert.deepEqual([row.title, row.team], ["Operations Coordinator", "Target Team"], "the title stays when only the team changes");
  const audit = await dbRow("SELECT value,reason FROM audit_events WHERE action='staff' ORDER BY created_at DESC LIMIT 1");
  assert.deepEqual(JSON.parse(audit.value).team_change, { from: "Service Team", to: "Target Team" });
});

test("one screenshot of a group message logs a contact for every active student in the group", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const group = await dbRow("SELECT g.id,g.coordinator,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND (SELECT count(*) FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active')>=2 LIMIT 1");
  const members = await dbRows("SELECT id FROM students WHERE group_id=? AND lifecycle='Active' ORDER BY id", group.id);
  await dbExec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)", "GROUP-SHOT-1", members[0].id, "group-shot-1", "group.png", "image/png", 100, "group-shot-hash", "owner", new Date().toISOString());
  const at = new Date().toISOString();
  current = { id: group.coordinator, email: group.email };
  const other = await dbRow("SELECT id FROM groups WHERE coordinator<>? AND status='Active' LIMIT 1", group.coordinator);
  assert.match((await post("group_contact", { group_id: other.id, proof_id: "GROUP-SHOT-1", channel: "WhatsApp", outcome: "Responded", occurred_at: at, notes: "Weekly reminder" })).error, /only your own groups/);
  assert.match((await post("group_contact", { group_id: group.id, channel: "WhatsApp", outcome: "Responded", occurred_at: at })).error, /comment/);
  await check("group_contact", { group_id: group.id, proof_id: "GROUP-SHOT-1", channel: "WhatsApp", outcome: "Responded", occurred_at: at, notes: "Weekly reminder" });
  const logged = await dbRows("SELECT c.student_id FROM contacts c JOIN attachments a ON a.id=c.proof_id WHERE a.hash='group-shot-hash' AND c.occurred_at=?", at);
  assert.equal(logged.length, members.length, "every active student has the contact, each with the same screenshot");
  for (const m of members) assert.equal((await dbRow("SELECT last_contact FROM students WHERE id=?", m.id)).last_contact.slice(0, 16), at.slice(0, 16));
  current = { id: "owner", email: "owner@example.com" };
});

test("demo accounts work on the demo groups only, and nobody else sees them", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const first = await check("demo_refresh");
  assert.equal(first.kept, 0, first.reasons?.join(" | "));
  // A second refresh starts the demo over without tripping on the first.
  assert.equal((await check("demo_refresh")).kept, 0);
  const real = await dbRow("SELECT s.id FROM students s WHERE s.id NOT LIKE 'DEMO-%' LIMIT 1");
  try {
    current = { id: "demo-auth-coordinator", email: "demo.coordinator@example.com" };
    const view = await (await api.GET()).json();
    assert.deepEqual(view.groups.map((g) => g.id).sort(), ["DEMO-G1", "DEMO-G2"]);
    assert.ok(view.students.length && view.students.every((s) => s.id.startsWith("DEMO-")));
    assert.ok(view.staff.every((p) => p.id.startsWith("DEMO-")), "only the demo team");
    // A student's national ID is their first password: staff other than administrators never receive it.
    assert.ok(view.students.every((s) => !("national_id" in s)), "no student national IDs for a coordinator");
    // This week's session started half an hour ago, so attendance can be taken now.
    const live = view.sessions.find((s) => s.id === "DEMO-G1-W2");
    assert.ok(Date.parse(live.starts_at) <= Date.now());
    await check("session_attendance", { id: "DEMO-G1-W2", marks: { "DEMO-S01": "Present", "DEMO-S02": "Absent" } });
    assert.match((await post("task", { student_id: real.id, title: "Real", due: new Date().toISOString(), category: "Contact", priority: "High" })).error, /demo|scope/i);
    assert.match((await post("staff", { name: "X", email: "x@example.com" })).error, /demo/i);
    assert.match((await post("session_coach", { id: "DEMO-G1-W3", new_email: "real@example.com", new_name: "Real" })).error, /demo/i);

    current = { id: "owner", email: "owner@example.com" };
    const owner = await (await api.GET()).json();
    assert.ok(!owner.groups.some((g) => g.id.startsWith("DEMO-")), "real users never see demo groups");
    assert.ok(!owner.staff.some((p) => p.id.startsWith("DEMO-")), "nor the demo team");
    // The workspace says which session logins exist, never the login itself.
    await dbExec("INSERT INTO join_accounts(id,kind,provider,group_id,username,secret,iv,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING", "coordinator:TEST", "coordinator", "TEST", null, "sealed-user", "sealed-secret", "iv", "owner", new Date().toISOString());
    const withLogins = await (await api.GET()).json();
    const login = withLogins.joinLogins.find((x) => x.id === "coordinator:TEST");
    assert.ok(login && !("secret" in login) && !("username" in login) && !("iv" in login));
  } finally {
    current = { id: "owner", email: "owner@example.com" };
  }
});

test("supervisors assign client accounts to coordinators; the owner column stays with its keeper", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const sara = await dbRow("SELECT id FROM users WHERE email='staff-sara@example.invalid'");
  const nour = await dbRow("SELECT id FROM users WHERE email='staff-nour@example.invalid'");
  for (const [id, platform] of [["ACC-T1", "Kafeel"], ["ACC-T2", "Nafezly"]])
    await dbExec(
      "INSERT INTO accounts(id,platform,label,status,credits,pending_credits,owner_name,comments) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      id, platform, id.toLowerCase() + "@example.com", "Available", 10, 2, "Owner From Sheet", "note",
    );
  // A supervisor assigns, within their own team.
  current = { id: "supervisor-login", email: "staff-nour@example.invalid" };
  const view = await (await api.GET()).json();
  assert.ok(view.accounts.some((a) => a.id === "ACC-T1"), "supervisors see the pool to assign it");
  assert.ok(view.accounts.every((a) => !("owner_name" in a)), "the owner is not theirs to read");
  const team = view.teamCoordinators;
  const target = team === null ? sara.id : team[0];
  if (target) {
    await check("account_coordinator", { id: "ACC-T1", account_ids: ["ACC-T1"], coordinator_id: target });
    assert.equal((await dbRow("SELECT coordinator_id FROM accounts WHERE id='ACC-T1'")).coordinator_id, target);
  }
  // A coordinator cannot assign, and sees only the accounts assigned to them.
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  assert.match((await post("account_coordinator", { id: "ACC-T2", account_ids: ["ACC-T2"], coordinator_id: sara.id })).error, /permit|role/i);
  await dbExec("UPDATE accounts SET coordinator_id=? WHERE id='ACC-T2'", sara.id);
  const mine = await (await api.GET()).json();
  assert.ok(mine.accounts.every((a) => a.coordinator_id === sara.id));
  assert.ok(mine.accounts.some((a) => a.id === "ACC-T2"));
  // The keeper of the list (the "account-owner" scope) reads the owner.
  current = { id: "owner", email: "owner@example.com" };
  const admin = await (await api.GET()).json();
  assert.equal(admin.accounts.find((a) => a.id === "ACC-T1").owner_name, "Owner From Sheet");
  void nour;
});

test("the audit history never keeps or shows a national ID", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const s = await dbRow("SELECT id FROM students WHERE id NOT LIKE 'DEMO-%' LIMIT 1");
  await dbExec("INSERT INTO audit_events(id,actor,action,entity_id,previous,value,reason,request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    "AUD-old-nid", "owner", "Old row", s.id, JSON.stringify({ national_id: "29001011234567", name: "x" }), JSON.stringify({ ok: 1 }), null, "REQ-old-nid", new Date().toISOString());
  await check("engagement", { student_id: s.id, engagement: "At Risk", reason: "Checking the history cleaning" }).catch(() => {});
  const view = await (await api.GET()).json();
  const text = JSON.stringify(view.logs || view.audit || []);
  assert.ok(text.includes("AUD-old-nid"), "the old row is in the feed");
  assert.ok(!text.includes("29001011234567"), "an old row is cleaned on the way out");
  const stored = await dbRows("SELECT previous,value FROM audit_events WHERE actor='owner' ORDER BY created_at DESC LIMIT 20");
  assert.ok(stored.filter((r) => r.previous !== null && !String(r.previous).includes("29001011234567")).every((r) => !/national_id/.test(String(r.previous) + String(r.value))), "new rows are written without it");
});

test("a demo account cannot open a programme-wide case or read real applicants", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await check("demo_refresh");
  current = { id: "demo-auth-po", email: "demo.projectops@example.com" };
  const due = new Date(Date.now() + 86400000).toISOString();
  assert.match((await post("case", { title: "Planted", owner: "DEMO-PO", due, group_id: "DEMO-G1", notes: "A demo case for the test" })).error ?? "", /^$/);
  const planted = await dbRow("SELECT group_id FROM cases WHERE title='Planted'");
  assert.equal(planted.group_id, "DEMO-G1", "the case stays with the demo group");
  assert.ok((await post("case", { title: "Global", owner: "DEMO-PO", due, notes: "A programme-wide case" })).error, "no programme-wide case from the demo");
  const program = await (await programApi.GET(new Request("https://test.local/api/program"))).json();
  assert.deepEqual(program.applications || [], []);
  current = { id: "owner", email: "owner@example.com" };
  const real = await (await api.GET()).json();
  assert.ok(!real.cases.some((c) => c.title === "Planted"), "real users never see the demo case");
});

test("a session rated below 3 is a red flag that Coach Operations handles, and each role sees only its own groups", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const groups = await dbRows(
    "SELECT g.id,u.id uid,u.email FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND EXISTS (SELECT 1 FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active') AND g.id NOT IN (SELECT group_id FROM sessions WHERE week=6) ORDER BY g.id",
  );
  const a = groups[0];
  const b = groups.find((g) => g.uid !== a.uid);
  assert.ok(a && b, "two groups with different coordinators");
  const started = new Date(Date.now() - 6 * 3600000).toISOString();
  await check("session", { id: "SES-FLAG-A", group_id: a.id, title: "Week 6 coaching", starts_at: started, week: 6, duration_minutes: 180 });
  await check("session", { id: "SES-FLAG-B", group_id: b.id, title: "Week 6 coaching", starts_at: started, week: 6, duration_minutes: 180 });
  const rate = async (session, group, ratings) => {
    const learners = await dbRows("SELECT id FROM students WHERE group_id=? AND lifecycle='Active' ORDER BY id LIMIT ?", group, ratings.length);
    for (const [i, [s, c, u]] of ratings.entries())
      await dbExec(
        "INSERT INTO session_feedback(id,session_id,student_id,satisfaction,clarity,searched_gig,usefulness,liked,comments,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        `SFB-${session}-${i}`, session, learners[i].id, s, c, 1, u, null, i ? null : "Too fast", new Date().toISOString(),
      );
  };
  await rate("SES-FLAG-A", a.id, [[2, 2, 3], [3, 2, 2]]); // 2.3: a red flag
  await rate("SES-FLAG-B", b.id, [[5, 4, 4]]); // 4.3: good
  const feedbackApi = await route("feedback");
  const get = async (query = "") => (await feedbackApi.GET(new Request("https://test.local/api/feedback" + query))).json();
  const handle = async (body) =>
    (
      await feedbackApi.POST(
        new Request("https://test.local/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "handle_flag", ...body }) }),
      )
    ).json();
  try {
    // A coordinator reads their own group's feedback and no one else's, and cannot handle flags.
    current = { id: a.uid, email: a.email };
    let view = await get();
    assert.equal(view.error, undefined, view.error);
    assert.ok(view.sessions.some((s) => s.id === "SES-FLAG-A"));
    assert.ok(!view.sessions.some((s) => s.id === "SES-FLAG-B"), "another team's session stays hidden");
    assert.ok(view.responses.every((r) => r.session_id !== "SES-FLAG-B"));
    assert.equal(view.handles, false);
    assert.match((await handle({ session_id: "SES-FLAG-A", note: "Spoke to the coach" })).error, /role does not permit/);
    // Coaches do not see students' feedback at all.
    const coach = await dbRow(`SELECT id,email FROM users WHERE roles LIKE '%"Coach"%' AND roles NOT LIKE '%Operations%' AND active=1 LIMIT 1`);
    if (coach) {
      current = { id: coach.id, email: coach.email };
      assert.match((await get()).error, /role does not permit/);
    }
    // Coach Operations sees the open flag, handles it once, and may open a case.
    current = { id: "staff-coach-ops", email: "staff-coach-ops@example.invalid" };
    const summary = await get("?summary=1");
    assert.equal(summary.handles, true);
    assert.ok(summary.open >= 1);
    assert.match((await handle({ session_id: "SES-FLAG-B", note: "Nothing to fix here" })).error, /below 3 out of 5/);
    assert.match((await handle({ session_id: "SES-FLAG-A", note: "ok" })).error, /5 to 2,000/);
    const done = await handle({ session_id: "SES-FLAG-A", note: "Called the coach; agreed a slower pace next week.", open_case: true });
    assert.equal(done.error, undefined, done.error);
    const kase = await dbRow("SELECT * FROM cases WHERE id=?", done.case_id);
    assert.equal(kase.group_id, a.id, "the case belongs to the group, not the whole programme");
    assert.equal(kase.status, "Open");
    assert.equal((await get("?summary=1")).open, summary.open - 1);
    assert.match((await handle({ session_id: "SES-FLAG-A", note: "Second attempt at it" })).error, /already handled/);
    const flag = (await get()).handled.find((h) => h.session_id === "SES-FLAG-A");
    assert.equal(Number(flag.score), 2.3);
    assert.equal(flag.case_id, done.case_id);
    assert.equal(flag.handled_by, "staff-coach-ops");
  } finally {
    current = { id: "owner", email: "owner@example.com" };
  }
});

test("a coach sees their own students' progress, and nothing about how a gig was paid for", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const progressApi = await route("coach-progress");
  const get = async () => (await progressApi.GET(new Request("https://test.local/api/coach-progress"))).json();
  const learner = await dbRow(
    "SELECT s.id,s.group_id FROM students s JOIN groups g ON g.id=s.group_id WHERE g.coach='staff-coach' AND s.lifecycle='Active' AND g.id NOT LIKE 'DEMO-%' ORDER BY s.id LIMIT 1",
  );
  const at = new Date().toISOString();
  await dbExec(
    "INSERT INTO gigs(id,student_id,platform,title,value,currency,order_ref,status,due,created_at,paid_by_account) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    "GIG-COACHVIEW", learner.id, "Kafeel", "Bought through ACC-SECRET", 12, "USD", "ORD-COACHVIEW", "Paid", at, at, "ACC-SECRET",
  );
  try {
    current = { id: "staff-coach", email: "staff-coach@example.invalid" };
    const view = await get();
    assert.equal(view.error, undefined, view.error);
    const coached = new Set(
      (
        await dbRows(
          "SELECT g.id FROM groups g WHERE g.coach='staff-coach' OR EXISTS (SELECT 1 FROM group_coaches gc WHERE gc.group_id=g.id AND gc.user_id='staff-coach' AND gc.status='Active' AND gc.coach_type IN ('Outcome Coach','Support Coach'))",
        )
      ).map((g) => g.id),
    );
    assert.ok(view.students.length > 0);
    assert.ok(view.students.every((s) => coached.has(s.group_id)), "only the groups this person coaches");
    // Coaches see their students' phone numbers (decided 24 Oct 2026).
    const phone = (await dbRow("SELECT phone FROM students WHERE id=?", learner.id)).phone;
    assert.equal(view.students.find((s) => s.id === learner.id).phone, phone || null);
    const gig = view.students.find((s) => s.id === learner.id).gigs.find((g) => g.id === "GIG-COACHVIEW");
    assert.ok(gig, "the gig is listed");
    assert.equal(gig.usd, 12);
    assert.equal(gig.review_status, null, "not yet submitted for review");
    const text = JSON.stringify(view);
    for (const hidden of ["ACC-SECRET", "paid_by_account", "account_id", "Bought through", "gig_status", "client_name", "organization"])
      assert.ok(!text.includes(hidden), `the coach view never carries ${hidden}`);
    // A coordinator is not a coach.
    const coordinator = await dbRow(`SELECT id,email FROM users WHERE roles LIKE '%Operations Coordinator%' AND roles NOT LIKE '%"Coach"%' AND roles NOT LIKE '%Admin%' AND active=1 LIMIT 1`);
    current = { id: coordinator.id, email: coordinator.email };
    assert.match((await get()).error, /role does not permit/);
  } finally {
    current = { id: "owner", email: "owner@example.com" };
    await dbExec("DELETE FROM gigs WHERE id='GIG-COACHVIEW'").catch(() => {});
  }
});

test("staff report technical problems with a screenshot, and the system owner works them to resolved", async () => {
  await dbExec("DELETE FROM rate_limits");
  const objects = new Map();
  const previous = globalThis.__testEnv.BUCKET;
  globalThis.__testEnv.BUCKET = {
    put: async (key, value) => void objects.set(key, Buffer.from(value)),
    get: async (key) => (objects.has(key) ? { body: new Blob([objects.get(key)]).stream() } : null),
    delete: async (key) => void objects.delete(key),
  };
  const supportApi = await route("support");
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const report = async (fields, file) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    if (file) body.set("screenshot", new File([file], "shot.png", { type: "image/png" }));
    return (await supportApi.POST(new Request("https://test.local/api/support", { method: "POST", body }))).json();
  };
  const update = async (x) =>
    (
      await supportApi.POST(
        new Request("https://test.local/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", ...x }) }),
      )
    ).json();
  const list = (query = "") => supportApi.GET(new Request("https://test.local/api/support" + query));
  try {
    const coordinator = await dbRow(`SELECT id,email FROM users WHERE roles LIKE '%Operations Coordinator%' AND roles NOT LIKE '%Admin%' AND id NOT LIKE 'DEMO-%' AND active=1 LIMIT 1`);
    current = { id: coordinator.id, email: coordinator.email };
    const base = { category: "Bug", severity: "Major", page: "Sessions", action: "Opened week 3 and pressed Take attendance", happened: "The window closed without saving" };
    assert.match((await report({ ...base, category: "Question" })).error, /kind of problem/);
    assert.match((await report(base, Uint8Array.from([1, 2, 3, 4, 5]))).error, /PNG or JPEG/);
    const sent = await report(base, png);
    assert.equal(sent.error, undefined, sent.error);
    const row = await dbRow("SELECT * FROM support_reports WHERE id=?", sent.id);
    assert.equal(row.reporter, coordinator.id);
    assert.equal(row.status, "Open");
    assert.ok(row.screenshot_key.startsWith("support/") && objects.has(row.screenshot_key));
    assert.ok((await dbRow("SELECT count(*) n FROM notifications WHERE entity_type='support' AND entity_id=?", sent.id)).n >= 1, "the system owner is told");
    let view = await (await list()).json();
    assert.equal(view.admin, false);
    assert.ok(view.reports.some((r) => r.id === sent.id));
    assert.equal((await list("?screenshot=" + sent.id)).status, 200);
    assert.match((await update({ id: sent.id, status: "Resolved", resolution: "Fixed" })).error, /role does not permit/);
    // Another member of staff sees neither the report nor its screenshot.
    const other = await dbRow(`SELECT id,email FROM users WHERE roles NOT LIKE '%Admin%' AND id NOT LIKE 'DEMO-%' AND id<>? AND active=1 LIMIT 1`, coordinator.id);
    current = { id: other.id, email: other.email };
    view = await (await list()).json();
    assert.ok(!view.reports.some((r) => r.id === sent.id));
    assert.match((await (await list("?screenshot=" + sent.id)).json()).error, /not found/);
    // The system owner sees every report and closes it with what was done.
    current = { id: "owner", email: "owner@example.com" };
    view = await (await list()).json();
    assert.equal(view.admin, true);
    assert.ok(view.reports.some((r) => r.id === sent.id));
    assert.match((await update({ id: sent.id, status: "Resolved" })).error, /what was done/);
    assert.equal((await update({ id: sent.id, status: "Resolved", resolution: "Saved marks now persist." })).error, undefined);
    assert.equal((await dbRow("SELECT status FROM support_reports WHERE id=?", sent.id)).status, "Resolved");
    // Demo sign-ins cannot send reports.
    const demo = await dbRow("SELECT id,email FROM users WHERE id LIKE 'DEMO-%' AND active=1 LIMIT 1");
    if (demo) {
      current = { id: demo.id, email: demo.email };
      assert.match((await report(base)).error, /not available in the demo/);
    }
  } finally {
    globalThis.__testEnv.BUCKET = previous;
    current = { id: "owner", email: "owner@example.com" };
  }
});

test("a demo reset lets the same demo link be reviewed again", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await check("demo_refresh");
  current = { id: "demo-auth-qc", email: "demo.qc@example.com" };
  await check("service_qc_review", { service_id: "DEMO-S01-LNK-1", decision: "Lock", comment: "" });
  current = { id: "owner", email: "owner@example.com" };
  await check("demo_refresh");
  const link = await dbRow("SELECT qc_status, revision FROM service_links WHERE id='DEMO-S01-LNK-1'");
  assert.equal(link.qc_status, "Pending");
  assert.ok(Number(link.revision) >= 2, "the reset link starts after its last reviewed revision");
  current = { id: "demo-auth-qc", email: "demo.qc@example.com" };
  await check("service_qc_review", { service_id: "DEMO-S01-LNK-1", decision: "Lock", comment: "" });
  current = { id: "owner", email: "owner@example.com" };
});

test("a demo supervisor assigns demo accounts only", async () => {
  current = { id: "owner", email: "owner@example.com" };
  await check("demo_refresh");
  current = { id: "demo-auth-sup", email: "demo.supervisor@example.com" };
  await check("account_coordinator", { id: "DEMO-ACC-2", account_ids: ["DEMO-ACC-2"], coordinator_id: "DEMO-COORD" });
  assert.equal((await dbRow("SELECT coordinator_id FROM accounts WHERE id='DEMO-ACC-2'")).coordinator_id, "DEMO-COORD");
  await check("account_coordinator", { id: "", account_ids: ["DEMO-ACC-2", "DEMO-ACC-3"], coordinator_id: "DEMO-COORD" });
  await dbExec("INSERT INTO accounts(id,platform,label,status,credits) VALUES('ACC-REAL-X','Kafeel','real@example.com','Available',0) ON CONFLICT(id) DO NOTHING");
  assert.match((await post("account_coordinator", { id: "", account_ids: ["DEMO-ACC-2", "ACC-REAL-X"], coordinator_id: "DEMO-COORD" })).error, /demo/i);
  assert.equal((await dbRow("SELECT coordinator_id FROM accounts WHERE id='ACC-REAL-X'")).coordinator_id, null);
  current = { id: "owner", email: "owner@example.com" };
});

test("the dashboard is for administrators, without national IDs or demo records", async () => {
  const dashboard = await route("dashboard");
  current = { id: "owner", email: "owner@example.com" };
  await check("demo_refresh");
  const res = await dashboard.GET();
  const body = await res.json();
  assert.equal(body.error, undefined, body.error);
  for (const key of ["staff", "groups", "students", "sessions", "attendance", "contacts", "tasks", "cases", "links", "reviews", "feedback", "accounts", "audit"])
    assert.ok(Array.isArray(body[key]), key);
  assert.ok(body.students.length > 0);
  const text = JSON.stringify(body);
  assert.ok(!/national_id|"phone"|"secret"|"password"/.test(text), "no national IDs, phones or secrets");
  assert.ok(!body.groups.some((g) => g.id.startsWith("DEMO-")) && !body.staff.some((p) => p.id.startsWith("DEMO-")), "no demo records");
  assert.ok(body.audit.every((e) => !("previous" in e) && !("value" in e)), "only who did what and when");
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  assert.equal((await dashboard.GET()).status, 403);
  current = { id: "demo-auth-po", email: "demo.projectops@example.com" };
  assert.equal((await dashboard.GET()).status, 403);
  current = { id: "owner", email: "owner@example.com" };
});

test("the Target Team posts job opportunities, which a track's students and the Target Team's leaders see", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const api2 = await route("opportunities");
  const get = async () => (await api2.GET()).json();
  const send = async (body) =>
    (await api2.POST(new Request("https://test.local/api/opportunities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).json();
  const group = await dbRow(
    "SELECT g.id,g.track,u.id uid,u.email,u.team FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND EXISTS (SELECT 1 FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active' AND s.email IS NOT NULL) ORDER BY g.id LIMIT 1",
  );
  const other = await dbRow("SELECT s.id,s.email FROM students s JOIN groups g ON g.id=s.group_id WHERE g.track<>? AND s.lifecycle='Active' AND s.email IS NOT NULL AND g.id NOT LIKE 'DEMO-%' LIMIT 1", group.track);
  const learner = await dbRow("SELECT id,email FROM students WHERE group_id=? AND lifecycle='Active' AND email IS NOT NULL LIMIT 1", group.id);
  const job = { action: "post", url: "https://khamsat.com/community/requests/123", title: "Logo for a coffee shop", track: group.track, platform: "Khamsat", posted_on: new Date().toISOString().slice(0, 10) };
  try {
    // A coordinator outside the Target Team reads nothing and posts nothing.
    await dbExec("UPDATE users SET team='Service Team' WHERE id=?", group.uid);
    current = { id: group.uid, email: group.email };
    assert.match((await get()).error, /Target Team/);
    assert.match((await send(job)).error, /Target Team/);
    // On the Target Team they post, with a real link, a known track and a date that has come.
    await dbExec("UPDATE users SET team='Target Team' WHERE id=?", group.uid);
    assert.match((await send({ ...job, url: "http://khamsat.com/x" })).error, /https/);
    assert.match((await send({ ...job, track: "No such track" })).error, /track/);
    assert.match((await send({ ...job, posted_on: "2999-01-01" })).error, /future/);
    const made = await send(job);
    assert.equal(made.error, undefined, made.error);
    assert.match((await send(job)).error, /already posted/);
    const mine = await get();
    assert.equal(mine.posts, true);
    assert.ok(mine.opportunities.some((o) => o.id === made.id));
    // A student of that track sees it; a student of another track does not.
    current = { id: learner.id, email: learner.email };
    const theirs = await get();
    assert.ok(theirs.opportunities.some((o) => o.id === made.id && o.platform === "Khamsat"));
    assert.ok(!("created_by" in theirs.opportunities[0]), "students are not told who posted it");
    assert.match((await send(job)).error, /staff workspace/);
    if (other) {
      current = { id: other.id, email: other.email };
      assert.ok(!(await get()).opportunities.some((o) => o.id === made.id));
    }
    // Any supervisor (here on the Service Team) sees every post, posts too
    // and removes one, which then leaves the student's page. A coach posts.
    const supervisor = await dbRow(`SELECT id,email,team FROM users WHERE roles LIKE '%Team Supervisor%' AND roles NOT LIKE '%Admin%' AND roles NOT LIKE '%Project Operations%' AND id NOT LIKE 'DEMO-%' AND active=1 LIMIT 1`);
    try {
      current = { id: supervisor.id, email: supervisor.email };
      await dbExec("UPDATE users SET team='Service Team' WHERE id=?", supervisor.id);
      const all = await get();
      assert.equal(all.posts, true);
      assert.equal(all.leads, true);
      assert.ok(all.opportunities.some((o) => o.id === made.id));
      assert.equal((await send({ action: "remove", id: made.id })).error, undefined);
      current = { id: learner.id, email: learner.email };
      assert.ok(!(await get()).opportunities.some((o) => o.id === made.id));
      const coach = await dbRow(`SELECT id,email FROM users WHERE roles LIKE '%"Coach"%' AND roles NOT LIKE '%Admin%' AND active=1 LIMIT 1`);
      current = { id: coach.id, email: coach.email };
      const posted = await send({ ...job, url: "https://khamsat.com/community/requests/456", title: "Banner for a bakery" });
      assert.equal(posted.error, undefined, posted.error);
    } finally {
      await dbExec("UPDATE users SET team=? WHERE id=?", supervisor.team, supervisor.id);
    }
  } finally {
    current = { id: "owner", email: "owner@example.com" };
    await dbExec("UPDATE users SET team=? WHERE id=?", group.team, group.uid);
  }
});

test("session feedback goes at random to the quality team, who read the results student by student, and their notes reach Coach and Project Operations", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const reviewApi = await route("feedback-review");
  const get = async () => (await reviewApi.GET()).json();
  const send = async (body) =>
    (await reviewApi.POST(new Request("https://test.local/api/feedback-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).json();
  // A second Quality Member, so the work can be shared.
  await dbExec(
    "INSERT INTO users(id,email,name,roles,scopes,active,national_id,phone,title) VALUES(?,?,?,?,?,?,?,?,?)",
    "staff-quality-2", "staff-quality-2@example.invalid", "Second Reviewer", JSON.stringify(["Quality Member"]), "[]", 1, "29801011234561", null, "Quality Member",
  );
  const group = await dbRow(
    "SELECT g.id FROM groups g WHERE g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND (SELECT count(*) FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active')>=2 AND g.id NOT IN (SELECT group_id FROM sessions WHERE week=5) ORDER BY g.id LIMIT 1",
  );
  await check("session", { id: "SES-FR-1", group_id: group.id, title: "Week 5 coaching", starts_at: new Date(Date.now() - 5 * 3600000).toISOString(), week: 5, duration_minutes: 180 });
  const learners = await dbRows("SELECT id FROM students WHERE group_id=? AND lifecycle='Active' ORDER BY id LIMIT 2", group.id);
  for (const [i, l] of learners.entries())
    await dbExec(
      "INSERT INTO session_feedback(id,session_id,student_id,satisfaction,clarity,searched_gig,usefulness,liked,comments,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      `SFB-FR-${i}`, "SES-FR-1", l.id, 5 - i, 4, i, 4, i ? null : "The examples", null, new Date().toISOString(),
    );

  // The lead's first look gives every session with feedback to a member, evenly.
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  const lead = await get();
  assert.equal(lead.error, undefined, lead.error);
  assert.ok(lead.lead);
  const withFeedback = (await dbRows("SELECT DISTINCT f.session_id FROM session_feedback f JOIN sessions t ON t.id=f.session_id WHERE t.group_id NOT LIKE 'DEMO-%'")).length;
  assert.equal(lead.sessions.length, withFeedback, "every session with feedback is given out");
  const load = await dbRows(
    "SELECT u.id,u.roles,(SELECT count(*) FROM feedback_reviews r WHERE r.reviewer=u.id) n FROM users u WHERE u.active=1 AND u.id NOT LIKE 'DEMO-%' AND (u.roles LIKE '%Quality Member%' OR EXISTS (SELECT 1 FROM feedback_reviews r WHERE r.reviewer=u.id))",
  );
  assert.ok(load.filter((r) => r.n > 0).every((r) => JSON.parse(r.roles).includes("Quality Member")), "only Quality Members review");
  assert.ok(Math.max(...load.map((r) => r.n)) - Math.min(...load.map((r) => r.n)) <= 1, "and evenly");
  const mine = lead.sessions.find((s) => s.id === "SES-FR-1");
  assert.ok(mine && mine.week === 5 && mine.starts_at && "coach_name" in mine);
  // The quality team reads each response with the student who gave it, but never their national ID.
  assert.ok(!/national_id/.test(JSON.stringify(lead.responses)), "no national ID");
  const answered = lead.responses.filter((r) => r.session_id === "SES-FR-1");
  assert.equal(answered.length, 2);
  const names = new Map((await dbRows("SELECT id,name FROM students WHERE id IN (?,?)", learners[0].id, learners[1].id)).map((s) => [s.id, s.name]));
  assert.deepEqual(answered.map((r) => r.student_id).sort(), learners.map((l) => l.id).sort(), "reviewers see who answered");
  assert.ok(answered.every((r) => r.student_name === names.get(r.student_id)), "with the student's name");

  // A member sees only their own; another member's is not theirs to review.
  const owner = (await dbRow("SELECT reviewer FROM feedback_reviews WHERE session_id='SES-FR-1'")).reviewer;
  const other = owner === "staff-quality" ? "staff-quality-2" : "staff-quality";
  current = { id: other, email: other + "@example.invalid" };
  const theirs = await get();
  assert.ok(theirs.sessions.every((s) => s.reviewer === other) && !theirs.sessions.some((s) => s.id === "SES-FR-1"));
  assert.ok(theirs.responses.every((r) => "student_id" in r && "student_name" in r), "a member sees the students of their sessions too");
  assert.match((await send({ action: "review", session_id: "SES-FR-1", note: "x" })).error, /reviewer it was given to/);
  assert.match((await send({ action: "reassign", session_id: "SES-FR-1", reviewer: other })).error, /Quality Lead/);
  current = { id: owner, email: owner + "@example.invalid" };
  assert.equal((await send({ action: "review", session_id: "SES-FR-1", note: "Students liked the examples." })).ok, true);
  const done = await dbRow("SELECT * FROM feedback_reviews WHERE session_id='SES-FR-1'");
  assert.equal(done.status, "Reviewed");
  assert.equal(done.note, "Students liked the examples.");

  // The lead hands it to someone else, which opens it again for them, and can share the pending ones out again.
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  assert.equal((await send({ action: "reassign", session_id: "SES-FR-1", reviewer: other })).ok, true);
  const moved = await dbRow("SELECT * FROM feedback_reviews WHERE session_id='SES-FR-1'");
  assert.equal(moved.reviewer, other);
  assert.equal(moved.status, "Pending");
  assert.equal((await send({ action: "reassign", session_id: "SES-FR-1", reviewer: "staff-sara" })).error, "Choose an active Quality Member.");
  assert.equal((await send({ action: "redistribute" })).ok, true);

  // A coach reads their own sessions' feedback, read-only, without reviewers, notes or students.
  const led = await dbRow("SELECT coalesce(t.coach_id,g.coach) coach FROM sessions t JOIN groups g ON g.id=t.group_id WHERE t.id='SES-FR-1'");
  if (!led.coach || led.coach === "system-unassigned-coach") await dbExec("UPDATE sessions SET coach_id='staff-coach' WHERE id='SES-FR-1'");
  const coachId = led.coach && led.coach !== "system-unassigned-coach" ? led.coach : "staff-coach";
  const coachUser = await dbRow("SELECT id,email FROM users WHERE id=?", coachId);
  current = { id: coachUser.id, email: coachUser.email };
  const own = await get();
  assert.equal(own.error, undefined, own.error);
  assert.ok(own.coach);
  assert.ok(own.sessions.some((s) => s.id === "SES-FR-1"), "the coach sees the session they led");
  assert.ok(own.sessions.every((s) => s.coach_id === coachUser.id), "and only their own");
  assert.ok(!/reviewer|"note"|student_id|student_name/.test(JSON.stringify(own)), "no reviewer, note or student: " + JSON.stringify(own).match(/.{40}(reviewer|"note"|student_id|student_name).{40}/)?.[0]);
  assert.match((await send({ action: "review", session_id: "SES-FR-1", note: "Mine" })).error, /role/, "a coach cannot change anything");

  // The quality note reaches Coach Operations and Project Operations on their feedback page,
  // with the reviewer and the state; the group's coordinator does not get it.
  const feedbackApi = await route("feedback");
  const feedback = async () => (await feedbackApi.GET(new Request("https://test.local/api/feedback"))).json();
  const reviewer = await dbRow("SELECT r.reviewer,u.name FROM feedback_reviews r JOIN users u ON u.id=r.reviewer WHERE r.session_id='SES-FR-1'");
  current = { id: "staff-coach-ops", email: "staff-coach-ops@example.invalid" };
  const ops = await feedback();
  assert.equal(ops.error, undefined, ops.error);
  assert.equal(ops.quality, true);
  const seen = ops.reviews.find((r) => r.session_id === "SES-FR-1");
  assert.equal(seen?.note, "Students liked the examples.", "Coach Operations reads the quality note");
  assert.equal(seen.status, "Pending", "and that it was opened again");
  assert.equal(seen.reviewer, reviewer.reviewer);
  assert.equal(seen.reviewer_name, reviewer.name);
  assert.ok(ops.responses.some((r) => r.session_id === "SES-FR-1" && r.student_name), "and the students who answered");
  const projectOps = await dbRow("SELECT id,email FROM users WHERE roles LIKE '%Project Operations%' AND roles NOT LIKE '%Admin%' AND active=1 AND id NOT LIKE 'DEMO-%' LIMIT 1");
  if (projectOps) {
    current = { id: projectOps.id, email: projectOps.email };
    const project = await feedback();
    assert.equal(project.error, undefined, project.error);
    assert.equal(project.reviews.find((r) => r.session_id === "SES-FR-1")?.note, "Students liked the examples.", "Project Operations reads it too");
  }
  const runner = await dbRow("SELECT u.id,u.email,u.roles FROM groups g JOIN users u ON u.id=g.coordinator WHERE g.id=?", group.id);
  if (runner && !/Coach Operations|Project Operations|Admin/.test(runner.roles)) {
    current = { id: runner.id, email: runner.email };
    const theirView = await feedback();
    assert.equal(theirView.error, undefined, theirView.error);
    assert.ok(theirView.sessions.some((s) => s.id === "SES-FR-1"), "the coordinator reads their group's feedback");
    assert.ok(!("reviews" in theirView) && !("quality" in theirView), "but not the quality review");
    assert.ok(!JSON.stringify(theirView).includes("Students liked the examples."));
  }

  // The people who run groups have their own feedback page; this one is the quality team's.
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  assert.match((await get()).error, /role/);
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM feedback_reviews WHERE reviewer='staff-quality-2'");
  await dbExec("UPDATE users SET active=0 WHERE id='staff-quality-2'");
});

test("a revoked student disappears for everyone but administrators and the account-owner keeper, and comes back on restore", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const pupil = await dbRow(
    "SELECT s.id,s.lifecycle,g.coordinator,u.email FROM students s JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=g.coordinator WHERE s.lifecycle='Active' AND g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.student_id=s.id) ORDER BY s.id LIMIT 1",
  );
  const created = new Date().toISOString();
  await dbExec(
    "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,account_id,submitted_at,updated_at) VALUES(?,?,3,?,?,'Khamsat','Needs Review','{}',?,'Pending',NULL,'staff-quality',NULL,1,NULL,?,?)",
    "SLK-REVOKE", pupil.id, "https://khamsat.com/x/7001-r", "https://khamsat.com/x/7001-r", created, created, created,
  );
  const sees = async (who) => {
    current = who;
    const view = await (await api.GET()).json();
    return view.students.some((s) => s.id === pupil.id);
  };
  const coordinator = { id: pupil.coordinator, email: pupil.email };
  const quality = { id: "quality-login", email: "staff-quality@example.invalid" };
  assert.ok(await sees(coordinator));
  assert.ok(await sees(quality), "the reviewer holding their service sees them");

  // Only administrators and the account-owner keeper revoke.
  current = coordinator;
  assert.match((await post("student_revoke", { student_id: pupil.id, reason: "Left the programme" })).error, /administrator|account-owner/);
  await dbExec("UPDATE users SET scopes=? WHERE id='staff-nour'", JSON.stringify(["account-owner"]));
  current = { id: "staff-nour", email: "staff-nour@example.invalid" };
  assert.match((await post("student_revoke", { student_id: pupil.id, reason: "x" })).error, /Say why/);
  await check("student_revoke", { student_id: pupil.id, reason: "Duplicate registration" });
  assert.equal((await dbRow("SELECT lifecycle FROM students WHERE id=?", pupil.id)).lifecycle, "Revoked");
  assert.equal((await dbRow("SELECT qc_actor FROM service_links WHERE id='SLK-REVOKE'")).qc_actor, null, "their review goes back to the pool");
  assert.ok(await sees({ id: "staff-nour", email: "staff-nour@example.invalid" }), "the keeper still sees them, to restore them");
  assert.ok(await sees({ id: "owner", email: "owner@example.com" }), "and so do administrators");
  assert.ok(!(await sees(coordinator)), "the coordinator no longer sees them");
  current = coordinator;
  assert.match((await post("contact", { student_id: pupil.id, channel: "WhatsApp", outcome: "Responded", occurred_at: created, notes: "x" })).error, /not found/i);
  assert.ok(!(await sees({ id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" })), "nor does the quality team");
  const lead = await (await api.GET()).json();
  assert.ok(Array.isArray(lead.serviceLinks) && !lead.serviceLinks.some((l) => l.student_id === pupil.id), "their links leave the quality queue");

  // Restoring brings them back as they were.
  current = { id: "owner", email: "owner@example.com" };
  await check("student_revoke", { student_id: pupil.id, restore: true, reason: "Registration confirmed" });
  assert.equal((await dbRow("SELECT lifecycle FROM students WHERE id=?", pupil.id)).lifecycle, pupil.lifecycle);
  assert.ok(await sees(coordinator));
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("UPDATE users SET scopes='[]' WHERE id='staff-nour'");
  await dbExec("DELETE FROM service_links WHERE id='SLK-REVOKE'");
});

test("an administrator sends a student's service links for them, through the student's own checks", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const servicesApi = await route("student-services");
  const call = (body) =>
    servicesApi.POST(new Request("https://test.local/api/student-services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const pupil = await dbRow(
    "SELECT s.id,g.coordinator,u.email FROM students s JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=g.coordinator WHERE s.lifecycle='Active' AND g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.student_id=s.id) ORDER BY s.id DESC LIMIT 1",
  );
  const links = [
    "https://kafiil.com/service/880001-" + encodeURIComponent("تصميم-واجهات-مستخدم-uiux"),
    "https://nafezly.com/service/880002-" + encodeURIComponent("تحليل-وإعادة-تصميم-UIUX-Audit---Redesign"),
    "https://nafezly.com/service/880003-" + encodeURIComponent("بحث-UX-شامل"),
  ];
  current = { id: pupil.coordinator, email: pupil.email };
  assert.match((await (await call({ action: "submit_services", student_id: pupil.id, services: links })).json()).error, /role/, "only an administrator");
  current = { id: "owner", email: "owner@example.com" };
  const first = await (await call({ action: "submit_services", student_id: pupil.id, services: links.slice(0, 2).concat(links[2]) })).json();
  assert.equal(first.error, undefined, first.error);
  const saved = await dbRows("SELECT slot,platform,qc_status,qc_actor FROM service_links WHERE student_id=? ORDER BY slot", pupil.id);
  assert.deepEqual(saved.map((r) => r.platform), ["Kafiil", "Nafezly", "Nafezly"]);
  assert.ok(saved.every((r) => r.qc_status === "Pending" && r.qc_actor), "pending and given to a reviewer");
  const audit = await dbRow("SELECT actor,action FROM audit_events WHERE entity_id=? ORDER BY created_at DESC LIMIT 1", pupil.id);
  assert.equal(audit.actor, "owner");
  assert.equal(audit.action, "Service links submitted for a student");
  // A further link adds to the ones already in, which stay where they are.
  const more = await (await call({ action: "submit_services", student_id: pupil.id, services: ["https://khamsat.com/designing/logo/880004-" + encodeURIComponent("شعار")] })).json();
  assert.equal(more.error, undefined, more.error);
  assert.equal((await dbRows("SELECT id FROM service_links WHERE student_id=?", pupil.id)).length, 4);
  await dbExec("DELETE FROM service_links WHERE student_id=?", pupil.id);
  await dbExec("DELETE FROM service_submissions WHERE student_id=?", pupil.id);
});

test("coach availability: Coach Operations sees every coach with free and booked hours, and records free hours", async () => {
  await dbExec("DELETE FROM rate_limits");
  const api = await route("coach-availability");
  const get = async () => (await api.GET()).json();
  const send = async (body) =>
    (await api.POST(new Request("https://test.local/api/coach-availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).json();
  // A coach with an upcoming 7 PM (Cairo) session on a known weekday.
  const group = await dbRow("SELECT id FROM groups WHERE status='Active' AND id NOT LIKE 'DEMO-%' AND id NOT IN (SELECT group_id FROM sessions WHERE week=9) ORDER BY id LIMIT 1");
  let day = "";
  for (let n = 3; !day; n++) {
    const d = new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    if (!(await dbRow("SELECT 1 FROM sessions WHERE coach_id='staff-coach' AND session_day=? AND status<>'Cancelled'", d))) day = d;
  }
  await dbExec(
    "INSERT INTO sessions(id,group_id,coach_id,title,starts_at,session_day,duration_minutes,status,week) VALUES(?,?,?,?,?,?,?,?,?)",
    "SES-CA-1", group.id, "staff-coach", "Week 9", day + "T16:00:00.000Z", day, 180, "Scheduled", 9,
  );
  const weekday = new Date(day + "T16:00:00.000Z").toLocaleDateString("en-US", { timeZone: "Africa/Cairo", weekday: "short" });

  current = { id: "coach-ops-login", email: "staff-coach-ops@example.invalid" };
  const first = await get();
  assert.equal(first.error, undefined, first.error);
  const coach = first.coaches.find((c) => c.id === "staff-coach");
  assert.ok(coach, "every coach is listed");
  assert.ok(!first.coaches.some((c) => c.id.startsWith("system-unassigned")), "not the placeholder coach");
  assert.ok(!/national_id/.test(JSON.stringify(first)), "no national IDs");
  const s = coach.sessions.find((x) => x.group_id === group.id && x.day === weekday);
  assert.ok(s, "the upcoming session is in the coach's week");
  // 16:00 UTC is 19:00 in Cairo in summer and 18:00 once Egypt's summer time ends.
  const hour = Number(new Date(day + "T16:00:00.000Z").toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hour12: false }));
  assert.equal(s.time, `${hour}:00`);
  assert.deepEqual(s.keys, [`${weekday}-${hour}`, `${weekday}-${hour + 1}`, `${weekday}-${hour + 2}`]);

  // Free hours are recorded, cleaned of anything outside the grid, and audited.
  const saved = await send({ action: "save", user_id: "staff-coach", slots: ["Sat-17", "Sat-18", "Sat-17", "Xyz-3", "Sun-30"], note: "Prefers evenings" });
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(saved.slots, ["Sat-17", "Sat-18"]);
  const again = (await get()).coaches.find((c) => c.id === "staff-coach");
  assert.deepEqual(again.declared, ["Sat-17", "Sat-18"]);
  assert.equal(again.note, "Prefers evenings");
  assert.ok(await dbRow("SELECT 1 FROM audit_events WHERE action='Coach availability saved' AND entity_id='staff-coach'"));
  assert.equal((await send({ action: "save", user_id: "staff-coach-ops", slots: [] })).error, "Choose a coach.");
  assert.equal((await send({ action: "clear", user_id: "staff-coach" })).ok, true);
  assert.equal((await get()).coaches.find((c) => c.id === "staff-coach").declared, null);

  // Coaches and coordinators do not open it.
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  assert.match((await get()).error, /role/);
  assert.match((await send({ action: "save", user_id: "staff-coach", slots: [] })).error, /role/);
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM sessions WHERE id='SES-CA-1'");
});

test("portal gigs waiting for the coach go to the quality team, whose verdict the coach and coordinator read", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const portal = await route("portal");
  const qc = await route("portal-qc");
  const upload = async (sheet, mapping, rows) => {
    const post = async (body) =>
      (await portal.POST(new Request("https://test.local/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).json();
    const begun = await post({ action: "begin", sheet, mapping, total: rows.length, file_name: sheet + ".xlsx" });
    assert.ok(begun.batch, JSON.stringify(begun));
    assert.equal((await post({ action: "chunk", batch: begun.batch, rows })).error, undefined);
    const done = await post({ action: "commit", batch: begun.batch });
    assert.equal(done.error, undefined, done.error);
  };
  const get = async () => (await qc.GET()).json();
  const send = async (body) =>
    (await qc.POST(new Request("https://test.local/api/portal-qc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).json();
  const ours = await dbRow(
    `SELECT s.id,s.email,g.coordinator,g.coach FROM students s JOIN groups g ON g.id=s.group_id
     WHERE s.email IS NOT NULL AND s.lifecycle='Active' AND g.status='Active' AND g.id NOT LIKE 'DEMO-%'
       AND coalesce(g.delivery_model,'Regular')<>'Industry' AND g.coach IS NOT NULL AND g.coach<>'system-unassigned-coach' ORDER BY s.id LIMIT 1`,
  );
  assert.ok(ours, "a coached student to link");
  await dbExec(
    "INSERT INTO users(id,email,name,roles,scopes,active,national_id,phone,title) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=1",
    "staff-quality-2", "staff-quality-2@example.invalid", "Second Reviewer", JSON.stringify(["Quality Member"]), "[]", 1, "29801011234561", null, "Quality Member",
  );
  await upload("students", { ID: "portal_id", Email: "email", "Full Name": "full_name" }, [
    { portal_id: "PQ-1", email: ours.email, full_name: "Linked student" },
    { portal_id: "PQ-2", email: "portal-only-qc@example.org", full_name: "Portal only" },
  ]);
  const gigMapping = { ID: "portal_gig_id", "Student ID": "portal_student_id", Title: "title", URL: "url", Status: "status", "Provider Status": "provider_status" };
  const gigRows = [
    { portal_gig_id: "QG-1", portal_student_id: "PQ-1", title: "Logo", url: "https://example.org/1", status: "Pending", provider_status: "Pending" },
    { portal_gig_id: "QG-2", portal_student_id: "PQ-1", title: "Banner", url: "https://example.org/2", status: "Pending", provider_status: "Pending" },
    { portal_gig_id: "QG-3", portal_student_id: "PQ-1", title: "Already decided", status: "Approved", provider_status: "Approved" },
    { portal_gig_id: "QG-4", portal_student_id: "PQ-2", title: "Deck", status: "Pending", provider_status: "" },
  ];
  await upload("gigs", gigMapping, gigRows);

  // The lead's look hands out only what waits for the coach, a student's gigs to one member.
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  const lead = await get();
  assert.equal(lead.error, undefined, lead.error);
  assert.ok(lead.lead);
  assert.deepEqual(lead.reviews.map((r) => r.portal_gig_id).sort(), ["QG-1", "QG-2", "QG-4"], "the coach's decided gig is not queued");
  const rows = await dbRows("SELECT * FROM portal_gig_reviews ORDER BY portal_gig_id");
  assert.equal(rows[0].reviewer, rows[1].reviewer, "one student's gigs stay together");
  assert.equal(rows[0].student_id, ours.id);
  for (const r of rows) {
    const roles = JSON.parse((await dbRow("SELECT roles FROM users WHERE id=?", r.reviewer)).roles);
    assert.ok(roles.includes("Quality Member") && !roles.includes("Quality Lead"), "only Quality Members, not the lead");
  }
  const owner = rows[0].reviewer;
  const other = lead.reviewers.find((p) => p.id !== owner).id;

  // Only the member it was given to decides; a rejection needs its reason.
  current = { id: other, email: other + "@example.invalid" };
  assert.ok((await get()).reviews.every((r) => r.reviewer === other));
  assert.match((await send({ action: "decide", portal_gig_id: "QG-1", status: "Approved" })).error, /reviewer it was given to/);
  current = { id: owner, email: owner + "@example.invalid" };
  assert.match((await send({ action: "decide", portal_gig_id: "QG-1", status: "Rejected" })).error, /why the gig is rejected/);
  assert.equal((await send({ action: "decide", portal_gig_id: "QG-1", status: "Rejected", comment: "The link shows another seller." })).ok, true);
  assert.equal((await send({ action: "decide", portal_gig_id: "QG-2", status: "Approved" })).ok, true);
  assert.match((await send({ action: "redistribute" })).error, /Quality Lead/);

  // A new upload of the same sheet keeps the verdicts with their gigs.
  current = { id: "owner", email: "owner@example.com" };
  await upload("gigs", gigMapping, gigRows);
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  assert.equal((await get()).reviews.length, 3);
  assert.equal((await dbRow("SELECT status FROM portal_gig_reviews WHERE portal_gig_id='QG-1'")).status, "Rejected");

  // The coordinator and the coach read the verdict.
  const coordinator = await dbRow("SELECT id,email FROM users WHERE id=?", ours.coordinator);
  current = { id: coordinator.id, email: coordinator.email };
  const theirs = (await portal.GET(new Request("https://test.local/api/portal?student=PQ-1")).then((r) => r.json())).gigs;
  assert.equal(theirs.find((g) => g.portal_gig_id === "QG-1").qc_status, "Rejected");
  assert.equal(theirs.find((g) => g.portal_gig_id === "QG-1").qc_comment, "The link shows another seller.");
  assert.match((await get()).error, /role/, "the queue itself is the quality team's");
  const coach = await dbRow("SELECT id,email FROM users WHERE id=?", ours.coach);
  current = { id: coach.id, email: coach.email };
  const progress = await (await route("coach-progress")).GET().then((r) => r.json());
  assert.equal(progress.error, undefined, progress.error);
  const pupil = progress.students.find((s) => s.id === ours.id);
  assert.equal(pupil.portal.gigs.find((g) => g.id === "QG-2").qc_status, "Approved");

  // The lead moves the whole student, then shares the pending ones out again.
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  assert.equal((await send({ action: "decide", portal_gig_id: "QG-2", status: "Pending" })).ok, true);
  assert.equal((await send({ action: "reassign", portal_gig_id: "QG-2", reviewer: other })).ok, true);
  assert.equal((await dbRow("SELECT reviewer FROM portal_gig_reviews WHERE portal_gig_id='QG-2'")).reviewer, other);
  assert.equal((await send({ action: "reassign", portal_gig_id: "QG-2", reviewer: "staff-quality-lead" })).error, "Choose an active Quality Member.");
  assert.equal((await send({ action: "redistribute" })).ok, true);

  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM portal_gig_reviews");
  await dbExec("UPDATE users SET active=0 WHERE id='staff-quality-2'");
});


test("a service link sent back is the coordinator's task until approved, and each approved service earns a locked client account, two at most", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const group = await dbRow(
    `SELECT g.id,g.supervisor,g.coordinator,u.email FROM groups g JOIN users u ON u.id=g.coordinator
     WHERE g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND coalesce(g.delivery_model,'Regular')<>'Industry'
       AND EXISTS (SELECT 1 FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active'
         AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.student_id=s.id)
         AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.student_id=s.id)) ORDER BY g.id LIMIT 1`,
  );
  const learner = await dbRow(
    "SELECT s.id FROM students s WHERE s.group_id=? AND s.lifecycle='Active' AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.student_id=s.id) ORDER BY s.id LIMIT 1",
    group.id,
  );
  const team = (await dbRow("SELECT team FROM users WHERE id=?", group.supervisor)).team;
  await dbExec("UPDATE users SET team='Service Team' WHERE id=?", group.supervisor);
  const at = new Date().toISOString();
  for (const [i, id] of ["SLK-KEY-1", "SLK-KEY-2", "SLK-KEY-3"].entries())
    await dbExec(
      "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,account_id,submitted_at,updated_at) VALUES(?,?,?,?,?,'Kafiil','Needs Review','{}',?,'Pending',NULL,'staff-quality',NULL,1,NULL,?,?)",
      id, learner.id, i + 1, `https://kafiil.com/kafiil/service/key-${i}`, `kafiil.com/kafiil/service/key-${i}`, at, at, at,
    );
  // The account with the most credit is chosen first; an empty one only when none with credit is free.
  await check("account", { id: "ACC-KEY-EMPTY", label: "empty-key@example.org", platform: "Kafeel", credits: 0 });
  await check("account", { id: "ACC-KEY-1", label: "key-one@example.org", platform: "Kafeel", credits: 99999 });

  // The quality team sends a link back: the coordinator gets a task.
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  await check("service_qc_review", { service_id: "SLK-KEY-1", decision: "Needs Correction", comment: "The price is missing." });
  const first = await dbRow("SELECT * FROM tasks WHERE source='service-fix:SLK-KEY-1:1'");
  assert.equal(first.owner, group.coordinator);
  assert.equal(first.category, "Service correction");
  assert.equal(first.status, "Open");
  assert.match(first.title, /The price is missing\./);

  // The coordinator records contacting the student; the task stays open.
  current = { id: group.coordinator, email: group.email };
  assert.match((await post("complete_task", { id: first.id })).error, /closes by itself/);
  assert.match((await post("task_progress", { id: first.id, status: "Done" })).error, /where you are/);
  await check("task_progress", { id: first.id, status: "Contacted the student", note: "Sent on WhatsApp" });
  const mine = (await (await api.GET()).json()).tasks.find((x) => x.id === first.id);
  assert.equal(mine.progress.status, "Contacted the student");
  assert.equal((await dbRow("SELECT status FROM tasks WHERE id=?", first.id)).status, "Open");

  // The student corrects it and it is sent back again: the old task gives way to a new one.
  await dbExec("UPDATE service_links SET revision=2,qc_status='Pending',qc_comment=NULL WHERE id='SLK-KEY-1'");
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  await check("service_qc_review", { service_id: "SLK-KEY-1", decision: "Needs Correction", comment: "Still no price." });
  assert.equal((await dbRow("SELECT status FROM tasks WHERE id=?", first.id)).status, "Closed");
  assert.equal((await dbRow("SELECT status FROM tasks WHERE source='service-fix:SLK-KEY-1:2'")).status, "Open");

  // Each approved service earns an account on its marketplace, two at most.
  current = { id: "owner", email: "owner@example.com" };
  await check("account", { id: "ACC-KEY-2", label: "key-two@example.org", platform: "Kafeel", credits: 99998 });
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  await check("service_qc_review", { service_id: "SLK-KEY-2", decision: "Lock" });
  let held = await dbRows("SELECT * FROM accounts WHERE student_id=? ORDER BY linked_at,id", learner.id);
  assert.equal(held.length, 1, "one approved service, one account");
  assert.deepEqual([held[0].id, held[0].service_link_id], ["ACC-KEY-1", "SLK-KEY-2"], "the most credit, for that service");
  assert.equal(held[0].coordinator_id, group.coordinator, "the student's coordinator holds it");
  assert.equal(held[0].linked_by, null, "linked by the app");
  assert.ok(await dbRow("SELECT id FROM notifications WHERE recipient=? AND source=?", group.coordinator, "account-key:ACC-KEY-1:SLK-KEY-2"));
  await dbExec("UPDATE service_links SET revision=3,qc_status='Pending',qc_comment=NULL WHERE id='SLK-KEY-1'");
  await check("service_qc_review", { service_id: "SLK-KEY-1", decision: "Lock" });
  assert.equal((await dbRow("SELECT count(*) n FROM tasks WHERE source LIKE 'service-fix:SLK-KEY-1:%' AND status='Open'")).n, 0, "approval closes the task");
  current = { id: "owner", email: "owner@example.com" };
  await check("account", { id: "ACC-KEY-3", label: "key-three@example.org", platform: "Kafeel", credits: 99997 });
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  await check("service_qc_review", { service_id: "SLK-KEY-3", decision: "Lock" });
  held = await dbRows("SELECT id,service_link_id FROM accounts WHERE student_id=? ORDER BY id", learner.id);
  assert.deepEqual(held.map((a) => [a.id, a.service_link_id]), [["ACC-KEY-1", "SLK-KEY-2"], ["ACC-KEY-2", "SLK-KEY-1"]], "a third approved service earns no third account");
  assert.equal((await dbRow("SELECT student_id FROM accounts WHERE id='ACC-KEY-3'")).student_id, null);

  // Locked: nobody else reassigns it, and the coordinator gives their word on it.
  current = { id: "owner", email: "owner@example.com" };
  assert.match((await post("account_coordinator", { id: "ACC-KEY-1", account_ids: ["ACC-KEY-1"], coordinator_id: "" })).error, /locked/);
  assert.match((await post("account_assign", { id: "ACC-KEY-3", key_student: learner.id })).error, /allowed to change/);
  current = { id: group.coordinator, email: group.email };
  assert.match((await post("account_state", { id: "ACC-KEY-1", state: "Does not work" })).error, /what is wrong/);
  await check("account_state", { id: "ACC-KEY-1", state: "Does not work", note: "Login asks for a phone code" });
  assert.equal((await dbRow("SELECT coordinator_state FROM accounts WHERE id='ACC-KEY-1'")).coordinator_state, "Does not work");
  assert.match((await post("account_unlock", { id: "ACC-KEY-1", reason: "x" })).error, /allowed to unlock/);

  // The account-unlock holders change and remove assignments; the catch-up links again.
  current = { id: "owner", email: "owner@example.com" };
  assert.match((await post("account_unlock", { id: "ACC-KEY-1", reason: "Broken" })).error, /allowed to unlock/, "not every administrator");
  const scopes = (await dbRow("SELECT scopes FROM users WHERE email='owner@example.com'")).scopes;
  await dbExec("UPDATE users SET scopes=? WHERE email='owner@example.com'", JSON.stringify([...JSON.parse(scopes || "[]"), "account-unlock"]));
  assert.match((await post("account_assign", { id: "ACC-KEY-3", key_student: learner.id })).error, /already has two accounts/);
  await check("account_assign", { id: "ACC-KEY-2", key_student: learner.id, service_link_id: "SLK-KEY-3", coordinator_id: group.coordinator });
  assert.equal((await dbRow("SELECT service_link_id FROM accounts WHERE id='ACC-KEY-2'")).service_link_id, "SLK-KEY-3", "moved to another of their services");
  assert.match((await post("account_unlock", { id: "ACC-KEY-1", reason: "" })).error, /why/);
  await check("account_unlock", { id: "ACC-KEY-1", reason: "Broken login" });
  const freed = await dbRow("SELECT student_id,service_link_id,coordinator_id FROM accounts WHERE id='ACC-KEY-1'");
  assert.deepEqual([freed.student_id, freed.service_link_id], [null, null]);
  assert.equal(freed.coordinator_id, group.coordinator, "the coordinator stays");
  await check("account_status", { id: "ACC-KEY-1", status: "Access Issue", reason: "Broken login" });
  const swept = await check("account_link_sweep", {});
  assert.ok(swept.linked >= 1);
  held = await dbRows("SELECT id,platform,status FROM accounts WHERE student_id=?", learner.id);
  assert.equal(held.length, 2, "back to two");
  assert.ok(held.every((a) => a.id !== "ACC-KEY-1" && a.platform === "Kafeel" && a.status === "Available"));

  await dbExec("UPDATE users SET scopes=? WHERE email='owner@example.com'", scopes);
  await dbExec("UPDATE accounts SET student_id=NULL,service_link_id=NULL,status='Retired' WHERE id IN ('ACC-KEY-1','ACC-KEY-2','ACC-KEY-3','ACC-KEY-EMPTY')");
  await dbExec("UPDATE accounts SET student_id=NULL,service_link_id=NULL WHERE student_id IS NOT NULL");
  await dbExec("UPDATE users SET team=? WHERE id=?", team, group.supervisor);
});


test("the quality team checks each held session's attendance register, which Coach and Project Operations read", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const acApi = await route("attendance-check");
  const get = async (session) =>
    (await acApi.GET(new Request("https://test.local/api/attendance-check" + (session ? "?session=" + session : "")))).json();
  const send = async (body) =>
    (await acApi.POST(new Request("https://test.local/api/attendance-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).json();
  const group = await dbRow(
    "SELECT g.id FROM groups g WHERE g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND coalesce(g.delivery_model,'Regular')<>'Industry' AND (SELECT count(*) FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active')>=3 AND g.id NOT IN (SELECT group_id FROM sessions WHERE week=6) ORDER BY g.id LIMIT 1",
  );
  assert.ok(group, "a group with students");
  await check("session", { id: "SES-AC-1", group_id: group.id, title: "Week 6 coaching", starts_at: new Date(Date.now() - 4 * 3600000).toISOString(), week: 6, duration_minutes: 180 });
  await check("session", { id: "SES-AC-2", group_id: group.id, title: "Week 7 coaching", starts_at: new Date(Date.now() + 72 * 3600000).toISOString(), week: 7, duration_minutes: 180 });
  const learners = await dbRows("SELECT id,name FROM students WHERE group_id=? AND lifecycle='Active' ORDER BY id LIMIT 2", group.id);
  for (const [i, l] of learners.entries())
    await dbExec(
      "INSERT INTO attendance(id,session_id,student_id,status,recorder,source,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status",
      `ATT-AC-${i}`, "SES-AC-1", l.id, i ? "Absent" : "Present", "staff-coach", "manual", new Date().toISOString(),
    );

  // A Quality Member sees held sessions only, with the counts and who recorded them.
  current = { id: "staff-quality", email: "staff-quality@example.invalid" };
  const member = await get();
  assert.equal(member.error, undefined, member.error);
  assert.ok(member.checks && !member.lead);
  const row = member.sessions.find((s) => s.id === "SES-AC-1");
  assert.ok(row, "the held session is listed");
  assert.equal(row.present, 1);
  assert.equal(row.absent, 1);
  assert.equal(row.marked, 2);
  assert.ok(row.enrolled >= 3);
  assert.ok(row.recorded_by.length === 1 && row.recorded_by[0] !== "staff-coach", "the recorder is named");
  assert.equal(row.check_status, null);
  assert.ok(!member.sessions.some((s) => s.id === "SES-AC-2"), "a session that has not started is not checked yet");
  assert.ok(member.sessions.every((s) => !String(s.group_id).startsWith("DEMO-")));

  // Its register names the students, marked and not yet marked.
  const reg = await get("SES-AC-1");
  assert.equal(reg.error, undefined, reg.error);
  for (const l of learners) assert.ok(reg.register.some((r) => r.student_id === l.id && r.student_name === l.name), "the register shows the student's name");
  assert.equal(reg.register.find((r) => r.student_id === learners[0].id).status, "Present");
  assert.ok(reg.register.some((r) => r.status === null), "students nobody marked are listed");
  assert.match((await get("SES-AC-2")).error, /not one to check/);

  // A problem needs a note; Valid does not. Checks can change later.
  assert.match((await send({ action: "check", session_id: "SES-AC-1", status: "Has problems", note: "" })).error, /what the problem is/);
  assert.match((await send({ action: "check", session_id: "SES-AC-1", status: "Maybe" })).error, /Valid or Has problems/);
  assert.match((await send({ action: "check", session_id: "SES-AC-2", status: "Valid" })).error, /not one to check/);
  assert.equal((await send({ action: "check", session_id: "SES-AC-1", status: "Valid" })).ok, true);
  let saved = await dbRow("SELECT * FROM attendance_checks WHERE session_id='SES-AC-1'");
  assert.equal(saved.status, "Valid");
  assert.equal(saved.checked_by, "staff-quality");
  assert.match((await send({ action: "clear", session_id: "SES-AC-1" })).error, /Quality Lead/);

  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  const before = (await dbRow("SELECT count(*) n FROM notifications WHERE source LIKE 'attendance-check:SES-AC-1:%'")).n;
  assert.equal(before, 0);
  assert.equal((await send({ action: "check", session_id: "SES-AC-1", status: "Has problems", note: "Two students say they attended but were marked absent." })).ok, true);
  saved = await dbRow("SELECT * FROM attendance_checks WHERE session_id='SES-AC-1'");
  assert.equal(saved.status, "Has problems");
  assert.equal(saved.checked_by, "staff-quality-lead");
  assert.equal((await dbRow("SELECT status FROM attendance WHERE session_id='SES-AC-1' AND student_id=?", learners[1].id)).status, "Absent", "the marks are not changed");
  const told = await dbRows("SELECT recipient,entity_id FROM notifications WHERE source LIKE 'attendance-check:SES-AC-1:%'");
  assert.ok(told.some((n) => n.recipient === "staff-coach-ops" && n.entity_id === "SES-AC-1"), "Coach Operations is told");
  assert.ok(told.every((n) => !String(n.recipient).startsWith("DEMO-")), "demo people are not told about real sessions");
  assert.ok((await dbRow("SELECT count(*) n FROM audit_events WHERE entity_id=? AND action='Attendance register checked'", "SES-AC-1")).n >= 2, "every check is audited");

  // Coach Operations reads the check and the register, and cannot change them.
  current = { id: "staff-coach-ops", email: "staff-coach-ops@example.invalid" };
  const ops = await get();
  assert.equal(ops.error, undefined, ops.error);
  assert.equal(ops.checks, false);
  const seen = ops.sessions.find((s) => s.id === "SES-AC-1");
  assert.equal(seen.check_status, "Has problems");
  assert.match(seen.check_note, /marked absent/);
  assert.equal(seen.checked_by_name, (await dbRow("SELECT name FROM users WHERE id='staff-quality-lead'")).name);
  assert.ok((await get("SES-AC-1")).register.length >= 3);
  assert.match((await send({ action: "check", session_id: "SES-AC-1", status: "Valid" })).error, /role/);

  // The people who run groups are refused.
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  assert.match((await get()).error, /role/);
  assert.match((await send({ action: "check", session_id: "SES-AC-1", status: "Valid" })).error, /role/);

  // The lead may remove a check.
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  assert.equal((await send({ action: "clear", session_id: "SES-AC-1" })).ok, true);
  assert.ok(!(await dbRow("SELECT * FROM attendance_checks WHERE session_id='SES-AC-1'")), "the check is gone");
  assert.ok((await dbRow("SELECT count(*) n FROM audit_events WHERE entity_id=? AND action='Attendance check removed'", "SES-AC-1")).n === 1);
  current = { id: "owner", email: "owner@example.com" };
});

test("a rejected link fixed on the same page goes back to the reviewer, and a link pasted twice is refused in words", async () => {
  await dbExec("DELETE FROM rate_limits");
  const servicesApi = await route("student-services");
  const send = async (body) =>
    (await servicesApi.POST(new Request("https://test.local/api/student-services", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }))).json();
  const kafiil = (id) => `https://kafiil.com/service/${id}-service`;
  const pupil = await dbRow("SELECT id,email FROM students WHERE id NOT IN (SELECT student_id FROM service_links) AND lifecycle='Active' AND email IS NOT NULL AND email<>'' ORDER BY id LIMIT 1");
  current = { id: pupil.id, email: pupil.email };
  const links = [kafiil(8801), kafiil(8802), kafiil(8803)];
  assert.equal((await send({ action: "submit_services", services: links })).error, undefined);
  await dbExec("UPDATE service_links SET qc_status='Needs Correction',qc_comment='The price is over $7' WHERE student_id=? AND slot IN (1,2)", pupil.id);
  // Sent back unchanged without saying it was fixed: nothing moves.
  await send({ action: "submit_services", services: links });
  assert.equal((await dbRow("SELECT qc_status FROM service_links WHERE student_id=? AND slot=1", pupil.id)).qc_status, "Needs Correction");
  // The same link pasted into another place, or twice: a sentence, not a database error.
  let r = await send({ action: "submit_services", services: [links[1], links[0], links[2]] });
  assert.match(r.error, /already your service/);
  r = await send({ action: "submit_services", services: [links[0], links[0], links[2]] });
  assert.match(r.error, /must be different|is the same as link 1/);
  // "I fixed it": the same address goes back to the reviewer as a new revision.
  r = await send({ action: "submit_services", services: links, fixed_slots: [1] });
  assert.equal(r.error, undefined, r.error);
  const rows = await dbRows("SELECT slot,qc_status,revision,qc_comment FROM service_links WHERE student_id=? ORDER BY slot", pupil.id);
  assert.deepEqual(rows.map((x) => [x.qc_status, Number(x.revision)]), [["Pending", 2], ["Needs Correction", 1], ["Pending", 1]]);
  assert.equal(rows[0].qc_comment, null);
  // A locked or waiting link is never sent back by the flag.
  r = await send({ action: "submit_services", services: links, fixed_slots: [3] });
  assert.equal((await dbRow("SELECT revision FROM service_links WHERE student_id=? AND slot=3", pupil.id)).revision, 1);
  current = { id: "owner", email: "owner@example.com" };
});

test("the quality team reports a group's problem to Coach or Project Operations, who are notified and mark it handled", async () => {
  await dbExec("DELETE FROM rate_limits");
  const reports = await route("quality-reports");
  const get = async () => (await reports.GET()).json();
  const send = async (body) =>
    (await reports.POST(new Request("https://test.local/api/quality-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).json();
  await dbExec(
    "INSERT INTO users(id,email,name,roles,scopes,active) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=1",
    "po-reports", "po-reports@example.invalid", "Project Ops Reader", JSON.stringify(["Project Operations"]), "[]", 1,
  );
  const group = await dbRow("SELECT id FROM groups WHERE status='Active' AND id NOT LIKE 'DEMO-%' ORDER BY id LIMIT 1");

  current = { id: "staff-quality", email: "staff-quality@example.invalid" };
  const view = await get();
  assert.equal(view.error, undefined, view.error);
  assert.ok(view.reports_problems && view.groups.some((g) => g.id === group.id));
  assert.match((await send({ action: "report", group_id: group.id, audience: "Coach Operations", description: "" })).error, /Describe/);
  assert.match((await send({ action: "report", group_id: group.id, audience: "Everyone", description: "Coach late" })).error, /who the report goes to/);
  const sent = await send({ action: "report", group_id: group.id, audience: "Coach Operations", description: "The coach joined 40 minutes late." });
  assert.equal(sent.error, undefined, sent.error);
  assert.ok(sent.notified >= 1);
  assert.ok(await dbRow("SELECT id FROM notifications WHERE recipient='staff-coach-ops' AND source=?", `quality-report:${sent.id}:staff-coach-ops`));
  assert.ok(!(await dbRow("SELECT id FROM notifications WHERE recipient='po-reports' AND source LIKE ?", `quality-report:${sent.id}:%`)), "Project Operations was not chosen");
  const both = await send({ action: "report", group_id: group.id, audience: "Both", description: "Attendance was not taken." });
  assert.match((await send({ action: "handle", id: sent.id })).error, /sent to/, "the reporter does not mark it handled");

  // Project Operations reads only what was sent to them.
  current = { id: "po-reports", email: "po-reports@example.invalid" };
  let theirs = await get();
  assert.deepEqual(theirs.reports.map((r) => r.id), [both.id]);
  assert.equal(theirs.reports_problems, false);
  assert.match((await send({ action: "report", group_id: group.id, audience: "Both", description: "Not mine to send" })).error, /role/);

  // Coach Operations reads theirs and marks one handled; the reporter hears about it.
  current = { id: "coach-ops-login", email: "staff-coach-ops@example.invalid" };
  theirs = await get();
  assert.deepEqual(theirs.reports.map((r) => r.id).sort(), [sent.id, both.id].sort());
  assert.equal((await send({ action: "handle", id: sent.id, status: "Handled", note: "Spoke with the coach." })).ok, true);
  const done = await dbRow("SELECT * FROM quality_reports WHERE id=?", sent.id);
  assert.deepEqual([done.status, done.handled_by, done.handled_note], ["Handled", "staff-coach-ops", "Spoke with the coach."]);
  assert.ok(await dbRow("SELECT id FROM notifications WHERE recipient='staff-quality' AND source LIKE ?", `quality-report-handled:${sent.id}:%`));

  // Nobody else reads them.
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  assert.match((await get()).error, /role/);
  current = { id: "owner", email: "owner@example.com" };
  assert.ok((await get()).reports.length >= 2, "the administrators read them all");
});

test("a coordinator marks a session done so feedback opens early, and Coach Operations records a coordinator as the coach who held one", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const group = await dbRow(
    `SELECT g.id,g.coordinator,u.email FROM groups g JOIN users u ON u.id=g.coordinator
     WHERE g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND coalesce(g.delivery_model,'Regular')<>'Industry'
       AND (SELECT count(DISTINCT week) FROM sessions x WHERE x.group_id=g.id AND x.status<>'Cancelled')<8
       AND EXISTS (SELECT 1 FROM students s WHERE s.group_id=g.id AND s.lifecycle='Active' AND s.email IS NOT NULL AND s.email<>'')
     ORDER BY g.id LIMIT 1`,
  );
  const used = new Set((await dbRows("SELECT week FROM sessions WHERE group_id=? AND status<>'Cancelled'", group.id)).map((r) => Number(r.week)));
  const week = [1, 2, 3, 4, 5, 6, 7, 8].find((w) => !used.has(w));
  await check("session", { id: "SES-DONE-1", group_id: group.id, title: "Coaching", starts_at: new Date(Date.now() - 30 * 60000).toISOString(), week, duration_minutes: 180 });
  const pupil = await dbRow("SELECT id,email FROM students WHERE group_id=? AND lifecycle='Active' AND email IS NOT NULL AND email<>'' ORDER BY id LIMIT 1", group.id);
  const services = await route("student-services");
  const studentGet = async () => (await services.GET(new Request("https://test.local/api/student-services"))).json();
  const feedback = (body) =>
    services.POST(new Request("https://test.local/api/student-services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "session_feedback", ...body }) })).then((r) => r.json());
  const answers = { session_id: "SES-DONE-1", satisfaction: 5, clarity: 5, usefulness: 4, searched_gig: true };

  // Still running: no feedback yet.
  current = { id: pupil.id, email: pupil.email };
  assert.ok(!(await studentGet()).feedback_sessions?.some((s) => s.id === "SES-DONE-1"));
  assert.match((await feedback(answers)).error, /once the session has ended/);

  // Only the group's coordinator (or the leaders) end it.
  current = { id: "coordinator-other", email: "staff-quality@example.invalid" };
  assert.ok((await post("session_done", { id: "SES-DONE-1" })).error);
  current = { id: group.coordinator, email: group.email };
  await check("session_done", { id: "SES-DONE-1" });
  assert.ok((await dbRow("SELECT ended_at FROM sessions WHERE id='SES-DONE-1'")).ended_at);
  assert.match((await post("session_done", { id: "SES-DONE-1" })).error, /already ended/);

  // The feedback opens at once.
  current = { id: pupil.id, email: pupil.email };
  const open = (await studentGet()).feedback_sessions?.find((s) => s.id === "SES-DONE-1");
  assert.ok(open && open.open, "the form is open");
  assert.equal((await feedback(answers)).error, undefined);
  current = { id: group.coordinator, email: group.email };
  assert.match((await post("session_done", { id: "SES-DONE-1", undo: true })).error, /already given feedback/);

  // Coach Operations records the coordinator as the coach who held it.
  current = { id: "coach-ops-login", email: "staff-coach-ops@example.invalid" };
  const before = await dbRow("SELECT status,coach_confirmed_at FROM sessions WHERE id='SES-DONE-1'");
  await check("session_coach", { id: "SES-DONE-1", coach_id: group.coordinator, reason: "The coordinator ran the session." });
  const after = await dbRow("SELECT coach_id,status,coach_confirmed_at FROM sessions WHERE id='SES-DONE-1'");
  assert.equal(after.coach_id, group.coordinator);
  assert.deepEqual([after.status, after.coach_confirmed_at], [before.status, before.coach_confirmed_at], "a held session keeps its confirmations");
  // Since 29 Oct 2026 any active member of staff can stand in; a placeholder or an inactive person cannot.
  assert.match((await post("session_coach", { id: "SES-DONE-1", coach_id: "system-unassigned-coach", reason: "Not a real person" })).error, /active member of staff/);
  current = { id: "owner", email: "owner@example.com" };
});

test("an account's coordinator sees the service it is for, with the student and their coordinator", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const pupil = await dbRow(
    "SELECT s.id,s.name,s.group_id,g.coordinator,c.name coordinator_name FROM students s JOIN groups g ON g.id=s.group_id JOIN users c ON c.id=g.coordinator WHERE s.lifecycle='Active' AND g.status='Active' AND g.id NOT LIKE 'DEMO-%' AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.student_id=s.id) ORDER BY s.id LIMIT 1",
  );
  // The account's coordinator is someone else: the student is outside their groups.
  const other = await dbRow("SELECT id,email FROM users WHERE roles LIKE '%Operations Coordinator%' AND active=1 AND id<>? AND id NOT LIKE 'DEMO-%' ORDER BY id LIMIT 1", pupil.coordinator);
  const created = new Date().toISOString();
  const url = "https://kafiil.com/service/770001-" + encodeURIComponent("تصميم-شعار");
  await dbExec(
    "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,account_id,submitted_at,updated_at) VALUES(?,?,1,?,?,'Kafiil','Needs Review','{}',?,'Locked',NULL,NULL,?,1,NULL,?,?)",
    "SLK-ACCT-VIEW", pupil.id, url, url, created, created, created, created,
  );
  const account = await dbRow("SELECT id FROM accounts WHERE id NOT LIKE 'DEMO-%' AND student_id IS NULL ORDER BY id LIMIT 1");
  const before = await dbRow("SELECT coordinator_id,student_id,service_link_id FROM accounts WHERE id=?", account.id);
  await dbExec("UPDATE accounts SET coordinator_id=?,student_id=?,service_link_id=? WHERE id=?", other.id, pupil.id, "SLK-ACCT-VIEW", account.id);
  current = { id: other.id, email: other.email };
  const view = await (await api.GET()).json();
  assert.equal(view.error, undefined, view.error);
  const row = view.accounts.find((a) => a.id === account.id);
  assert.ok(row, "the coordinator sees the account given to them");
  assert.equal(row.service_link_id, "SLK-ACCT-VIEW");
  assert.equal(row.service_url, url);
  assert.equal(row.service_platform, "Kafiil");
  assert.equal(row.student_name, pupil.name);
  assert.equal(row.student_coordinator_name, pupil.coordinator_name);
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("UPDATE accounts SET coordinator_id=?,student_id=?,service_link_id=? WHERE id=?", before.coordinator_id, before.student_id, before.service_link_id, account.id);
  await dbExec("DELETE FROM service_links WHERE id='SLK-ACCT-VIEW'");
});

test("a demo student never takes a real client account", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const demo = await dbRow("SELECT s.id,s.group_id,g.supervisor FROM students s JOIN groups g ON g.id=s.group_id WHERE g.id LIKE 'DEMO-%' AND s.lifecycle='Active' ORDER BY s.id LIMIT 1");
  if (!demo) return;
  const team = (await dbRow("SELECT team FROM users WHERE id=?", demo.supervisor)).team;
  await dbExec("UPDATE users SET team='Service Team' WHERE id=?", demo.supervisor);
  const at = new Date().toISOString();
  await dbExec(
    "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,account_id,submitted_at,updated_at) VALUES(?,?,?,?,?,'Kafiil','Needs Review','{}',?,'Locked',NULL,'staff-quality',?,1,NULL,?,?)",
    "SLK-DEMO-KEY", demo.id, 9, "https://kafiil.com/kafiil/service/demo-key", "kafiil.com/kafiil/service/demo-key", at, at, at, at,
  );
  await check("account", { id: "ACC-REAL-RICH", label: "real-rich@example.org", platform: "Kafeel", credits: 999999 });
  await check("account_link_sweep", {});
  const theirs = await dbRows("SELECT id FROM accounts WHERE student_id=?", demo.id);
  assert.ok(theirs.every((a) => a.id.startsWith("DEMO-")), "only demo accounts, if any");
  assert.equal((await dbRow("SELECT student_id FROM accounts WHERE id='ACC-REAL-RICH'")).student_id === demo.id, false);
  await dbExec("UPDATE accounts SET student_id=NULL,service_link_id=NULL WHERE student_id=?", demo.id);
  await dbExec("UPDATE accounts SET student_id=NULL,service_link_id=NULL,status='Retired' WHERE id='ACC-REAL-RICH'");
  await dbExec("DELETE FROM service_links WHERE id='SLK-DEMO-KEY'");
  await dbExec("UPDATE users SET team=? WHERE id=?", team, demo.supervisor);
});

test("an approved Khamsat service earns no client account", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const pupil = await dbRow(
    `SELECT s.id,g.supervisor FROM students s JOIN groups g ON g.id=s.group_id
     WHERE s.lifecycle='Active' AND g.id NOT LIKE 'DEMO-%' AND g.coordinator IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.student_id=s.id) AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.student_id=s.id)
     ORDER BY s.id LIMIT 1`,
  );
  const team = (await dbRow("SELECT team FROM users WHERE id=?", pupil.supervisor)).team;
  await dbExec("UPDATE users SET team='Service Team' WHERE id=?", pupil.supervisor);
  const at = new Date().toISOString();
  await dbExec(
    "INSERT INTO service_links(id,student_id,slot,url,normalized_url,platform,auto_status,auto_result,auto_checked_at,qc_status,qc_comment,qc_actor,qc_at,revision,account_id,submitted_at,updated_at) VALUES(?,?,?,?,?,'Khamsat','Needs Review','{}',?,'Locked',NULL,'staff-quality',?,1,NULL,?,?)",
    "SLK-KHAMSAT-KEY", pupil.id, 1, "https://khamsat.com/design/logo/9901-logo", "khamsat.com/design/logo/9901-logo", at, at, at, at,
  );
  await check("account", { id: "ACC-KHAMSAT-1", label: "khamsat-one@example.org", platform: "Khamsat", credits: 50 });
  await check("account_link_sweep", {});
  assert.ok(!(await dbRow("SELECT id FROM accounts WHERE student_id=?", pupil.id)), "Khamsat is not covered");
  await dbExec("UPDATE accounts SET status='Retired' WHERE id='ACC-KHAMSAT-1'");
  await dbExec("DELETE FROM service_links WHERE id='SLK-KHAMSAT-KEY'");
  await dbExec("UPDATE users SET team=? WHERE id=?", team, pupil.supervisor);
});

test("coordinators follow each order on a student's client account, and the leaders count them", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const pupil = await dbRow(
    `SELECT s.id,s.group_id,g.coordinator,g.supervisor,c.email FROM students s JOIN groups g ON g.id=s.group_id JOIN users c ON c.id=g.coordinator JOIN users v ON v.id=g.supervisor
     WHERE s.lifecycle='Active' AND g.status='Active' AND v.team='Service Team' AND g.id NOT LIKE 'DEMO-%' ORDER BY s.id LIMIT 1`,
  );
  assert.ok(pupil, "a Service Team student");
  await check("account", { id: "ACC-ORDER-1", label: "orders@example.org", platform: "Kafeel", credits: 50 });
  await dbExec("UPDATE accounts SET student_id=?,coordinator_id=? WHERE id='ACC-ORDER-1'", pupil.id, pupil.coordinator);

  // Someone else's coordinator cannot record on it.
  const other = await dbRow("SELECT id,email FROM users WHERE roles LIKE '%Operations Coordinator%' AND active=1 AND id<>? AND id NOT LIKE 'DEMO-%' ORDER BY id LIMIT 1", pupil.coordinator);
  current = { id: other.id, email: other.email };
  assert.match((await post("account_order", { account_id: "ACC-ORDER-1", order_ref: "K-1" })).error, /Only this account's coordinator/);

  current = { id: pupil.coordinator, email: pupil.email };
  await check("account_order", { id: "ORD-1", account_id: "ACC-ORDER-1", order_ref: "K-1001", amount: 5, note: "Logo" });
  let order = await dbRow("SELECT * FROM account_orders WHERE id='ORD-1'");
  assert.equal(order.status, "In Progress");
  assert.equal(order.student_id, pupil.id);
  assert.match((await post("account_order_status", { id: "ORD-1", status: "Proof Uploaded" })).error, /cannot become/, "proof comes after Done");
  await check("account_order_status", { id: "ORD-1", status: "Done" });
  assert.match((await post("account_order_status", { id: "ORD-1", status: "Proof Uploaded" })).error, /Upload the proof first/);
  await dbExec(
    "INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)",
    "FILE-ORD-1", pupil.id, "evidence/ord-1", "proof.png", "image/png", 10, "hash-ord-1", pupil.coordinator, new Date().toISOString(),
  );
  await check("account_order_status", { id: "ORD-1", status: "Proof Uploaded", proof_id: "FILE-ORD-1" });
  order = await dbRow("SELECT * FROM account_orders WHERE id='ORD-1'");
  assert.equal(order.status, "Proof Uploaded");
  assert.equal(order.proof_id, "FILE-ORD-1");
  assert.ok(order.done_at && order.proof_at);
  assert.match((await post("account_order_status", { id: "ORD-1", status: "Cancelled", note: "No" })).error, /cannot become/, "a finished order stays finished");

  await check("account_order", { id: "ORD-2", account_id: "ACC-ORDER-1" });
  assert.match((await post("account_order_status", { id: "ORD-2", status: "Cancelled" })).error, /Say why/);
  await check("account_order_status", { id: "ORD-2", status: "Cancelled", note: "Client withdrew" });
  const mine = await (await api.GET()).json();
  assert.deepEqual(mine.accountOrders.filter((o) => o.account_id === "ACC-ORDER-1").map((o) => o.status).sort(), ["Cancelled", "Proof Uploaded"]);

  // Project Operations and the group's supervisor read them for their overview.
  current = { id: "owner", email: "owner@example.com" };
  assert.ok((await (await api.GET()).json()).accountOrders.some((o) => o.id === "ORD-1"));
  const sup = await dbRow("SELECT id,email FROM users WHERE id=?", pupil.supervisor);
  current = { id: sup.id, email: sup.email };
  const theirs = (await (await api.GET()).json()).accountOrders;
  assert.ok(theirs.some((o) => o.id === "ORD-1") && theirs.every((o) => o.group_id), "the supervisor sees their groups' orders");

  // Client accounts are for Service Team students only.
  current = { id: "owner", email: "owner@example.com" };
  const scopes = (await dbRow("SELECT scopes FROM users WHERE email='owner@example.com'")).scopes;
  await dbExec("UPDATE users SET scopes=? WHERE email='owner@example.com'", JSON.stringify([...new Set([...JSON.parse(scopes || "[]"), "account-unlock"])]));
  const outsider = await dbRow(
    "SELECT s.id FROM students s JOIN groups g ON g.id=s.group_id JOIN users v ON v.id=g.supervisor WHERE s.lifecycle='Active' AND COALESCE(v.team,'')<>'Service Team' AND g.id NOT LIKE 'DEMO-%' ORDER BY s.id LIMIT 1",
  );
  if (outsider) {
    await check("account", { id: "ACC-ORDER-2", label: "orders-2@example.org", platform: "Kafeel", credits: 10 });
    assert.match((await post("account_assign", { id: "ACC-ORDER-2", key_student: outsider.id })).error, /Service Team students only/);
  }
  await dbExec("UPDATE users SET scopes=? WHERE email='owner@example.com'", scopes);
  await dbExec("DELETE FROM account_orders WHERE account_id='ACC-ORDER-1'");
  await dbExec("UPDATE accounts SET student_id=NULL WHERE id='ACC-ORDER-1'");
});

test("each service row's status picker sets where its order stands, in one step", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const pupil = await dbRow(
    `SELECT s.id,g.coordinator,c.email FROM students s JOIN groups g ON g.id=s.group_id JOIN users c ON c.id=g.coordinator JOIN users v ON v.id=g.supervisor
     WHERE s.lifecycle='Active' AND g.status='Active' AND v.team='Service Team' AND g.id NOT LIKE 'DEMO-%' ORDER BY s.id DESC LIMIT 1`,
  );
  await check("account", { id: "ACC-PICK-1", label: "pick@example.org", platform: "Nafezly", credits: 20 });
  await dbExec("UPDATE accounts SET student_id=?,coordinator_id=? WHERE id='ACC-PICK-1'", pupil.id, pupil.coordinator);
  current = { id: pupil.coordinator, email: pupil.email };
  const state = async () => (await dbRows("SELECT status FROM account_orders WHERE account_id='ACC-PICK-1' ORDER BY created_at")).map((r) => r.status);
  await check("account_service_status", { account_id: "ACC-PICK-1", status: "Done" });
  assert.deepEqual(await state(), ["Done"], "choosing a status with no order starts one there");
  assert.match((await post("account_service_status", { account_id: "ACC-PICK-1", status: "Cancelled" })).error, /Say why/);
  await check("account_service_status", { account_id: "ACC-PICK-1", status: "In Progress" });
  assert.match((await post("account_service_status", { account_id: "ACC-PICK-1", status: "Proof Uploaded" })).error, /Upload the proof first/);
  await dbExec("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)", "FILE-PICK-1", pupil.id, "evidence/pick-1", "p.png", "image/png", 10, "hash-pick-1", pupil.coordinator, new Date().toISOString());
  await check("account_service_status", { account_id: "ACC-PICK-1", status: "Proof Uploaded", proof_id: "FILE-PICK-1" });
  assert.deepEqual(await state(), ["Proof Uploaded"]);
  // After a finished order, the next pick starts a new one.
  await check("account_service_status", { account_id: "ACC-PICK-1", status: "In Progress" });
  assert.deepEqual(await state(), ["Proof Uploaded", "In Progress"]);
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("DELETE FROM account_orders WHERE account_id='ACC-PICK-1'");
  await dbExec("UPDATE accounts SET student_id=NULL WHERE id='ACC-PICK-1'");
});

test("a coordinator marks a service Buy first, then follows it on", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const pupil = await dbRow(
    `SELECT s.id,g.coordinator,u.email FROM students s JOIN groups g ON g.id=s.group_id JOIN users u ON u.id=g.coordinator
     WHERE s.lifecycle='Active' AND g.id NOT LIKE 'DEMO-%' AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.student_id=s.id) ORDER BY s.id LIMIT 1`,
  );
  await check("account", { id: "ACC-BUY-1", label: "buy-one@example.org", platform: "Nafezly", credits: 10 });
  await dbExec("UPDATE accounts SET student_id=?,coordinator_id=?,linked_at=? WHERE id='ACC-BUY-1'", pupil.id, pupil.coordinator, new Date().toISOString());
  current = { id: pupil.coordinator, email: pupil.email };
  await check("account_service_status", { account_id: "ACC-BUY-1", status: "Buy" });
  assert.equal((await dbRow("SELECT status FROM account_orders WHERE account_id='ACC-BUY-1'")).status, "Buy");
  await check("account_service_status", { account_id: "ACC-BUY-1", status: "In Progress" });
  assert.equal((await dbRow("SELECT status FROM account_orders WHERE account_id='ACC-BUY-1'")).status, "In Progress", "the same order moves on");
  assert.equal((await dbRow("SELECT count(*) n FROM account_orders WHERE account_id='ACC-BUY-1'")).n, 1);
  current = { id: "owner", email: "owner@example.com" };
  await dbExec("UPDATE accounts SET student_id=NULL,status='Retired' WHERE id='ACC-BUY-1'");
});

test("a portal row is matched to our student by national ID first, and the ID is not kept with the sheet", async () => {
  await dbExec("DELETE FROM rate_limits");
  current = { id: "owner", email: "owner@example.com" };
  const portal = await route("portal");
  const post = (body) => portal.POST(new Request("https://test.local/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const ours = await dbRow("SELECT id,national_id FROM students WHERE lifecycle='Active' AND length(trim(national_id))=14 AND id NOT LIKE 'DEMO-%' ORDER BY id LIMIT 1");
  assert.ok(ours, "a student with a national ID");
  const begun = await (await post({ action: "begin", sheet: "students", mapping: { ID: "portal_id", Email: "email", NID: "national_id" }, total: 2, file_name: "students.xlsx" })).json();
  assert.ok(begun.batch, JSON.stringify(begun));
  assert.equal(
    (await post({
      action: "chunk",
      batch: begun.batch,
      rows: [
        { portal_id: "NID-1", email: "a-different-address@example.org", national_id: " " + ours.national_id },
        { portal_id: "NID-2", email: "nobody@example.org", national_id: "29901010000000" },
      ],
    })).status,
    200,
  );
  const done = await (await post({ action: "commit", batch: begun.batch })).json();
  assert.equal(done.linked, 1, "linked by national ID although the email differs");
  const row = await dbRow("SELECT * FROM portal_students WHERE batch_id=? AND portal_id='NID-1'", begun.batch);
  assert.equal(row.student_id, ours.id);
  assert.ok(!JSON.stringify(row).includes(ours.national_id), "the national ID is not stored with the sheet");

  // Any column, then the name within the round code's group.
  const byMail = await dbRow("SELECT id,email FROM students WHERE lifecycle='Active' AND email IS NOT NULL AND trim(email)<>'' AND id NOT LIKE 'DEMO-%' AND id<>? ORDER BY id DESC LIMIT 1", ours.id);
  const named = await dbRow(
    `SELECT s.id,s.name,s.group_id FROM students s WHERE s.lifecycle='Active' AND s.id NOT LIKE 'DEMO-%' AND s.id NOT IN (?,?)
       AND (SELECT count(*) FROM students t WHERE t.group_id=s.group_id AND lower(trim(t.name))=lower(trim(s.name)))=1 ORDER BY s.id LIMIT 1`,
    ours.id, byMail.id,
  );
  const again = await (await post({ action: "begin", sheet: "students", mapping: { ID: "portal_id", Email: "email", Name: "full_name", Round: "round_code" }, total: 3, file_name: "students.xlsx" })).json();
  await post({
    action: "chunk",
    batch: again.batch,
    rows: [
      { portal_id: "ANY-1", email: "portal-only@example.org", full_name: "Someone", round_code: "X", _cells: ["ANY-1", "portal-only@example.org", "Profile: " + byMail.email.toUpperCase()] },
      { portal_id: "NAME-1", email: "elsewhere@example.org", full_name: "  " + named.name.toUpperCase() + " ", round_code: named.group_id.toLowerCase(), _cells: [] },
      { portal_id: "NAME-2", email: "elsewhere2@example.org", full_name: named.name, round_code: "SOME_OTHER_GROUP", _cells: [] },
    ],
  });
  await post({ action: "commit", batch: again.batch });
  const linkOf = async (id) => (await dbRow("SELECT student_id FROM portal_students WHERE batch_id=? AND portal_id=?", again.batch, id)).student_id;
  assert.equal(await linkOf("ANY-1"), byMail.id, "an email in any column finds the student");
  assert.equal(await linkOf("NAME-1"), named.id, "the same name in the round code's group finds the student");
  assert.equal(await linkOf("NAME-2"), null, "a name in another group does not");

  // Project Operations or an administrator links a row by hand, by national ID, and it holds for later uploads.
  const picked = await dbRow("SELECT id,national_id FROM students WHERE lifecycle='Active' AND id NOT LIKE 'DEMO-%' AND id NOT IN (?,?,?) ORDER BY id DESC LIMIT 1", ours.id, byMail.id, named.id);
  await dbExec("UPDATE students SET national_id='30001012345678' WHERE id=?", picked.id);
  const other = { id: picked.id, national_id: "30001012345678" };
  const coordinator = await dbRow("SELECT id,email FROM users WHERE roles LIKE '%Operations Coordinator%' AND active=1 AND id NOT LIKE 'DEMO-%' LIMIT 1");
  current = { id: coordinator.id, email: coordinator.email };
  assert.ok((await (await post({ action: "link", portal_id: "NAME-2", national_id: other.national_id })).json()).error, "not for coordinators");
  current = { id: "owner", email: "owner@example.com" };
  assert.match((await (await post({ action: "link", portal_id: "NAME-2", national_id: "123" })).json()).error, /14-digit/);
  assert.match((await (await post({ action: "link", portal_id: "NAME-2", national_id: "29901019999999" })).json()).error, /No student of ours/);
  const linkedNow = await (await post({ action: "link", portal_id: "NAME-2", national_id: other.national_id })).json();
  assert.equal(linkedNow.error, undefined, linkedNow.error);
  assert.equal(await linkOf("NAME-2"), other.id, "linked at once");
  const saved = await dbRow("SELECT * FROM portal_links WHERE portal_id='NAME-2'");
  assert.equal(saved.student_id, other.id);
  assert.ok(!JSON.stringify(saved).includes(other.national_id), "the national ID typed is not kept");
  const viewNow = await (await portal.GET(new Request("https://test.local/api/portal"))).json();
  assert.equal(Number(viewNow.students.find((r) => r.portal_id === "NAME-2").linked_by_hand), 1);
  // The next upload links that portal student the same way, whatever else it says.
  const third = await (await post({ action: "begin", sheet: "students", mapping: { ID: "portal_id", Email: "email" }, total: 1, file_name: "students.xlsx" })).json();
  await post({ action: "chunk", batch: third.batch, rows: [{ portal_id: "NAME-2", email: "changed@example.org", _cells: [] }] });
  await post({ action: "commit", batch: third.batch });
  assert.equal((await dbRow("SELECT student_id FROM portal_students WHERE batch_id=? AND portal_id='NAME-2'", third.batch)).student_id, other.id);
  // And it can be removed.
  assert.equal((await (await post({ action: "unlink", portal_id: "NAME-2" })).json()).ok, true);
  assert.equal((await dbRow("SELECT student_id FROM portal_students WHERE batch_id=? AND portal_id='NAME-2'", third.batch)).student_id, null);
  assert.equal(await dbRow("SELECT * FROM portal_links WHERE portal_id='NAME-2'"), null);
  await dbExec("UPDATE students SET national_id=? WHERE id=?", picked.national_id, picked.id);
});
