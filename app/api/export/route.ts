import { failure } from "@/lib/errors";
import { actor, all, loadData, auditStmt, stmt, db, uid, now, rateLimit } from "@/lib/server";
import { toCSV, toWorkbook, type Sheet } from "@/lib/spreadsheet";
import { can, dataTransferRefusal, dataTransferRoles, ensure } from "@/lib/domain/rules";

export const dynamic = "force-dynamic";

/**
 * Datasets that can leave the workspace as a spreadsheet, keyed by the name
 * used in the URL and the import dialog. The value is the property of the
 * workspace payload that holds the rows. `workbook` exports all of them as
 * one Excel file with a tab per dataset, so an editor can work on several
 * sheets and upload the tabs that changed.
 */
const datasets: Record<string, string> = {
  students: "students",
  groups: "groups",
  tracks: "tracks",
  staff: "staff",
  tasks: "tasks",
  contacts: "contacts",
  accounts: "accounts",
  requests: "requests",
  gigs: "gigs",
  evidence: "evidence",
  service_links: "serviceLinks",
  cases: "cases",
  sessions: "sessions",
  attendance: "attendance",
  policies: "policies",
  task_bank: "taskBank",
  gates: "gates",
};

/**
 * Exported only, never imported (13 November 2026): client-account orders,
 * students' and coordinators' session feedback from the workspace, and the
 * ministry portal's latest sheets with our quality team's checks of their gigs,
 * read here. Each reaches only the people who see it in the app: the leaders
 * all of it, a supervisor their own students'.
 */
const exportOnly: Record<string, string> = {
  account_orders: "accountOrders",
  session_feedback: "sessionFeedback",
  coordinator_feedback: "sessionNotes",
  portal_students: "",
  portal_gigs: "",
  portal_qc_reviews: "",
};

async function portalSheets(u: any, data: any) {
  const whole = can(u.roles, ["Project Operations", "Operations Systems / Admin", "Coach Operations"]);
  const ours = new Set((data.students || []).map((s: any) => s.id));
  const theirs = (rows: any[]) => (whole ? rows : rows.filter((r) => r.student_id && ours.has(r.student_id)));
  const latest = (sheet: string) =>
    stmt("SELECT batch_id FROM portal_uploads WHERE sheet=? AND status='Active' ORDER BY committed_at DESC LIMIT 1", sheet).first() as Promise<any>;
  const [students, gigs] = await Promise.all([latest("students"), latest("gigs")]);
  const [portalStudents, portalGigs, reviews] = await Promise.all([
    students ? all("SELECT * FROM portal_students WHERE batch_id=? ORDER BY full_name", students.batch_id) : Promise.resolve([] as any[]),
    gigs
      ? all(
          `SELECT z.*,p.student_id FROM portal_gigs z LEFT JOIN portal_students p ON p.batch_id=? AND p.portal_id=z.portal_student_id
           WHERE z.batch_id=? ORDER BY z.portal_student_id,z.created_on`,
          students?.batch_id || "",
          gigs.batch_id,
        )
      : Promise.resolve([] as any[]),
    all(
      `SELECT r.*,q.name reviewer_name,d.name reviewed_by_name FROM portal_gig_reviews r
       LEFT JOIN users q ON q.id=r.reviewer LEFT JOIN users d ON d.id=r.reviewed_by ORDER BY r.portal_student_id,r.assigned_at`,
    ),
  ]);
  return { portal_students: theirs(portalStudents), portal_gigs: theirs(portalGigs), portal_qc_reviews: theirs(reviews) } as Record<string, any[]>;
}

// Heavy or derived fields that only make sense inside the app.
function flat(rows: any[]) {
  return rows.map(({ policy, applied_policy, ...row }) => row);
}

export async function GET(req: Request) {
  try {
    const u = await actor();
    ensure(can(u.roles, dataTransferRoles), dataTransferRefusal);
    await rateLimit("export:" + u.id, 30, 60);
    const url = new URL(req.url);
    const module = url.searchParams.get("module") || "students";
    ensure(module === "workbook" || datasets[module] || module in exportOnly, "This module cannot be exported.");
    const data: any = await loadData(u);
    const portal = module === "workbook" || module.startsWith("portal_") ? await portalSheets(u, data) : {};
    const q = url.searchParams.get("search")?.toLowerCase();
    const from = url.searchParams.get("from"),
      to = url.searchParams.get("to");
    const select = (name: string) => {
      let rows: any[] = flat(portal[name] || data[datasets[name] || exportOnly[name]] || []);
      if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
      if (from) rows = rows.filter((r) => (r.created_at || r.starts_at || r.updated_at || "") >= from);
      if (to) rows = rows.filter((r) => (r.created_at || r.starts_at || r.updated_at || "") <= to + "T23:59:59Z");
      return rows;
    };
    const sheets: Sheet[] =
      module === "workbook"
        ? [...Object.keys(datasets), ...Object.keys(exportOnly)].map((name) => ({ name, rows: select(name) }))
        : [{ name: module, rows: select(module) }];
    const count = sheets.reduce((n, s) => n + s.rows.length, 0);
    const xlsx = module === "workbook" || url.searchParams.get("format") === "xlsx";
    const format = xlsx ? "xlsx" : "csv";
    const filters = { search: q || null, from: from || null, to: to || null };
    await db().batch([
      stmt("INSERT INTO export_jobs VALUES(?,?,?,?,?,?,?)", uid("EXPORT"), u.id, module, format, JSON.stringify(filters), count, now()),
      auditStmt(u, "Export", module, { count, format, filters }),
    ]);
    const stamp = now().slice(0, 10);
    return new Response(xlsx ? (toWorkbook(sheets).buffer as ArrayBuffer) : toCSV(sheets[0].rows), {
      headers: {
        "Content-Type": xlsx
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="depi-${module}-${stamp}.${format}"`,
        "Cache-Control": "private,no-store",
      },
    });
  } catch (e: any) {
    return failure(e, "export");
  }
}
