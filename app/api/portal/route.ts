import { actor, all, auditStmt, db, now, rateLimit, refuseDemo, scopeSql, stmt, uid } from "@/lib/server";
import { can, ensure } from "@/lib/domain/rules";
import {
  linkStudent,
  mappingProblems,
  portalFields,
  portalGigRow,
  portalStudentRow,
  portalUploadRoles,
  type PortalSheet,
} from "@/lib/domain/portal-sheets";

export const dynamic = "force-dynamic";

// The DEPI portal's students and gigs sheets, uploaded by the leaders several
// times a day. An upload arrives in chunks into a staging batch and replaces
// the sheet's previous upload only when every row has arrived, so a reader
// never sees half a sheet. See lib/domain/portal-sheets.ts.

// The quality team reads the whole cohort too: they check services against it.
const leaders = ["Higher Board", "Operations Systems / Admin", "Quality Member", ...portalUploadRoles];
const sheets: PortalSheet[] = ["students", "gigs"];
const chunkLimit = 1000;
const mappingName = "DEPI portal export";

const uploads = (u: any) => can(u.roles, ["Operations Systems / Admin", ...portalUploadRoles]);

/** The rows a person may read: the whole cohort for leaders, their own linked students otherwise. */
async function scopedStudentIds(u: any) {
  if (can(u.roles, leaders)) return null;
  const q = scopeSql(u);
  const rows = await all(`SELECT s.id FROM students s JOIN groups g ON g.id=s.group_id WHERE ${q.sql}`, ...q.args);
  return new Set(rows.map((r: any) => r.id));
}

async function activeBatch(sheet: PortalSheet) {
  return (await stmt(
    "SELECT * FROM portal_uploads WHERE sheet=? AND status='Active' ORDER BY committed_at DESC LIMIT 1",
    sheet,
  ).first()) as any;
}

