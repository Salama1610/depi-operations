import {
  actor,
  stmt,
  auditStmt,
  db,
  uid,
  now,
  rateLimit,
  scopeSql,
} from "@/lib/server";
import { can, ensure } from "@/lib/domain/rules";
import { POST as operate } from "@/app/api/operations/route";
import { POST as program } from "@/app/api/program/route";
const allowed: Record<string, string[]> = {
  students: ["id", "name", "group_id", "email", "phone", "lifecycle", "engagement", "coaching"],
  groups: [
    "id",
    "name",
    "track",
    "provider",
    "coordinator",
    "supervisor",
    "coach",
    "account_manager",
    "pathway",
    "delivery_model",
    "start_date",
  ],
  contacts: [
    "student_id",
    "channel",
    "outcome",
    "occurred_at",
    "proof_id",
    "next_action",
    "owner",
    "due",
    "notes",
  ],
  tasks: ["student_id", "title", "owner", "due", "category", "priority"],
  sessions: [
    "id",
    "group_id",
    "coach_id",
    "title",
    "starts_at",
    "week",
    "duration_minutes",
  ],
  attendance: ["session_id", "student_id", "status", "source"],
  task_bank: ["id", "track", "title", "platform", "value"],
  accounts: ["id", "label", "platform", "credits"],
  requests: [
    "student_id",
    "task_bank_id",
    "job_profile",
    "gig_number",
    "notes",
  ],
  gigs: [
    "id",
    "student_id",
    "platform",
    "title",
    "value",
    "currency",
    "order_ref",
    "due",
  ],
  evidence: ["student_id", "gig_id", "proof_id", "payment_proof_id", "source"],
  cases: ["student_id", "title", "type", "severity", "owner", "due"],
  applications: [
    "id",
    "external_ref",
    "name",
    "email",
    "phone",
    "preferred_track",
    "source",
    "consent_ref",
    "owner",
    "submitted_at",
  ],
  assessments: [
    "id",
    "group_id",
    "title",
    "type",
    "max_score",
    "pass_score",
    "due_at",
  ],
  assessment_results: [
    "id",
    "assessment_id",
    "student_id",
    "score",
    "evidence_id",
    "notes",
  ],
  withdrawals: [
    "id",
    "student_id",
    "ministry_reference",
    "decision",
    "decided_at",
    "reason",
  ],
  post_program_outcomes: [
    "id",
    "student_id",
    "type",
    "organization",
    "title",
    "value",
    "currency",
    "status",
    "proof_id",
    "follow_up_at",
    "owner",
  ],
};
const actions: Record<string, string> = {
  students: "student",
  groups: "group",
  contacts: "contact",
  tasks: "task",
  sessions: "session",
  attendance: "attendance",
  task_bank: "task_bank",
  accounts: "account",
  requests: "account_request",
  gigs: "gig",
  evidence: "evidence",
  cases: "case",
  applications: "application",
  assessments: "assessment",
  assessment_results: "assessment_result",
  withdrawals: "withdrawal_decision",
  post_program_outcomes: "post_program_outcome",
};
const required: Record<string, string[]> = {
  students: ["id", "name", "group_id", "email"],
  groups: [
    "id",
    "name",
    "track",
    "provider",
    "coordinator",
    "supervisor",
    "coach",
    "pathway",
    "delivery_model",
    "start_date",
  ],
  contacts: [
    "student_id",
    "channel",
    "outcome",
    "occurred_at",
    "proof_id",
    "next_action",
    "owner",
    "due",
  ],
  tasks: ["title", "owner", "due"],
  sessions: [
    "id",
    "group_id",
    "coach_id",
    "title",
    "starts_at",
    "week",
    "duration_minutes",
  ],
  attendance: ["session_id", "student_id", "status", "source"],
  task_bank: ["id", "track", "title", "platform", "value"],
  accounts: ["id", "label", "platform", "credits"],
  requests: ["student_id", "task_bank_id", "job_profile", "gig_number"],
  gigs: [
    "id",
    "student_id",
    "platform",
    "title",
    "value",
    "order_ref",
    "due",
  ],
  evidence: [
    "student_id",
    "gig_id",
    "proof_id",
    "payment_proof_id",
    "source",
  ],
  cases: ["student_id", "title", "type", "severity", "owner", "due"],
  applications: ["id", "name", "preferred_track", "source", "owner"],
  assessments: [
    "id",
    "group_id",
    "title",
    "type",
    "max_score",
    "pass_score",
    "due_at",
  ],
  assessment_results: ["id", "assessment_id", "student_id", "score"],
  withdrawals: [
    "id",
    "student_id",
    "ministry_reference",
    "decision",
    "decided_at",
    "reason",
  ],
  post_program_outcomes: [
    "id",
    "student_id",
    "type",
    "title",
    "status",
    "follow_up_at",
    "owner",
  ],
};
/**
 * Update mode: a spreadsheet that modifies records that already exist.
 *
 * Operations data arrives from several sources (ministry lists, provider
 * sheets, the previous cohort's workbook), each holding a few columns for
 * the same people. A sheet in update mode is matched to existing records
 * and only the columns it carries are changed; an empty cell leaves the
 * stored value alone, so partial sheets merge instead of blanking data.
 *
 * Fields that the workflow governs with their own rules (moving a student,
 * lifecycle and engagement states, account status) are refused here with a
 * pointer to the action that owns them, so a spreadsheet can never bypass
 * the evidence and approvals those actions require.
 */
