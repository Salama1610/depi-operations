import { actor, loadData, auditStmt, stmt, db, uid, now, rateLimit } from "@/lib/server";
import { toCSV, toWorkbook, type Sheet } from "@/lib/spreadsheet";
import { ensure } from "@/lib/domain/rules";

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

// Heavy or derived fields that only make sense inside the app.
function flat(rows: any[]) {
  return rows.map(({ policy, applied_policy, ...row }) => row);
}

export async function GET(req: Request) {
  try {
    const u = await actor();
    await rateLimit("export:" + u.id, 30, 60);
    const url = new URL(req.url);
    const module = url.searchParams.get("module") || "students";
    ensure(module === "workbook" || datasets[module], "This module cannot be exported.");
    const data: any = await loadData(u);
    const q = url.searchParams.get("search")?.toLowerCase();
    const from = url.searchParams.get("from"),
      to = url.searchParams.get("to");
    const select = (name: string) => {
      let rows: any[] = flat(data[datasets[name]] || []);
      if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
      if (from) rows = rows.filter((r) => (r.created_at || r.starts_at || r.updated_at || "") >= from);
      if (to) rows = rows.filter((r) => (r.created_at || r.starts_at || r.updated_at || "") <= to + "T23:59:59Z");
      return rows;
    };
    const sheets: Sheet[] =
      module === "workbook"
        ? Object.keys(datasets).map((name) => ({ name, rows: select(name) }))
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
    return Response.json({ error: e.message }, { status: 400 });
  }
}
