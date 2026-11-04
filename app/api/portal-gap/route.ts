import { actor, all, permit, rateLimit, refuseDemo, revokesStudents } from "@/lib/server";
import { portalWaitsForCoachSql } from "@/lib/domain/portal-figures";
import { portalCoachGap, portalGapRoles } from "@/lib/domain/portal-gap";
import { proofKeySql } from "@/lib/domain/portal-review";
import { portalCoachSql } from "@/lib/portal-coaches";

export const dynamic = "force-dynamic";

// The gap between the portal's gigs waiting for the coach and our system, for
// the Quality Lead and Coach Operations (see lib/domain/portal-gap). Reviewers'
// names and comments are not sent, nor when the sheets were uploaded.

const activeBatch = async (sheet: string) => {
  const rows = await all("SELECT batch_id FROM portal_uploads WHERE sheet=? AND status='Active' ORDER BY committed_at DESC LIMIT 1", sheet);
  return (rows[0]?.batch_id as string | undefined) || "";
};

/** Our student, group and coach for a row, and the same as selected columns. */
const ours = (student: string) =>
  `LEFT JOIN students s ON s.id=${student} LEFT JOIN groups g ON g.id=s.group_id LEFT JOIN users c ON c.id=${portalCoachSql("g")}`;
const ourColumns = (student: string) =>
  `${student} student_id,s.name linked_name,s.lifecycle,s.group_id,COALESCE(g.delivery_model,'Regular') delivery_model,${portalCoachSql("g")} coach_id,c.name coach_name,c.active coach_active`;

export async function GET() {
  try {
    const u = await actor();
    refuseDemo(u);
    permit(u, portalGapRoles);
    await rateLimit("portal-gap:" + u.id, 30, 60);
    const [gigsBatch, studentsBatch] = await Promise.all([activeBatch("gigs"), activeBatch("students")]);
    if (!gigsBatch) return Response.json({ sheet: false }, { headers: { "Cache-Control": "no-store" } });
    // Whoever does not see revoked students does not see them here either, as in Portal gigs QC.
    const hidden = revokesStudents(u) ? "" : " AND COALESCE(s.lifecycle,'')<>'Revoked'";
    const [sheet, openReviews] = await Promise.all([
      all(
        `SELECT z.portal_gig_id,z.portal_student_id,z.student_name,z.title,z.url,z.proof_url,z.created_on,z.status,z.provider_status,r.status qc,${ourColumns("p.student_id")}
         FROM portal_gigs z
         LEFT JOIN portal_students p ON p.batch_id=? AND p.portal_id=z.portal_student_id
         ${ours("p.student_id")}
         LEFT JOIN portal_gig_reviews r ON r.proof_key=${proofKeySql("z")}
         WHERE z.batch_id=? AND ${portalWaitsForCoachSql("z")}${hidden}`,
        studentsBatch,
        gigsBatch,
      ),
      all(
        `SELECT r.portal_gig_id,r.proof_key,r.portal_student_id,r.student_name,r.title,r.url,r.status qc,
                z.proof_url,z.created_on,z.status,z.provider_status,z.portal_gig_id in_sheet,${ourColumns("COALESCE(p.student_id,r.student_id)")}
         FROM portal_gig_reviews r
         LEFT JOIN portal_gigs z ON z.batch_id=? AND z.portal_gig_id=r.portal_gig_id
         LEFT JOIN portal_students p ON p.batch_id=? AND p.portal_id=r.portal_student_id
         ${ours("COALESCE(p.student_id,r.student_id)")}
         WHERE r.status='Pending'${hidden}`,
        gigsBatch,
        studentsBatch,
      ),
    ]);
    return Response.json({ sheet: true, ...portalCoachGap(sheet, openReviews) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