type UpdateSpec = {
  table: string;
  /** Columns that identify the record; the first present one is used. */
  keys: string[];
  editable: string[];
  /** Governed columns: accepted only when the value already matches. */
  protectedHints: Record<string, string>;
  /** Columns that must stay unique across the table. */
  unique: string[];
  roles: string[];
};
const updatable: Record<string, UpdateSpec> = {
  students: {
    table: "students",
    keys: ["id", "email", "national_id", "tp_id"],
    editable: ["name", "name_ar", "email", "phone", "national_id", "tp_id", "job_profile", "student_type", "coaching"],
    protectedHints: {
      group_id: "Use the Transfer action to move a student between groups",
      lifecycle: "Use the Lifecycle action; it records the reason and evidence",
      engagement: "Use the Engagement action; it records the reason and evidence",
    },
    unique: ["email", "national_id", "tp_id"],
    roles: ["Project Operations", "Operations Coordinator", "Operations Systems / Admin"],
  },
  groups: {
    table: "groups",
    keys: ["id"],
    editable: ["name", "track", "provider", "coordinator", "supervisor", "coach", "account_manager", "pathway", "delivery_model", "start_date"],
    protectedHints: {
      status: "Use the group close, gate and archive actions to change a group's status",
      policy_id: "Policies are applied through the policy approval workflow",
    },
    unique: [],
    roles: ["Project Operations", "Operations Systems / Admin"],
  },
  accounts: {
    table: "accounts",
    keys: ["id"],
    editable: ["label", "platform", "credits"],
    protectedHints: {
      status: "Use the account status action; blocking and retiring are audited decisions",
      secret_ref: "Credentials are managed from the credential panel",
    },
    unique: [],
    roles: ["Project Operations", "Operations Systems / Admin"],
  },
};
const platforms = ["Kafeel", "Nafezly", "Khamsat"];

/** Reference data an update review needs, fetched once per batch. */
type Lookups = { users: Set<string>; tracks: Set<string> };

