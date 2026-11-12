import { failure } from "@/lib/errors";
import { actor, all, auditStmt, db, now, permit, rateLimit, refuseDemo, stmt } from "@/lib/server";
import { ensure } from "@/lib/domain/rules";
import { readPortalCoachRows } from "@/lib/portal-coaches";

export const dynamic = "force-dynamic";

// The ministry portal's coach for each group, from the portal's Coaches sheet
// (3 November 2026). GET lists it beside each group's own coach; POST reads an
// uploaded sheet and, with apply, makes it the whole list. Coach Gigs then
// sends each group's QC-checked gigs to its portal coach (lib/portal-coaches).

const uploaders = ["Operations Systems / Admin", "Project Operations", "Coach Operations", "Quality Lead"];

async function current() {
  return all(
    `SELECT pc.group_id,pc.coach_name,pc.coach_email,pc.coach_user_id,pc.uploaded_at,u.name coach_user_name,
            g.coach group_coach,h.name group_coach_name
     FROM portal_coaches pc JOIN groups g ON g.id=pc.group_id LEFT JOIN users u ON u.id=pc.coach_user_id LEFT JOIN users h ON h.id=g.coach
     ORDER BY pc.group_id`,
  );
}

export async function GET() {
  try {
    const u = await actor();
    permit(u, uploaders);
    refuseDemo(u);
    return Response.json({ rows: await current() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return failure(e, "portal-coaches");
  }
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    permit(u, uploaders);
    refuseDemo(u);
    await rateLimit("portal-coaches:" + u.id, 20, 60);
    const body = await req.json();
    ensure(Array.isArray(body?.rows), "Upload the portal's Coaches sheet.");
    ensure(body.rows.length <= 2000, "The sheet has too many rows.");
    const rows = readPortalCoachRows(body.rows);
    ensure(rows.length, "No row has a Group Code. Upload the portal's Coaches sheet as it was downloaded.");

    const groups = await all("SELECT g.id,g.coach FROM groups g WHERE COALESCE(g.delivery_model,'Regular')<>'Industry' AND g.id NOT LIKE 'DEMO-%'");
    const groupById = new Map(groups.map((g: any) => [String(g.id).toUpperCase(), g]));
    // Only someone who signs in as a coach can open the Gigs tab.
    const coaches = (await all("SELECT id,name,lower(email) email,roles FROM users WHERE active=1")).filter((c: any) => {
      try {
        return (Array.isArray(c.roles) ? c.roles : JSON.parse(c.roles || "[]")).includes("Coach");
      } catch {
        return false;
      }
    });
    const coachByEmail = new Map(coaches.map((c: any) => [String(c.email || ""), c]));

    const seen = new Set<string>();
    const kept: { group_id: string; coach: string; email: string; user_id: string | null }[] = [];
    const unknownGroups: string[] = [];
    const withoutAccount: { group: string; coach: string }[] = [];
    const differs: { group: string; portal: string; ours: string | null }[] = [];
    for (const row of rows) {
      const group: any = groupById.get(row.group);
      if (!group) {
        unknownGroups.push(row.group);
        continue;
      }
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      const coach: any = row.email ? coachByEmail.get(row.email) : null;
      if (!coach) withoutAccount.push({ group: group.id, coach: row.coach || row.email });
      else if (coach.id !== group.coach) differs.push({ group: group.id, portal: coach.name, ours: group.coach });
      kept.push({ group_id: group.id, coach: row.coach, email: row.email, user_id: coach?.id || null });
    }
    const ourNames = new Map((await all("SELECT id,name FROM users")).map((x: any) => [x.id, x.name]));
    const summary = {
      groups: kept.length,
      same_coach: kept.length - differs.length - withoutAccount.length,
      different_coach: differs.map((d) => ({ ...d, ours: d.ours ? ourNames.get(d.ours) || d.ours : null })),
      without_account: withoutAccount,
      unknown_groups: unknownGroups,
      groups_not_in_sheet: groups.filter((g: any) => !seen.has(g.id)).length,
    };
    if (body.apply) {
      ensure(!unknownGroups.length || kept.length, "None of the sheet's groups is one of ours.");
      const t = now();
      const jobs = [
        stmt("DELETE FROM portal_coaches"),
        ...kept.map((k) =>
          stmt(
            "INSERT INTO portal_coaches(group_id,coach_name,coach_email,coach_user_id,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?)",
            k.group_id, k.coach || null, k.email || null, k.user_id, u.id, t,
          ),
        ),
        auditStmt(u, "portal_coaches_upload", "portal_coaches", { groups: kept.length, different: differs.length, without_account: withoutAccount.length }),
      ];
      // One save: the list is replaced whole or not at all, never left half
      // empty by a failure partway (12 November 2026). A row per group, so it stays small.
      await db().batch(jobs);
    }
    return Response.json({ summary, applied: Boolean(body.apply) });
  } catch (e: any) {
    return failure(e, "portal-coaches");
  }
}
