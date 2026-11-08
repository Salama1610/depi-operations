import { actor, all, permit, rateLimit, refuseDemo } from "@/lib/server";
import { coachStudentCounts, coachStudentRoles, rankCoaches } from "@/lib/domain/portal-coach-students";
import { portalWaitsForCoachSql } from "@/lib/domain/portal-figures";

export const dynamic = "force-dynamic";

// Each coach's students by where they stand on the portal, and the coaches
// ranked from the furthest behind, for Coach Operations and the administrators
// (see lib/domain/portal-coach-students). Counts only: no student's name or
// contact is sent. A student counts under their group's coach in our system,
// not the portal's coach from its Coaches sheet (8 November 2026); the gigs to
// carry out on the portal still go to that one. The ranking's waiting gigs
// follow the same coach as the students, so both measures rank the same person.

export async function GET() {
  try {
    const u = await actor();
    refuseDemo(u);
    permit(u, coachStudentRoles);
    await rateLimit("portal-coach-students:" + u.id, 30, 60);
    const latest = (sheet: string) =>
      all("SELECT batch_id FROM portal_uploads WHERE sheet=? AND status='Active' ORDER BY committed_at DESC LIMIT 1", sheet).then((r) => r[0]?.batch_id as string | undefined);
    const [batchId, gigsBatch] = await Promise.all([latest("students"), latest("gigs")]);
    if (!batchId) return Response.json({ sheet: false }, { headers: { "Cache-Control": "no-store" } });
    const [students, portal, waits] = await Promise.all([
      // Graduates whose record we have closed stay among the coach's students.
      all(
        `SELECT s.id,s.group_id,g.coach coach_id,c.name coach_name
         FROM students s JOIN groups g ON g.id=s.group_id LEFT JOIN users c ON c.id=g.coach
         WHERE s.lifecycle IN ('Active','Graduate Closed') AND COALESCE(g.delivery_model,'Regular')<>'Industry' AND g.id NOT LIKE 'DEMO-%'`,
      ),
      all("SELECT student_id,final_status FROM portal_students WHERE batch_id=? AND student_id IS NOT NULL", batchId),
      // The gigs of the same students still waiting for the coach's decision, with their dates.
      gigsBatch
        ? all(
            `SELECT g.coach coach_id,z.created_on,z.updated_on
             FROM portal_gigs z
             JOIN portal_students p ON p.batch_id=? AND p.portal_id=z.portal_student_id
             JOIN students s ON s.id=p.student_id JOIN groups g ON g.id=s.group_id
             WHERE z.batch_id=? AND ${portalWaitsForCoachSql("z")}
               AND s.lifecycle IN ('Active','Graduate Closed') AND COALESCE(g.delivery_model,'Regular')<>'Industry' AND g.id NOT LIKE 'DEMO-%'`,
            batchId,
            gigsBatch,
          )
        : Promise.resolve([]),
    ]);
    const counts = coachStudentCounts(students, portal);
    return Response.json({ sheet: true, ...counts, ranking: rankCoaches(counts.coaches, waits) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