/** Field-level validation of a new value for an update; returns an error or null. */
function validateUpdate(module: string, field: string, value: string, lookups: Lookups) {
  if (module === "students") {
    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "A valid student email is required for Supabase sign-in";
    if (field === "national_id" && !/^\d{14}$/.test(value)) return "The national ID is the 14-digit number on the roster";
    if (field === "name" && value.length < 2) return "Name is too short";
    if (field === "coaching" && value.length > 80) return "Coaching status is too long";
  }
  if (module === "groups") {
    if (["coordinator", "supervisor", "coach", "account_manager"].includes(field) && !lookups.users.has(value))
      return "Not an active staff member (use the staff ID, not the name)";
    if (field === "track" && !lookups.tracks.has(value)) return "Not an active approved track";
    if (field === "pathway" && !["Outcome", "Support"].includes(value)) return "Pathway must be Outcome or Support";
    if (field === "delivery_model" && !["Regular", "Industry"].includes(value)) return "Delivery model must be Regular or Industry";
    if (field === "start_date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) return "Start date must be YYYY-MM-DD";
  }
  if (module === "accounts") {
    if (field === "platform" && !platforms.includes(value)) return "Platform must be " + platforms.join(", ");
    if (field === "credits" && !(Number.isFinite(Number(value)) && Number(value) >= 0)) return "Credits must be a number of at least 0";
  }
  return null;
}

const same = (a: any, b: any) => String(a ?? "").trim() === String(b ?? "").trim();
const keyExpr = (field: string) => (field === "email" ? "lower(email)" : field === "id" ? "id" : `trim(${field})`);

/** `SELECT ... WHERE expr IN (...)` in slices, so a large sheet costs a few round trips instead of one per row. */
async function fetchIn(table: string, columns: string, field: string, values: string[]) {
  const rows: any[] = [];
  const distinct = [...new Set(values)];
  for (let i = 0; i < distinct.length; i += 400) {
    const slice = distinct.slice(i, i + 400);
    const result = await stmt(
      `SELECT ${columns} FROM ${table} WHERE ${keyExpr(field)} IN (${slice.map(() => "?").join(",")})`,
      ...slice,
    ).all();
    rows.push(...(result.results || []));
  }
  return rows;
}

async function reviewUpdates(u: any, module: string, rows: any[]) {
  const spec = updatable[module];
  ensure(spec, "Update mode is available for students, groups and accounts.");
  ensure(can(u.roles, spec.roles), "You are not permitted to update this module.");
  const known = new Set([...spec.keys, ...spec.editable, ...Object.keys(spec.protectedHints)]);

  // Pass 1: normalize every row and note which identifiers it carries.
  // Exported sheets carry derived columns (track, risk, next task) and sheets
  // from other sources carry their own; both are ignored rather than rejected,
  // and reported so a misspelt column name does not pass unnoticed.
  const ignored = new Set<string>();
  const prepared = rows.map((row) => {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const value = String(v ?? "").trim();
      if (!known.has(k)) {
        if (value) ignored.add(k);
        continue;
      }
      clean[k] = k === "email" ? value.toLowerCase() : value;
    }
    return { row, clean, keyField: spec.keys.find((k) => clean[k]) };
  });

  // Pass 2: everything the review needs, in a handful of queries.
  const current = new Map<string, any>(); // "field:value" -> record
  for (const field of spec.keys) {
    const values = prepared.filter((p) => p.keyField === field).map((p) => p.clean[field]);
    if (!values.length) continue;
    for (const record of await fetchIn(spec.table, "*", field, values))
      current.set(`${field}:${String(record[field] ?? "").trim().toLowerCase()}`, record);
  }
  const taken = new Map<string, string>(); // "field:value" -> id of the record already holding it
  for (const field of spec.unique) {
    const values = prepared.map((p) => p.clean[field]).filter(Boolean);
    if (!values.length) continue;
    for (const record of await fetchIn(spec.table, `id, ${field}`, field, values))
      taken.set(`${field}:${String(record[field] ?? "").trim().toLowerCase()}`, record.id);
  }
  const scope = scopeSql(u);
  const groupsInScope =
    module === "students" && scope.sql !== "1=1"
      ? new Set(((await stmt(`SELECT g.id FROM groups g WHERE ${scope.sql}`, ...scope.args).all()).results || []).map((g: any) => g.id))
      : null;
  const lookups: Lookups = {
    users: new Set(((await stmt("SELECT id FROM users WHERE active=1").all()).results || []).map((r: any) => r.id)),
    tracks: new Set(((await stmt("SELECT name FROM tracks WHERE active=1").all()).results || []).map((r: any) => r.name)),
  };

  // Pass 3: the review itself, entirely in memory.
  const claimed = new Map<string, string>(); // "field:value" -> record, for uniqueness inside the batch
  const touched = new Set<string>();
  const checked: any[] = [];
  prepared.forEach(({ row, clean, keyField }, i) => {
    const line = i + 2;
    const errors: any[] = [];
    if (!keyField) {
      errors.push({ row: line, field: spec.keys[0], error: "No identifier", expected: spec.keys.join(" or ") });
      checked.push({ row: line, data: row, errors, changes: [], status: "Rejected" });
      return;
    }
    const record = current.get(`${keyField}:${clean[keyField].toLowerCase()}`);
    if (!record) {
      errors.push({ row: line, field: keyField, value: clean[keyField], error: "No existing record matches", expected: "An existing " + module.replace(/s$/, "") });
      checked.push({ row: line, data: row, errors, changes: [], status: "Rejected" });
      return;
    }
    if (touched.has(record.id)) errors.push({ row: line, field: keyField, value: clean[keyField], error: "The same record appears twice in this sheet", expected: "One row per record" });
    touched.add(record.id);
    if (groupsInScope && !groupsInScope.has(record.group_id))
      errors.push({ row: line, field: keyField, value: clean[keyField], error: "Student is outside your scope", expected: "A student in one of your groups" });
    const changes: any[] = [];
    for (const [field, hint] of Object.entries(spec.protectedHints))
      if (clean[field] && !same(clean[field], record[field]))
        errors.push({ row: line, field, value: clean[field], error: hint, expected: String(record[field] ?? "") });
    for (const field of spec.editable) {
      const value = clean[field];
      if (value === undefined || value === "" || field === keyField) continue;
      const normalized = field === "credits" && Number.isFinite(Number(value)) ? String(Number(value)) : value;
      if (same(normalized, record[field])) continue;
      const problem = validateUpdate(module, field, normalized, lookups);
      if (problem) {
        errors.push({ row: line, field, value, error: problem, expected: "A valid " + field.replace(/_/g, " ") });
        continue;
      }
      if (spec.unique.includes(field)) {
        const tag = `${field}:${normalized.toLowerCase()}`;
        const holder = taken.get(tag);
        if (claimed.has(tag) || (holder && holder !== record.id)) {
          errors.push({ row: line, field, value, error: "Already used by another record", expected: "A unique " + field.replace(/_/g, " ") });
          continue;
        }
        claimed.set(tag, record.id);
      }
      changes.push({ field, from: record[field] ?? "", to: normalized });
    }
    checked.push({
      row: line,
      id: record.id,
      data: row,
      errors,
      changes,
      status: errors.length ? "Rejected" : changes.length ? "Ready" : "Unchanged",
    });
  });
  return { spec, checked, ignored: [...ignored] };
}

