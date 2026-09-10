import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { build } from "esbuild";
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const file of fs
  .readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  sqlite.exec(fs.readFileSync("drizzle/" + file, "utf8"));
let current = { id: "owner", email: "owner@example.com" };
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
globalThis.__testEnv = {
  DB: {
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
  },
  BUCKET: {},
};
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
  outfile: "/tmp/depi-operations-test.mjs",
  plugins: [
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
const api = await import("/tmp/depi-operations-test.mjs");
await build({
  entryPoints: ["app/api/program/route.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "/tmp/depi-program-test.mjs",
  plugins: [
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
const programApi = await import("/tmp/depi-program-test.mjs");
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
test("full seeded backend workflow and permission gates", async () => {
  await check("setup", { mode: "demo" });
  assert.equal(sqlite.prepare("SELECT count(*) n FROM students").get().n, 1000);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM tasks").get().n, 1000);
  const data = await (await api.GET()).json();
  assert.equal(data.students.length, 1000);
  assert.equal(data.students[0].graduation, "0/3");
  assert.ok(data.students[0].next_task);
  let r = await post("contact", { student_id: "S10001" });
  assert.match(r.error, /incomplete/);
  sqlite
    .prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
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
  sqlite
    .prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
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
    sqlite
      .prepare("SELECT count(*) n FROM contacts WHERE student_id='S10001'")
      .get().n,
    1,
  );
  await check("account_request", {
    id: "REQ1",
    student_id: "S10001",
    task_bank_id: "TB-DM-1",
    job_profile: "Digital marketing specialist",
    gig_number: 1,
  });
  r = await post("allocate", {
    request: "REQ1",
    account: "ACC-102",
    task_fit: true,
  });
  assert.match(r.error, /role/);
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
    sqlite.prepare("SELECT status FROM accounts WHERE id='ACC-102'").get()
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
  const gig = sqlite
    .prepare("SELECT * FROM gigs WHERE student_id='S10001'")
    .get();
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
  r = await post("review", { id: "EV1", notes: "Looks complete" });
  assert.match(r.error, /role/);
  current = { id: "coach-login", email: "staff-coach@example.invalid" };
  await check("review", { id: "EV1", notes: "Coach confirms delivery" });
  current = { id: "owner", email: "owner@example.com" };
  await check("review", { id: "EV1", notes: "Completeness checked" });
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
    sqlite
      .prepare("SELECT count(*) n FROM tasks WHERE category='Correction'")
      .get().n,
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
    sqlite.prepare("SELECT status FROM evidence WHERE id='EV1'").get().status,
    "Accepted",
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT result FROM graduation_ledger WHERE student_id='S10001' ORDER BY rowid DESC LIMIT 1",
      )
      .get().result,
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
  assert.throws(
    () => sqlite.exec("UPDATE audit_events SET action='tampered'"),
    /immutable/,
  );
  assert.throws(() => sqlite.exec("DELETE FROM evidence_reviews"), /immutable/);
});
test("verified hosted email recovers identity when the user-id header is absent", async () => {
  current = { id: "", email: "owner@example.com" };
  const data = await (await api.GET()).json();
  assert.equal(data.user.email, "owner@example.com");
  assert.equal(data.error, undefined);
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
    sqlite.prepare("SELECT status FROM applications WHERE id='APP-FLOW'").get()
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
    sqlite
      .prepare("SELECT outcome FROM assessment_results WHERE id='ASR-FLOW'")
      .get().outcome,
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
    sqlite.prepare("SELECT lifecycle FROM students WHERE id='S-FLOW'").get()
      .lifecycle,
    "Withdrawn",
  );
  sqlite
    .prepare(
      "UPDATE students SET lifecycle='Graduate Closed' WHERE id='S10001'",
    )
    .run();
  sqlite
    .prepare("INSERT INTO graduation_ledger VALUES(?,?,?,?,?,?)")
    .run(
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
  const reportApprover = sqlite.prepare("SELECT id FROM users WHERE email='report-approver@example.com'").get().id;
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
  assert.equal(sqlite.prepare("SELECT count(*) n FROM report_runs WHERE definition_id='RDEF-FLOW'").get().n, 2);
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
    sqlite.prepare("SELECT count(*) n FROM tasks WHERE title='Prepare weekly evidence package'").get().n,
    2,
  );
  await programCheck("bulk_classification", {
    student_ids: ["S10002", "S10003"],
    status: "At Risk",
    reason: "Shared progress threshold reached",
  });
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM students WHERE id IN ('S10002','S10003') AND engagement='At Risk'").get().n,
    2,
  );
  await programCheck("bulk_group_owner", {
    group_ids: ["G101", "G102"],
    owner_type: "Coordinator",
    owner: "staff-sara",
    reason: "Approved workload rebalance",
  });
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM groups WHERE id IN ('G101','G102') AND coordinator='staff-sara'").get().n,
    2,
  );
  const rejected = await programPost("bulk_classification", {
    student_ids: ["S10002", "missing-student"],
    status: "Critical",
    reason: "Atomic validation test",
  });
  assert.match(rejected.error, /not found|scope/i);
  assert.equal(sqlite.prepare("SELECT engagement FROM students WHERE id='S10002'").get().engagement, "At Risk");
});
test("track capacity blocks direct and admitted roster growth", async () => {
  current = { id: "owner", email: "owner@example.com" };
  const enrolled = sqlite.prepare("SELECT count(*) n FROM students s JOIN groups g ON g.id=s.group_id WHERE g.track='Digital Marketing' AND s.lifecycle NOT IN ('Transferred','Withdrawn','Removed')").get().n;
  sqlite.prepare("UPDATE tracks SET capacity=? WHERE name='Digital Marketing'").run(enrolled);
  assert.match(
    (await post("student", { id: "S-CAPACITY", name: "Capacity Test", group_id: "G101" })).error,
    /capacity/,
  );
  assert.equal(sqlite.prepare("SELECT count(*) n FROM students WHERE id='S-CAPACITY'").get().n, 0);
  sqlite.prepare("UPDATE tracks SET capacity=300 WHERE name='Digital Marketing'").run();
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
    sqlite.prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)").run(
      id, "S10002", key, `${id}.png`, "image/png", 120, hash, "owner", created,
    );
  }
  sqlite.prepare("INSERT INTO gigs(id,student_id,platform,title,value,currency,status,due,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
    "GIG-L3", "S10002", "Upwork", "L3 recovery test", 15, "USD", "Paid", "2027-01-01T00:00:00Z", created,
  );
  sqlite.prepare("INSERT INTO evidence(id,student_id,gig_id,proof_id,source,status,rejections,code,requirements,recorder,stage_at,created_at,policy_id) VALUES(?,?,?,?,?, 'Quality Review',1,'EV01','First correction','owner',?,?,?)").run(
    "EV-L3", "S10002", "GIG-L3", "L3-DELIVERY-1", "Platform", created, created, "R5-v1",
  );
  sqlite.prepare("INSERT INTO evidence_packages VALUES(?,?,?,?,?,?)").run("EPK-L3-1", "EV-L3", 1, "Submitted", "owner", created);
  sqlite.prepare("INSERT INTO evidence_package_items VALUES(?,?,?,?,?)").run("EPI-L3-1", "EPK-L3-1", "Delivery", "L3-DELIVERY-1", created);
  sqlite.prepare("INSERT INTO evidence_package_items VALUES(?,?,?,?,?)").run("EPI-L3-2", "EPK-L3-1", "Payment", "L3-PAYMENT-1", created);
  current = { id: "quality-login", email: "staff-quality@example.invalid" };
  await check("review", { id: "EV-L3", decision: "Reject", code: "EV07", notes: "Second rejection requires L3 review" });
  current = { id: "owner", email: "owner@example.com" };
  await check("review", {
    id: "EV-L3",
    proof_id: "L3-DELIVERY-2",
    payment_proof_id: "L3-PAYMENT-2",
    notes: "Corrected evidence package resubmitted",
  });
  assert.equal(sqlite.prepare("SELECT status FROM evidence WHERE id='EV-L3'").get().status, "L3 Review");
  current = { id: "staff-quality-lead", email: "staff-quality-lead@example.invalid" };
  await check("review", { id: "EV-L3", decision: "Final resolution", notes: "Final non-qualifying resolution recorded" });
  assert.equal(sqlite.prepare("SELECT status FROM evidence WHERE id='EV-L3'").get().status, "Closed L3");
  assert.ok(sqlite.prepare("SELECT id FROM cases WHERE source='L3-EV-L3'").get());
  current = { id: "owner", email: "owner@example.com" };
});
test("database allocation guard protects stale concurrent eligibility", () => {
  const now = new Date().toISOString();
  assert.throws(
    () =>
      sqlite
        .prepare("INSERT INTO account_assignments VALUES(?,?,?,?,?,?)")
        .run("ASN-late", "ACC-102", "S10002", "G101", "REQ2", now),
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
    sqlite.prepare("SELECT policy_id FROM groups WHERE id='GNEW'").get()
      .policy_id,
    "P2",
  );
  assert.equal(
    sqlite.prepare("SELECT policy_id FROM groups WHERE id='G101'").get()
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
  const n = sqlite
    .prepare("SELECT count(*) n FROM tasks WHERE source LIKE 'policy-%'")
    .get().n;
  const c = sqlite
    .prepare(
      "SELECT count(*) n FROM cases WHERE source LIKE 'policy-critical:%'",
    )
    .get().n;
  assert.ok(c > 0);
  const second = await check("policy_check");
  assert.equal(second.summary.processed, 0);
  assert.equal(
    sqlite
      .prepare("SELECT count(*) n FROM tasks WHERE source LIKE 'policy-%'")
      .get().n,
    n,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT count(*) n FROM cases WHERE source LIKE 'policy-critical:%'",
      )
      .get().n,
    c,
  );
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  assert.match((await post("policy_check")).error, /role/);
});
test("controlled platforms and separately approved FX applications are enforced", async () => {
  current = { id: "owner", email: "owner@example.com" };
  assert.throws(
    () =>
      sqlite
        .prepare(
          "INSERT INTO accounts(id,platform,label,status,credits) VALUES('BAD-PLATFORM','Fiverr','Invalid','Available',10)",
        )
        .run(),
    /platform/,
  );
  sqlite
    .prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
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
  sqlite
    .prepare(
      "INSERT INTO evidence(id,student_id,gig_id,proof_id,source,status,rejections,recorder,stage_at,created_at,policy_id) VALUES(?,?,?,?,?,'Accepted',0,?,?,?,?)",
    )
    .run(
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
    sqlite
      .prepare(
        "SELECT usd_value FROM gig_fx_applications WHERE gig_id='GIG-FX'",
      )
      .get().usd_value,
    6,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT result FROM graduation_ledger WHERE student_id='S10003' ORDER BY rowid DESC LIMIT 1",
      )
      .get().result,
    "1/3",
  );
  assert.throws(
    () =>
      sqlite
        .prepare("UPDATE fx_rates SET usd_rate=1 WHERE id='FX-EGP-1'")
        .run(),
    /immutable/,
  );
});
async function route(name) {
  const output = "/tmp/depi-route-" + name + ".mjs";
  await build({
    entryPoints: ["app/api/" + name + "/route.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    plugins: [
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
  return import(output);
}
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
  const before = sqlite.prepare("SELECT count(*) n FROM attachments").get().n;
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
    sqlite.prepare("SELECT count(*) n FROM attachments").get().n,
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
  current = { id: "coordinator", email: "staff-sara@example.invalid" };
  let result = await (
    await call({
      action: "reveal",
      account_id: "ACC-102",
      purpose: "Resolve the assigned client task",
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
      sqlite
        .prepare(
          "SELECT count(*) n FROM audit_events WHERE value LIKE '%test-secret-never-log%'",
        )
        .get().n,
      0,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("encrypted database and evidence backup restores to a fresh isolated directory", async () => {
  const { createHash } = await import("node:crypto");
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");
  const bytes = new TextEncoder().encode(
    "synthetic evidence bytes for restore test",
  );
  sqlite
    .prepare("UPDATE attachments SET size=?,hash=?")
    .run(bytes.length, createHash("sha256").update(bytes).digest("hex"));
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
