import { actor, auditStmt, rateLimit } from "@/lib/server";
import { report } from "@/lib/reports";
import { toCSV, toXLSX } from "@/lib/spreadsheet";
export async function GET(req: Request) {
  try {
    const u = await actor();
    await rateLimit("reports:" + u.id, 60, 60);
    const q = new URL(req.url).searchParams;
    const data = await report(
      u,
      q.get("from") || undefined,
      q.get("to") || undefined,
    );
    const format = q.get("format");
    if (format) {
      await auditStmt(u, "Report export", "reports", {
        from: q.get("from"),
        to: q.get("to"),
        format,
      }).run();
      const rows = q.get("dataset") === "service_links" ? data.service_links.groups : data.groups;
      const filename = q.get("dataset") === "service_links" ? "depi-service-link-report" : "depi-group-report";
      return new Response(
        format === "xlsx"
          ? (toXLSX(rows).buffer as ArrayBuffer)
          : toCSV(rows),
        {
          headers: {
            "Content-Type":
              format === "xlsx"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "text/csv",
            "Content-Disposition": `attachment; filename="${filename}.${format === "xlsx" ? "xlsx" : "csv"}"`,
            "Cache-Control": "private,no-store",
          },
        },
      );
    }
    return Response.json(data, {
      headers: { "Cache-Control": "private,no-store" },
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
