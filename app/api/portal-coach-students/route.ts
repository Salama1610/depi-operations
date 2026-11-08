import { actor, all, permit, rateLimit, refuseDemo } from "@/lib/server";
import { coachStudentCounts, coachStudentRoles } from "@/lib/domain/portal-coach-students";

export const dynamic = "force-dynamic";

// Each coach's students by where they stand on the portal, for Coach Operations
// and the administrators (see lib/domain/portal-coach-students). Counts only:
// no student's name or contact is sent. A student counts under their group's
// coach in our system, not the portal's coach from its Coaches sheet
// (8 November 2026); the gigs to carry out on the portal still go to that one.

export async function GET() {
  try {
    const u = await actor();
    refuseDemo(u);
    permit(u, coachStudentRoles);
    await rateLimit("portal-coach-students:" + u.id, 30, 60);
    const batch = await all("SELECT batch_id FROM portal_uploads WHERE sheet='students' AND status='Active' ORDER BY committed_at DESC LIMIT 1");
    const batchId = batch[0]?.batch_id as string | undefined;
    if (!batchId) return Response.json({ sheet: false }, { headers: { "Cache-Control": "no-store" } });
    const [students, portal] = await Promise.all([
      // Graduates whose record we have closed stay among the coach's students.
      all(
        `SELECT s.id,s.group_id,g.coach coach_id,c.name coach_name
         FROM students s JOIN groups g ON g.id=s.group_id LEFT JOIN users c ON c.id=g.coach
         WHERE s.lifecycle IN ('Active','Graduate Closed') AND COALESCE(g.delivery_model,'Regular')<>'Industry' AND g.id NOT LIKE 'DEMO-%'`,
      ),
      all("SELECT student_id,final_status FROM portal_students WHERE batch_id=? AND student_id IS NOT NULL", batchId),
    ]);
    return Response.json({ sheet: true, ...coachStudentCounts(students, portal) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
