import { actor, all, permit, rateLimit } from "@/lib/server";
import { sameSide } from "@/lib/demo";
import { proofKey, proofKeySql } from "@/lib/domain/portal-review";
import { reviewNotes } from "@/lib/portal-review-notes";
import { portalCoachSql } from "@/lib/portal-coaches";

export const dynamic = "force-dynamic";

// The coach's Gigs tab: every portal gig of the coach's students that our
// quality team has approved or rejected, for the coach to carry out on the
// ministry portal. Each gig comes with its link and proof link, and the
// student's portal record (the portal's ID, name, email, phone and round) so
// the coach finds them there. Reviewers' names are not sent.

async function inChunks<T>(ids: string[], read: (slice: string[]) => Promise<T[]>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 400) out.push(...(await read(ids.slice(i, i + 400))));
  return out;
}
const proofList = (value: unknown) => {
  try {
    const list = JSON.parse(String(value || "[]"));
    return Array.isArray(list) ? list.filter((v) => typeof v === "string" && v.trim()) : [];
  } catch {
    return [];
  }
};

export async function GET() {
  try {
    const u = await actor();
    permit(u, ["Coach"]);
    await rateLimit("coach-gigs:" + u.id, 60, 60);
    // The students of the groups this coach carries out on the portal: the
    // portal's own coach for the group, from its Coaches sheet, or the group's
    // coach here when the sheet names nobody with an account (3 November 2026).
    const students = await all(
      `SELECT s.id,s.name,s.group_id FROM students s JOIN groups g ON g.id=s.group_id
       WHERE s.lifecycle='Active' AND COALESCE(g.delivery_model,'Regular')<>'Industry' AND ${sameSide(u, "g.id")}
         AND ${portalCoachSql("g")}=?`,
      u.id,
    );
    const byId = new Map(students.map((s: any) => [String(s.id), s]));
    const ids = [...byId.keys()];
    const marks = (slice: string[]) => slice.map(() => "?").join(",");
    const [studentsBatch, gigsBatch] = await Promise.all(
      ["students", "gigs"].map(async (sheet) => {
        const rows = await all("SELECT batch_id FROM portal_uploads WHERE sheet=? AND status='Active' ORDER BY committed_at DESC LIMIT 1", sheet);
        return rows[0]?.batch_id as string | undefined;
      }),
    );
    if (!studentsBatch || !gigsBatch || !ids.length) return Response.json({ gigs: [] }, { headers: { "Cache-Control": "no-store" } });

    const portalStudents = await inChunks(ids, (slice) =>
      all(
        `SELECT portal_id,student_id,full_name,email,phone,round_code,provider,final_status,proof_links FROM portal_students WHERE batch_id=? AND student_id IN (${marks(slice)})`,
        studentsBatch,
        ...slice,
      ),
    );
    const portalOf = new Map(portalStudents.map((p: any) => [String(p.portal_id), p]));
    const portalIds = [...portalOf.keys()];
    const rows = portalIds.length
      ? await inChunks(portalIds, (slice) =>
          all(
            `SELECT z.portal_gig_id,z.portal_student_id,z.title,z.url,z.proof_url,z.price,z.created_on,z.status,z.provider_status,z.auditor_status,
                    r.status qc_status,r.comment qc_comment,r.reviewed_at qc_reviewed_at
             FROM portal_gigs z JOIN portal_gig_reviews r ON r.proof_key=${proofKeySql("z")} AND r.status IN ('Approved','Rejected')
             WHERE z.batch_id=? AND z.portal_student_id IN (${marks(slice)})
             ORDER BY r.reviewed_at`,
            gigsBatch,
            ...slice,
          ),
        )
      : [];
    // Every comment of our quality team on each gig, the earlier ones with the new (without the reviewers' names).
    const notes = await reviewNotes(rows.map((g: any) => proofKey(g)), false);
    const gigs = rows.map((g: any) => {
      const p: any = portalOf.get(String(g.portal_student_id));
      const ours: any = byId.get(String(p?.student_id));
      return {
        id: g.portal_gig_id,
        title: g.title,
        url: g.url || null,
        proof_url: g.proof_url || null,
        price: g.price === null || g.price === undefined ? null : Number(g.price),
        date: g.created_on,
        portal_status: g.status || null,
        provider_status: g.provider_status || null,
        auditor_status: g.auditor_status || null,
        // Still waiting for the coach on the portal: no provider decision yet.
        waiting: /^(pending)?$/i.test(String(g.provider_status || "").trim()),
        qc_status: g.qc_status,
        qc_comment: g.qc_comment || null,
        qc_at: g.qc_reviewed_at || null,
        qc_notes: notes.get(proofKey(g)) || [],
        student: {
          id: ours?.id || p?.student_id || null,
          name: ours?.name || p?.full_name || null,
          group_id: ours?.group_id || null,
          portal_id: p?.portal_id || null,
          portal_name: p?.full_name || null,
          email: p?.email || null,
          phone: p?.phone || null,
          round_code: p?.round_code || null,
          provider: p?.provider || null,
          final_status: p?.final_status || null,
          proofs: proofList(p?.proof_links),
        },
      };
    });
    return Response.json({ gigs }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
