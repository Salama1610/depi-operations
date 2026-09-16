import { actor, auditStmt, db, permit, rateLimit, stmt } from "@/lib/server";
import { ensure } from "@/lib/domain/rules";

export const dynamic = "force-dynamic";

const adminRoles = ["Project Operations", "Operations Systems / Admin"];
const studentColumns = [
  "id",
  "tp_id",
  "national_id",
  "name",
  "name_ar",
  "group_id",
  "email",
  "phone",
  "job_profile",
  "student_type",
  "source_status",
  "serial",
  "round_1",
  "source_row",
  "lifecycle",
  "engagement",
  "coaching",
  "milestone",
  "last_contact",
  "created_at",
];

function requiredText(value: unknown, field: string, max = 500) {
  ensure(typeof value === "string" && value.trim() && value.length <= max, `${field} is invalid.`);
  return value.trim();
}

function optionalText(value: unknown, max = 500) {
  if (value === undefined || value === null || value === "") return null;
  ensure(typeof value === "string" && value.length <= max, "An imported text value is invalid.");
  return value.trim();
}

async function importMetadata(x: any) {
  const source = x.import;
  ensure(source && Array.isArray(x.tracks) && Array.isArray(x.groups), "Roster metadata is incomplete.");
  ensure(x.tracks.length > 0 && x.tracks.length <= 50, "Roster track count is invalid.");
  ensure(x.groups.length > 0 && x.groups.length <= 500, "Roster group count is invalid.");
  const importId = requiredText(source.id, "Import ID", 80);
  const sourceHash = requiredText(source.source_sha256, "Source hash", 64);
  ensure(/^[a-f0-9]{64}$/.test(sourceHash), "Source hash is invalid.");
  ensure(Number(source.total_rows) > 0 && Number(source.canonical_students) > 0, "Roster totals are invalid.");
  ensure(
    await stmt("SELECT id FROM policies WHERE id='R5-v1' AND status='Effective'").first(),
    "Initialize the production workspace before importing the roster.",
  );

  const jobs: any[] = [
    stmt(
      "INSERT OR IGNORE INTO users(id,email,name,roles,scopes,active) VALUES(?,?,?,?,?,?)",
      "system-unassigned-coordinator",
      "unassigned+coordinator@invalid.local",
      "Unassigned coordinator",
      JSON.stringify(["Operations Coordinator"]),
      "[]",
      0,
    ),
    stmt(
      "INSERT OR IGNORE INTO users(id,email,name,roles,scopes,active) VALUES(?,?,?,?,?,?)",
      "system-unassigned-supervisor",
      "unassigned+supervisor@invalid.local",
      "Unassigned supervisor",
      JSON.stringify(["Team Supervisor"]),
      "[]",
      0,
    ),
    stmt(
      "INSERT OR IGNORE INTO users(id,email,name,roles,scopes,active) VALUES(?,?,?,?,?,?)",
      "system-unassigned-coach",
      "unassigned+coach@invalid.local",
      "Unassigned coach",
      JSON.stringify(["Coach"]),
      "[]",
      0,
    ),
  ];
  for (const track of x.tracks) {
    jobs.push(
      stmt(
        "INSERT OR IGNORE INTO tracks(id,name,provider,capacity,active,created_at) VALUES(?,?,?,?,?,?)",
        requiredText(track.id, "Track ID", 80),
        requiredText(track.name, "Track name", 160),
        optionalText(track.provider, 160),
        track.capacity == null ? null : Number(track.capacity),
        1,
        requiredText(track.created_at, "Track timestamp", 40),
      ),
    );
  }
  for (const group of x.groups) {
    const id = requiredText(group.id, "Group ID", 80);
    ensure(/^[A-Za-z0-9_-]+$/.test(id), "Group ID is invalid.");
    const delivery = requiredText(group.delivery_model, "Delivery model", 20);
    ensure(["Regular", "Industry"].includes(delivery), "Group delivery model is invalid.");
    jobs.push(
      stmt(
        "INSERT INTO groups(id,name,track,provider,coordinator,supervisor,coach,pathway,delivery_model,start_date,status,policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,track=excluded.track,provider=excluded.provider,pathway=excluded.pathway,delivery_model=excluded.delivery_model,start_date=excluded.start_date,status=excluded.status",
        id,
        requiredText(group.name, "Group name", 160),
        requiredText(group.track, "Group track", 160),
        requiredText(group.provider, "Group provider", 160),
        "system-unassigned-coordinator",
        "system-unassigned-supervisor",
        "system-unassigned-coach",
        "Outcome",
        delivery,
        requiredText(group.start_date, "Group start date", 20),
        "Active",
        "R5-v1",
      ),
    );
  }
  jobs.push(
    stmt(
      "INSERT INTO roster_imports(id,source_name,source_sheet,source_sha256,total_rows,canonical_students,duplicate_rows,status,summary,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary,status='Importing'",
      importId,
      requiredText(source.source_name, "Source name", 255),
      requiredText(source.source_sheet, "Source sheet", 255),
      sourceHash,
      Number(source.total_rows),
      Number(source.canonical_students),
      Number(source.duplicate_rows),
      "Importing",
      JSON.stringify(source.summary || {}),
      requiredText(source.created_at, "Import timestamp", 40),
    ),
  );
  for (let index = 0; index < jobs.length; index += 75)
    await db().batch(jobs.slice(index, index + 75));
  return { importId, created: x.groups.length + x.tracks.length };
}