const programModules = new Set([
  "applications",
  "assessments",
  "assessment_results",
  "withdrawals",
  "post_program_outcomes",
]);
export async function POST(req: Request) {
  try {
    const u = await actor();
    await rateLimit("import:" + u.id, 20, 60);
    const x = await req.json();
    // Creating runs every row through its workflow action; updating is checked
    // in bulk, so a whole roster's worth of corrections fits in one upload.
    const limit = x.mode === "update" ? 5000 : 1000;
    ensure(
      Array.isArray(x.rows) && x.rows.length <= limit && x.rows.length > 0,
      `Import between 1 and ${limit.toLocaleString("en-US")} rows at a time.`,
    );
    if (x.mode === "update") return await updateRecords(u, x);
    ensure(
      allowed[x.module],
      "Import is not enabled for this module. Calculated and protected records are export-only.",
    );
    const columns = allowed[x.module];
    const seen = new Set();
    const checked = [];
    for (let i = 0; i < x.rows.length; i++) {
      const row = x.rows[i];
      const errors = [];
      for (const k of Object.keys(row))
        if (!columns.includes(k))
          errors.push({
            row: i + 2,
            field: k,
            value: row[k],
            error: "Unknown or protected column",
            expected: columns.join(", "),
          });
      if (x.module === "students") {
        row.email = String(row.email || "").trim().toLowerCase();
        row.lifecycle = String(row.lifecycle || "Active").trim();
        row.engagement = String(row.engagement || "Active").trim();
        row.coaching = String(row.coaching || "In Progress").trim();
        if (
          seen.has(row.id) ||
          (await stmt(
            "SELECT id FROM students WHERE id=?",
            row.id || "",
          ).first())
        )
          errors.push({
            row: i + 2,
            field: "id",
            value: row.id,
            error:
              "Duplicate student ID; existing students are not overwritten",
            expected: "Unique ID",
          });
        if (
          !(await stmt(
            "SELECT id FROM groups WHERE id=?",
            row.group_id || "",
          ).first())
        )
          errors.push({
            row: i + 2,
            field: "group_id",
            value: row.group_id,
            error: "Group does not exist",
            expected: "Existing group ID",
          });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
          errors.push({
            row: i + 2,
            field: "email",
            value: row.email,
            error: "A valid student email is required for Supabase sign-in",
            expected: "Unique email address",
          });
        if (
          row.email &&
          (seen.has(`email:${row.email}`) ||
            (await stmt("SELECT id FROM students WHERE email IS NOT NULL AND trim(email)<>'' AND lower(email)=?", row.email).first()))
        )
          errors.push({
            row: i + 2,
            field: "email",
            value: row.email,
            error: "Duplicate student email; one identity cannot access two records",
            expected: "Unique email address",
          });
        if (!["Active", "Paused", "Transferred", "Withdrawn", "Removed", "Graduate Closed", "Non-Graduate Closed"].includes(row.lifecycle))
          errors.push({ row: i + 2, field: "lifecycle", value: row.lifecycle, error: "Invalid lifecycle status", expected: "Active, Paused, Transferred, Withdrawn, Removed, Graduate Closed, or Non-Graduate Closed" });
        if (!["Active", "At Risk", "Critical", "Unresponsive"].includes(row.engagement))
          errors.push({ row: i + 2, field: "engagement", value: row.engagement, error: "Invalid engagement status", expected: "Active, At Risk, Critical, or Unresponsive" });
        seen.add(row.id);
        if (row.email) seen.add(`email:${row.email}`);
      }
      for (const k of required[x.module])
        if (
          row[k] === undefined ||
          row[k] === null ||
          String(row[k]).trim() === ""
        )
          errors.push({
            row: i + 2,
            field: k,
            error: "Required field missing",
            expected: "Non-empty value",
          });
      if (x.module === "applications" && !row.email && !row.phone)
        errors.push({
          row: i + 2,
          field: "email/phone",
          error: "Applicant contact method missing",
          expected: "At least one email address or phone number",
        });
      checked.push({
        row: i + 2,
        data: row,
        errors,
        status: errors.length ? "Rejected" : "Ready",
      });
    }
    if (!x.confirm)
      return Response.json({
        rows: checked,
        columns,
        notice:
          "Commit rechecks permissions and every workflow rule. Protected statuses cannot be imported.",
      });
    ensure(x.batch_id, "Import batch identifier is required.");
    const existing: any = await stmt(
      "SELECT summary FROM imports WHERE id=? AND actor=?",
      x.batch_id,
      u.id,
    ).first();
    if (existing) return Response.json(JSON.parse(existing.summary));
    const result: any = {
      created: 0,
      updated: 0,
      skipped: 0,
      conflicted: 0,
      rejected: 0,
      errors: [],
    };
    const rowRecords: any[] = [];
    for (const c of checked) {
      let status = "Created";
      const recordId = c.data.id || null;
      if (c.errors.length) {
        result.rejected++;
        result.errors.push(...c.errors);
        status = "Rejected";
      } else {
        const handler = programModules.has(x.module) ? program : operate;
        const route = programModules.has(x.module) ? "/program" : "/operations";
        const r = await handler(
          new Request(req.url.replace("/import", route), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...c.data,
              action: actions[x.module],
              request_id: x.batch_id + "-" + c.row,
            }),
          }),
        );
        const body: any = await r.json();
        if (body.error) {
          result.rejected++;
          result.errors.push({
            row: c.row,
            field: "workflow",
            error: body.error,
            expected: "Valid authorized workflow operation",
          });
          status = "Rejected";
        } else if (body.replayed) {
          result.skipped++;
          status = "Skipped";
        } else result.created++;
      }
      rowRecords.push(
        stmt(
          "INSERT INTO import_rows VALUES(?,?,?,?,?,?)",
          uid("IMROW"),
          x.batch_id,
          c.row,
          status,
          status === "Rejected"
            ? JSON.stringify(
                c.errors.length
                  ? c.errors
                  : result.errors.filter((e: any) => e.row === c.row),
              )
            : null,
          recordId,
        ),
      );
    }
    await db().batch([
      stmt(
        "INSERT INTO imports VALUES(?,?,?,?,?)",
        x.batch_id,
        u.id,
        x.module,
        JSON.stringify(result),
        now(),
      ),
      ...rowRecords,
      auditStmt(u, "Spreadsheet import", x.module, result),
    ]);
    return Response.json(result);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

