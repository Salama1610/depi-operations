import {
  actor,
  stmt,
  all,
  permit,
  auditStmt,
  db,
  uid,
  now,
  rateLimit,
} from "@/lib/server";
import { ensure } from "@/lib/domain/rules";
import { POST as operate } from "@/app/api/operations/route";
import { POST as program } from "@/app/api/program/route";
const allowed: Record<string, string[]> = {
  students: ["id", "name", "group_id", "email", "phone"],
  groups: [
    "id",
    "name",
    "track",
    "provider",
    "coordinator",
    "supervisor",
    "coach",
    "pathway",
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
  sessions: ["id", "group_id", "title", "starts_at", "week"],
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
    ensure(
      allowed[x.module],
      "Import is not enabled for this module. Calculated and protected records are export-only.",
    );
    ensure(
      Array.isArray(x.rows) && x.rows.length <= 1000 && x.rows.length > 0,
      "Import between 1 and 1,000 rows at a time.",
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
        if (!row.id || !row.name || !row.group_id)
          errors.push({
            row: i + 2,
            field: "id/name/group_id",
            error: "Required fields missing",
            expected: "Stable student ID, name, existing group ID",
          });
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
        seen.add(row.id);
      }
      for (const k of columns.filter((k) =>
        [
          "student_id",
          "name",
          "title",
          "owner",
          "due",
          "proof_id",
          "next_action",
          "outcome",
          "track",
          "platform",
          "value",
          "task_bank_id",
          "job_profile",
          "gig_number",
          "preferred_track",
          "assessment_id",
          "max_score",
          "pass_score",
          "score",
          "ministry_reference",
          "decision",
          "decided_at",
          "follow_up_at",
        ].includes(k),
      ))
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
      let status = "Created",
        recordId = c.data.id || null;
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