async function importStudents(x: any) {
  const importId = requiredText(x.import_id, "Import ID", 80);
  ensure(Array.isArray(x.rows) && x.rows.length > 0 && x.rows.length <= 100, "Import 1 to 100 students per batch.");
  ensure(await stmt("SELECT id FROM roster_imports WHERE id=? AND status='Importing'", importId).first(), "Roster import is not open.");
  const jobs: any[] = [];
  for (const row of x.rows) {
    const email = requiredText(row.email, "Student email", 320).toLowerCase();
    ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Student email is invalid.");
    ensure(["Active", "Paused", "Withdrawn"].includes(row.lifecycle), "Student lifecycle is invalid.");
    const values = studentColumns.map((column) => {
      const value = column === "email" ? email : row[column];
      if (["id", "national_id", "name", "group_id", "created_at"].includes(column))
        return requiredText(value, `Student ${column}`, column === "name" ? 300 : 160);
      if (["source_row", "milestone"].includes(column)) return Number(value || 0);
      return optionalText(value, column === "name_ar" ? 300 : 500);
    });
    jobs.push(
      stmt(
        `INSERT INTO students(${studentColumns.join(",")}) VALUES(${studentColumns.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET tp_id=excluded.tp_id,national_id=excluded.national_id,name=excluded.name,name_ar=excluded.name_ar,group_id=excluded.group_id,email=excluded.email,phone=excluded.phone,job_profile=excluded.job_profile,student_type=excluded.student_type,source_status=excluded.source_status,serial=excluded.serial,round_1=excluded.round_1,source_row=excluded.source_row,lifecycle=excluded.lifecycle,engagement=excluded.engagement,coaching=excluded.coaching,created_at=excluded.created_at`,
        ...values,
      ),
    );
  }
  await db().batch(jobs);
  return { importId, created: x.rows.length };
}

async function importSources(x: any) {
  const importId = requiredText(x.import_id, "Import ID", 80);
  ensure(Array.isArray(x.rows) && x.rows.length > 0 && x.rows.length <= 100, "Import 1 to 100 source rows per batch.");
  ensure(await stmt("SELECT id FROM roster_imports WHERE id=? AND status='Importing'", importId).first(), "Roster import is not open.");
  const jobs = x.rows.map((row: any) => {
    const payload = requiredText(row.payload, "Source payload", 20000);
    JSON.parse(payload);
    return stmt(
      "INSERT INTO roster_source_rows(id,import_id,row_number,student_id,disposition,reason,payload) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,disposition=excluded.disposition,reason=excluded.reason,payload=excluded.payload",
      requiredText(row.id, "Source row ID", 120),
      importId,
      Number(row.row_number),
      requiredText(row.student_id, "Source student ID", 160),
      requiredText(row.disposition, "Source disposition", 40),
      optionalText(row.reason, 500),
      payload,
    );
  });
  await db().batch(jobs);
  return { importId, created: x.rows.length };
}

async function finalizeImport(x: any, user: any) {
  const importId = requiredText(x.import_id, "Import ID", 80);
  const batch: any = await stmt("SELECT * FROM roster_imports WHERE id=? AND status='Importing'", importId).first();
  ensure(batch, "Roster import is not open.");
  const students: any = await stmt("SELECT count(*) n,count(DISTINCT lower(email)) emails FROM students").first();
  const sources: any = await stmt("SELECT count(*) n,sum(CASE WHEN disposition='Duplicate merged' THEN 1 ELSE 0 END) duplicates FROM roster_source_rows WHERE import_id=?", importId).first();
  const groups: any = await stmt("SELECT count(*) n FROM groups").first();
  ensure(Number(students.n) === Number(batch.canonical_students), "Student reconciliation count does not match.");
  ensure(Number(students.emails) === Number(batch.canonical_students), "Student email identities are not unique.");
  ensure(Number(sources.n) === Number(batch.total_rows), "Source-row reconciliation count does not match.");
  ensure(Number(sources.duplicates || 0) === Number(batch.duplicate_rows), "Duplicate reconciliation count does not match.");
  ensure(Number(groups.n) > 0, "No roster groups were imported.");
  const result = {
    students: Number(students.n),
    unique_emails: Number(students.emails),
    groups: Number(groups.n),
    source_rows: Number(sources.n),
    duplicate_rows: Number(sources.duplicates || 0),
  };
  await db().batch([
    stmt("UPDATE roster_imports SET status='Reconciled' WHERE id=?", importId),
    auditStmt(user, "Production roster imported", importId, result),
  ]);
  return { importId, ...result, status: "Reconciled" };
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    ensure(!origin || origin === new URL(request.url).origin, "Cross-site requests are not allowed.");
    const user = await actor();
    permit(user, adminRoles);
    await rateLimit(`roster-import:${user.id}`, 360, 60);
    const x = await request.json();
    if (x.stage === "metadata") return Response.json(await importMetadata(x));
    if (x.stage === "students") return Response.json(await importStudents(x));
    if (x.stage === "sources") return Response.json(await importSources(x));
    if (x.stage === "finalize") return Response.json(await finalizeImport(x, user));
    throw new Error("Choose a valid roster import stage.");
  } catch (error: any) {
    return Response.json({ error: error.message || "Roster import failed." }, { status: 400 });
  }
}
