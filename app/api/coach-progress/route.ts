import { actor, all, permit, rateLimit } from "@/lib/server";
import { graduation, policy } from "@/lib/domain/rules";
import { sameSide } from "@/lib/demo";

export const dynamic = "force-dynamic";

// A coach's read-only view of their own students' progress: how many gigs
// count toward graduation (x of 3), their total in US dollars, and each gig's
// status in our review and on the ministry portal.
//
// A coach never learns how a gig was paid for: nothing here selects the
// client account a gig was ordered or paid from, the client's name, or the
// gig's free-text title. "Own students" means the groups the person coaches,
// as the group's coach or through an active Outcome or Support assignment; a
// one-session backup coach does not get the group's progress.


async function inChunks<T>(ids: string[], read: (slice: string[]) => Promise<T[]>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 400) out.push(...(await read(ids.slice(i, i + 400))));
  return out;
}

export async function GET() {
  try {
    const u = await actor();
    permit(u, ["Coach"]);
    await rateLimit("coach-progress:" + u.id, 60, 60);
    const students = await all(
      `SELECT s.id,s.name,s.group_id FROM students s JOIN groups g ON g.id=s.group_id
       WHERE s.lifecycle='Active' AND COALESCE(g.delivery_model,'Regular')<>'Industry' AND ${sameSide(u, "g.id")}
         AND (g.coach=? OR EXISTS (SELECT 1 FROM group_coaches gc WHERE gc.group_id=g.id AND gc.user_id=? AND gc.status='Active' AND gc.coach_type IN ('Outcome Coach','Support Coach')))
       ORDER BY s.group_id,s.name`,
      u.id,
      u.id,
    );
    const ids = students.map((s: any) => s.id);
    const marks = (slice: string[]) => slice.map(() => "?").join(",");

    const gigs = await inChunks(ids, (slice) =>
      all(
        `SELECT z.id,z.student_id,z.platform,z.value,z.currency,z.status gig_status,z.created_at,z.paid_on,x.usd_value,
                (SELECT e.status FROM evidence e WHERE e.gig_id=z.id ORDER BY e.created_at DESC LIMIT 1) review_status
         FROM gigs z LEFT JOIN gig_fx_applications x ON x.gig_id=z.id
         WHERE z.student_id IN (${marks(slice)}) ORDER BY z.created_at`,
        ...slice,
      ),
    );

    // The ministry portal's latest upload of each sheet, linked to our students.
    const [studentsBatch, gigsBatch] = await Promise.all(
      ["students", "gigs"].map(async (sheet) => {
        const rows = await all("SELECT batch_id FROM portal_uploads WHERE sheet=? AND status='Active' ORDER BY committed_at DESC LIMIT 1", sheet);
        return rows[0]?.batch_id as string | undefined;
      }),
    );
    const portalStudents = studentsBatch
      ? await inChunks(ids, (slice) =>
          all(
            `SELECT portal_id,student_id,final_status,total_gigs,approved_gigs,rejected_gigs FROM portal_students WHERE batch_id=? AND student_id IN (${marks(slice)})`,
            studentsBatch,
            ...slice,
          ),
        )
      : [];
    // Each student's attendance at their group's sessions, for the week filter.
    const attendance = await inChunks(ids, (slice) =>
      all(
        `SELECT a.student_id,a.status,t.starts_at,t.week FROM attendance a JOIN sessions t ON t.id=a.session_id
         WHERE t.status<>'Cancelled' AND a.student_id IN (${marks(slice)})`,
        ...slice,
      ),
    );
    const portalIds = portalStudents.map((p: any) => String(p.portal_id));
    const portalGigs = gigsBatch && portalIds.length
      ? await inChunks(portalIds, (slice) =>
          all(
            `SELECT portal_gig_id,portal_student_id,title,price,created_on,status,auditor_status FROM portal_gigs WHERE batch_id=? AND portal_student_id IN (${marks(slice)}) ORDER BY created_on`,
            gigsBatch,
            ...slice,
          ),
        )
      : [];

    const portalOf = new Map(portalStudents.map((p: any) => [p.student_id, p]));
    const result = students.map((s: any) => {
      const theirs = gigs
        .filter((g: any) => g.student_id === s.id)
        .map((g: any) => {
          const usd = g.currency === "USD" ? Number(g.value) : Number(g.usd_value) || 0;
          return {
            id: g.id,
            platform: g.platform,
            usd: Math.round(usd * 100) / 100,
            date: g.paid_on || g.created_at,
            gig_status: g.gig_status,
            review_status: g.review_status || null,
          };
        });
      // The same rule as the graduation ledger: accepted, paid, and worth at least the minimum.
      const counted = theirs.filter((g) => g.review_status === "Accepted" && g.gig_status === "Paid" && g.usd >= policy.minGig);
      const portal = portalOf.get(s.id);
      return {
        id: s.id,
        name: s.name,
        group_id: s.group_id,
        attendance: attendance
          .filter((a: any) => a.student_id === s.id)
          .map((a: any) => ({ at: a.starts_at, week: a.week, present: a.status !== "Absent" })),
        graduation: graduation(theirs.map((g) => ({ status: g.review_status, gig_status: g.gig_status, currency: "USD", value: g.usd }))),
        counted: counted.length,
        total_usd: Math.round(counted.reduce((sum, g) => sum + g.usd, 0) * 100) / 100,
        // The gig's own status follows the client-account workflow, so it stays
        // on the server: the coach sees where the gig is in our review only.
        gigs: theirs.map(({ gig_status: _workflow, ...shown }) => shown),
        portal: portal
          ? {
              final_status: portal.final_status || null,
              // The portal sheet's own summary of the student's gigs.
              total: portal.total_gigs === null || portal.total_gigs === undefined ? null : Number(portal.total_gigs),
              approved: portal.approved_gigs === null || portal.approved_gigs === undefined ? null : Number(portal.approved_gigs),
              rejected: portal.rejected_gigs === null || portal.rejected_gigs === undefined ? null : Number(portal.rejected_gigs),
              gigs: portalGigs
                .filter((p: any) => String(p.portal_student_id) === String(portal.portal_id))
                .map((p: any) => ({
                  id: p.portal_gig_id,
                  title: p.title,
                  price: p.price === null || p.price === undefined ? null : Number(p.price),
                  date: p.created_on,
                  status: p.status,
                  auditor_status: p.auditor_status,
                })),
            }
          : null,
      };
    });
    return Response.json({ students: result, needed: policy.gigCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