export async function GET(req: Request) {
  try {
    const u = await actor();
    refuseDemo(u);
    await rateLimit("portal:" + u.id, 60, 60);
    const scope = await scopedStudentIds(u);
    ensure(scope === null || can(u.roles, ["Operations Coordinator", "Coach"]), "The portal view is for the leaders, the quality team and the coordinators.");
    const url = new URL(req.url);
    const [students, gigs] = await Promise.all([activeBatch("students"), activeBatch("gigs")]);
    // One student's gigs, on request.
    const portalId = url.searchParams.get("student");
    if (portalId) {
      const owner: any = students
        ? await stmt("SELECT student_id FROM portal_students WHERE batch_id=? AND portal_id=?", students.batch_id, portalId).first()
        : null;
      ensure(scope === null || (owner?.student_id && scope.has(owner.student_id)), "This student is outside your scope.");
      const rows = gigs
        ? await all(
            "SELECT * FROM portal_gigs WHERE batch_id=? AND portal_student_id=? ORDER BY created_on DESC",
            gigs.batch_id,
            portalId,
          )
        : [];
      return Response.json({ gigs: rows });
    }
    // Possible duplicates in the gigs sheet: one gig link or one proof claimed
    // by two or more students, and a student listing the same link more than
    // once. Shown for review; nothing is removed.
    if (url.searchParams.get("duplicates")) {
      if (!gigs) return Response.json({ shared: [], proofs: [], repeats: [] });
      const names = students
        ? new Map(
            (await all("SELECT portal_id,full_name,student_id FROM portal_students WHERE batch_id=?", students.batch_id)).map((r: any) => [String(r.portal_id), r]),
          )
        : new Map<string, any>();
      const inScope = (portalId: string) => scope === null || (names.get(String(portalId))?.student_id && scope.has(names.get(String(portalId)).student_id));
      const who = (portalId: string) => ({ portal_id: portalId, name: names.get(String(portalId))?.full_name || portalId, student_id: names.get(String(portalId))?.student_id || null });
      const cluster = async (column: "url" | "proof_url") =>
        (
          await all(
            `SELECT lower(trim(${column})) link, group_concat(portal_student_id) people, count(*) n
             FROM portal_gigs WHERE batch_id=? AND coalesce(trim(${column}),'')<>''
             GROUP BY 1 HAVING count(DISTINCT portal_student_id)>1 ORDER BY 3 DESC LIMIT 300`,
            gigs.batch_id,
          )
        )
          .map((r: any) => ({ link: r.link, count: Number(r.n), students: [...new Set(String(r.people).split(","))].map(who) }))
          .filter((r: any) => r.students.some((s: any) => inScope(s.portal_id)));
      const repeats = (
        await all(
          `SELECT portal_student_id, lower(trim(url)) link, count(*) n FROM portal_gigs
           WHERE batch_id=? AND coalesce(trim(url),'')<>'' GROUP BY 1,2 HAVING count(*)>1 ORDER BY 3 DESC LIMIT 500`,
          gigs.batch_id,
        )
      )
        .filter((r: any) => inScope(r.portal_student_id))
        .map((r: any) => ({ ...who(r.portal_student_id), link: r.link, count: Number(r.n) }));
      return Response.json({ shared: await cluster("url"), proofs: await cluster("proof_url"), repeats });
    }
    const studentRows = students
      ? await all(
          `SELECT p.portal_id,p.email,p.full_name,p.phone,p.round_code,p.provider,p.track,p.profile,p.status,p.final_status,
                  p.graduate_type,p.total_gigs,p.approved_gigs,p.rejected_gigs,p.total_revenue,p.student_id,
                  s.name app_name,s.group_id,g.coordinator,c.name coordinator_name
           FROM portal_students p
           LEFT JOIN students s ON s.id=p.student_id
           LEFT JOIN groups g ON g.id=s.group_id
           LEFT JOIN users c ON c.id=g.coordinator
           WHERE p.batch_id=?`,
          students.batch_id,
        )
      : [];
    // The gigs sheet, counted per student, so the list carries what the portal says.
    const gigCounts = gigs
      ? await all(
          `SELECT portal_student_id,count(*) total,
                  sum(CASE WHEN status='Approved' THEN 1 ELSE 0 END) approved,
                  sum(CASE WHEN status='Rejected' THEN 1 ELSE 0 END) rejected,
                  sum(CASE WHEN auditor_status='Pending' THEN 1 ELSE 0 END) audit_pending,
                  sum(CASE WHEN status='Approved' THEN price ELSE 0 END) approved_value
           FROM portal_gigs WHERE batch_id=? GROUP BY portal_student_id`,
          gigs.batch_id,
        )
      : [];
    const history = await all("SELECT id,sheet,status,file_name,rows_total,rows_linked,uploaded_by,created_at,committed_at FROM portal_uploads ORDER BY created_at DESC LIMIT 20");
    const mappings = Object.fromEntries(
      await Promise.all(
        sheets.map(async (sheet) => {
          const saved: any = await stmt("SELECT mapping FROM import_mappings WHERE module=? AND name=?", "portal_" + sheet, mappingName).first();
          return [sheet, saved ? JSON.parse(saved.mapping) : null];
        }),
      ),
    );
    return Response.json({
      canUpload: uploads(u),
      fields: portalFields,
      mappings,
      active: { students, gigs },
      history,
      students: scope === null ? studentRows : studentRows.filter((r: any) => r.student_id && scope.has(r.student_id)),
      gigCounts: scope === null ? gigCounts : gigCounts.filter((g: any) => studentRows.some((r: any) => r.portal_id === g.portal_student_id && r.student_id && scope.has(r.student_id))),
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    refuseDemo(u);
    ensure(uploads(u), "The portal sheets are uploaded by supervisors, Project Operations, Coach Operations, the Quality Lead and administrators.");
    await rateLimit("portal-upload:" + u.id, 120, 60);
    const x = await req.json();
    const t = now();

    // 1. A new upload: the sheet, its column mapping and how many rows will come.
    if (x.action === "begin") {
      const sheet = x.sheet as PortalSheet;
      ensure(sheets.includes(sheet), "Choose the students sheet or the gigs sheet.");
      const mapping = (x.mapping || {}) as Record<string, string>;
      const known = new Set(portalFields[sheet].map((f) => f.field));
      ensure(Object.values(mapping).every((f) => !f || known.has(f)), "The mapping names a field this sheet does not have.");
      const missing = mappingProblems(sheet, mapping);
      ensure(!missing.length, `Map these columns first: ${missing.join(", ")}.`);
      const total = Number(x.total);
      ensure(Number.isInteger(total) && total > 0 && total <= 50000, "The sheet must have between 1 and 50,000 rows.");
      const batch = uid("PBATCH");
      const saved: any = await stmt("SELECT id FROM import_mappings WHERE module=? AND name=?", "portal_" + sheet, mappingName).first();
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, f]) => f));
      await db().batch([
        // Staging left behind by an upload that never finished is cleared.
        stmt(`DELETE FROM portal_${sheet} WHERE batch_id IN (SELECT batch_id FROM portal_uploads WHERE sheet=? AND status='Staging' AND created_at<?)`, sheet, new Date(Date.now() - 3600000).toISOString()),
        stmt("UPDATE portal_uploads SET status='Abandoned' WHERE sheet=? AND status='Staging' AND created_at<?", sheet, new Date(Date.now() - 3600000).toISOString()),
        stmt(
          "INSERT INTO portal_uploads(id,sheet,batch_id,status,file_name,rows_total,rows_linked,mapping,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
          uid("PUP"),
          sheet,
          batch,
          "Staging",
          String(x.file_name || "").slice(0, 200) || null,
          total,
          0,
          JSON.stringify(clean),
          u.id,
          t,
        ),
        // The mapping is remembered, so the next upload of the same export maps itself.
        saved
          ? stmt("UPDATE import_mappings SET mapping=?,updated_at=? WHERE id=?", JSON.stringify(clean), t, saved.id)
          : stmt(
              "INSERT INTO import_mappings(id,module,name,key_field,mapping,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
              uid("IMAP"),
              "portal_" + sheet,
              mappingName,
              sheet === "students" ? "portal_id" : "portal_gig_id",
              JSON.stringify(clean),
              u.id,
              t,
              t,
            ),
      ]);
      return Response.json({ batch });
    }

    const upload: any = await stmt("SELECT * FROM portal_uploads WHERE batch_id=?", x.batch).first();
    ensure(upload && upload.status === "Staging", "This upload has finished or was replaced. Start it again.");
    ensure(upload.uploaded_by === u.id, "Only the person who started an upload can add to it.");
    const sheet = upload.sheet as PortalSheet;

    // 2. A chunk of mapped rows, cleaned and linked to our students.
    if (x.action === "chunk") {
      const rows = Array.isArray(x.rows) ? x.rows : [];
      ensure(rows.length > 0 && rows.length <= chunkLimit, `Send between 1 and ${chunkLimit} rows at a time.`);
      const jobs: any[] = [];
      if (sheet === "students") {
        const people = await all("SELECT id,email,phone FROM students");
        const byEmail = new Map<string, string>();
        const byPhone = new Map<string, string>();
        for (const p of people) {
          if (p.email) byEmail.set(String(p.email).trim().toLowerCase(), p.id);
          for (const phone of String(p.phone || "").split(" / ")) if (phone) byPhone.set(phone.trim(), p.id);
        }
        const clean = rows.map(portalStudentRow).filter((r: any) => r.portal_id);
        const columns = ["id", "batch_id", "student_id", ...Object.keys(portalStudentRow({}))];
        for (let i = 0; i < clean.length; i += 200) {
          const part = clean.slice(i, i + 200);
          jobs.push(
            stmt(
              `INSERT INTO portal_students(${columns.join(",")}) VALUES ${part.map(() => `(${columns.map(() => "?").join(",")})`).join(",")}`,
              ...part.flatMap((r: any) => [uid("PST"), upload.batch_id, linkStudent(r, byEmail, byPhone), ...Object.values(r)]),
            ),
          );
        }
      } else {
        const clean = rows.map(portalGigRow).filter((r: any) => r.portal_gig_id && r.portal_student_id);
        const columns = ["id", "batch_id", ...Object.keys(portalGigRow({}))];
        for (let i = 0; i < clean.length; i += 200) {
          const part = clean.slice(i, i + 200);
          jobs.push(
            stmt(
              `INSERT INTO portal_gigs(${columns.join(",")}) VALUES ${part.map(() => `(${columns.map(() => "?").join(",")})`).join(",")}`,
              ...part.flatMap((r: any) => [uid("PGG"), upload.batch_id, ...Object.values(r)]),
            ),
          );
        }
      }
      if (jobs.length) await db().batch(jobs);
      return Response.json({ ok: true, received: jobs.length ? rows.length : 0 });
    }

    // 3. Every row is in: this upload becomes the sheet's current one, and the
    // one before it is cleared.
    if (x.action === "commit") {
      const table = `portal_${sheet}`;
      const count: any = await stmt(`SELECT count(*) n FROM ${table} WHERE batch_id=?`, upload.batch_id).first();
      ensure(Number(count.n) > 0, "No rows arrived for this upload.");
      const linked: any =
        sheet === "students"
          ? await stmt("SELECT count(*) n FROM portal_students WHERE batch_id=? AND student_id IS NOT NULL", upload.batch_id).first()
          : await stmt(
              `SELECT count(*) n FROM portal_gigs x WHERE x.batch_id=? AND EXISTS (
                 SELECT 1 FROM portal_students p JOIN portal_uploads a ON a.batch_id=p.batch_id
                 WHERE a.sheet='students' AND a.status='Active' AND p.portal_id=x.portal_student_id)`,
              upload.batch_id,
            ).first();
      const previous = await all("SELECT batch_id FROM portal_uploads WHERE sheet=? AND status='Active'", sheet);
      await db().batch([
        ...previous.map((p: any) => stmt(`DELETE FROM ${table} WHERE batch_id=?`, p.batch_id)),
        stmt("UPDATE portal_uploads SET status='Replaced' WHERE sheet=? AND status='Active'", sheet),
        stmt(
          "UPDATE portal_uploads SET status='Active',rows_total=?,rows_linked=?,committed_at=? WHERE batch_id=?",
          Number(count.n),
          Number(linked.n),
          t,
          upload.batch_id,
        ),
        auditStmt(u, "Portal sheet uploaded", upload.batch_id, { sheet, rows: Number(count.n), linked: Number(linked.n), file: upload.file_name }),
      ]);
      return Response.json({ ok: true, rows: Number(count.n), linked: Number(linked.n) });
    }

    // An upload given up on: its staged rows go.
    if (x.action === "cancel") {
      await db().batch([
        stmt(`DELETE FROM portal_${sheet} WHERE batch_id=?`, upload.batch_id),
        stmt("UPDATE portal_uploads SET status='Abandoned' WHERE batch_id=?", upload.batch_id),
      ]);
      return Response.json({ ok: true });
    }
    throw new Error("Choose a portal upload action.");
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