async function updateRecords(u: any, x: any) {
  const { spec, checked, ignored } = await reviewUpdates(u, x.module, x.rows);
  if (!x.confirm)
    return Response.json({
      rows: checked,
      columns: [...spec.keys, ...spec.editable],
      ignored,
      mode: "update",
      notice:
        "Only the columns in the sheet change; empty cells keep the stored value. Governed fields (group, lifecycle, engagement, status) are rejected here and changed through their own actions.",
    });
  ensure(x.batch_id, "Import batch identifier is required.");
  const existing: any = await stmt("SELECT summary FROM imports WHERE id=? AND actor=?", x.batch_id, u.id).first();
  if (existing) return Response.json(JSON.parse(existing.summary));
  const result: any = { mode: "update", created: 0, updated: 0, skipped: 0, conflicted: 0, rejected: 0, errors: [] };
  const jobs: any[] = [];
  for (const c of checked) {
    let status = "Updated";
    if (c.status === "Rejected") {
      result.rejected++;
      result.errors.push(...c.errors);
      status = "Rejected";
    } else if (c.status === "Unchanged") {
      result.skipped++;
      status = "Skipped";
    } else {
      result.updated++;
      const sets = c.changes.map((ch: any) => `${ch.field}=?`).join(",");
      jobs.push(
        stmt(
          `UPDATE ${spec.table} SET ${sets} WHERE id=?`,
          ...c.changes.map((ch: any) => (ch.field === "credits" ? Number(ch.to) : ch.to)),
          c.id,
        ),
        auditStmt(
          u,
          "Spreadsheet update",
          c.id,
          Object.fromEntries(c.changes.map((ch: any) => [ch.field, ch.to])),
          Object.fromEntries(c.changes.map((ch: any) => [ch.field, ch.from])),
          x.batch_id + "-" + c.row,
        ),
      );
    }
    jobs.push(
      stmt(
        "INSERT INTO import_rows VALUES(?,?,?,?,?,?)",
        uid("IMROW"),
        x.batch_id,
        c.row,
        status,
        status === "Rejected" ? JSON.stringify(c.errors) : null,
        c.id || null,
      ),
    );
  }
  await db().batch([
    stmt("INSERT INTO imports VALUES(?,?,?,?,?)", x.batch_id, u.id, x.module, JSON.stringify(result), now()),
    ...jobs,
    auditStmt(u, "Spreadsheet import", x.module, result),
  ]);
  return Response.json(result);
}
