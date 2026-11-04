// The gap between the ministry portal's gigs waiting for the coach and our own
// system, for the Quality Lead and Coach Operations (4 November 2026).
//
// Every gig the latest gigs sheet shows waiting for the coach is in one place:
// missing from our quality team's queue, with the quality team, or checked. A
// checked gig reaches its coach's Gigs tab (app/api/coach-gigs), unless nothing
// there can show it. The other way round, a gig our quality team still has open
// may no longer wait on the portal at all. Read only: nothing here changes the
// queue, which syncs itself when Portal gigs QC opens (app/api/portal-qc).

import { portalGigStage } from "./portal-figures.ts";
import { proofKey, waitsForCoach } from "./portal-review.ts";

export const portalGapRoles = ["Quality Lead", "Coach Operations", "Operations Systems / Admin"];

export type GapPlace = "not_in_queue" | "no_coach" | "with_qc" | "coach_tab" | "moved_on";
export type GapWhy =
  | "not_pending"
  | "new"
  | "not_linked"
  | "revoked"
  | "not_active"
  | "industry"
  | "no_coach"
  | "decided_on_portal"
  | "not_in_sheet";

type Ours = {
  portal_student_id?: unknown;
  student_id?: unknown;
  lifecycle?: unknown;
  delivery_model?: unknown;
  coach_id?: unknown;
  coach_active?: unknown;
};
/** A row of the gigs sheet with our student, coach and quality verdict. */
export type SheetGig = Ours & {
  portal_gig_id?: unknown;
  student_name?: unknown;
  linked_name?: unknown;
  group_id?: unknown;
  coach_name?: unknown;
  title?: unknown;
  url?: unknown;
  proof_url?: unknown;
  created_on?: unknown;
  status?: unknown;
  provider_status?: unknown;
  qc?: unknown;
};
/** A review our quality team has open, with the sheet's row of its gig if there is one. */
export type OpenReview = SheetGig & { proof_key?: unknown; in_sheet?: unknown };

const text = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/** Why a gig's coach would not see it in their Gigs tab, the same conditions as app/api/coach-gigs. */
function unreachable(g: Ours): GapWhy | null {
  if (!g.student_id) return "not_linked";
  if (g.lifecycle === "Revoked") return "revoked";
  if (g.lifecycle !== "Active") return "not_active";
  if (g.delivery_model === "Industry") return "industry";
  if (!g.coach_id || g.coach_id === "system-unassigned-coach" || !Number(g.coach_active)) return "no_coach";
  return null;
}

function placeOf(g: SheetGig): { place: GapPlace; why: GapWhy | null } {
  const stuck = unreachable(g);
  // The queue takes a gig whose coach status is Pending or blank, unless the student was revoked.
  if (!g.qc) return { place: "not_in_queue", why: !waitsForCoach(g) ? "not_pending" : stuck === "revoked" ? "revoked" : "new" };
  if (g.qc === "Approved" || g.qc === "Rejected") return stuck ? { place: "no_coach", why: stuck } : { place: "coach_tab", why: null };
  return { place: "with_qc", why: stuck };
}

const line = (g: SheetGig, place: GapPlace, why: GapWhy | null) => ({
  id: text(g.portal_gig_id),
  portal_student_id: text(g.portal_student_id),
  student_id: text(g.student_id),
  student: text(g.linked_name) || text(g.student_name),
  group_id: text(g.group_id),
  coach_id: text(g.coach_id),
  coach_name: text(g.coach_name),
  title: text(g.title),
  url: text(g.url),
  proof_url: text(g.proof_url),
  date: text(g.created_on),
  status: text(g.status),
  provider_status: text(g.provider_status),
  qc: text(g.qc),
  place,
  why,
});
export type GapLine = ReturnType<typeof line>;

const tally = (list: GapLine[]) => ({ gigs: list.length, students: new Set(list.map((g) => g.portal_student_id)).size });

/** The gap, from the gigs sheet's rows and the reviews our quality team has open. */
export function portalCoachGap(sheet: SheetGig[], openReviews: OpenReview[]) {
  const waiting = sheet.filter((g) => portalGigStage(g) === "coach");
  const stillWaiting = new Set(waiting.map((g) => proofKey(g)));
  const onPortal = waiting.map((g) => {
    const { place, why } = placeOf(g);
    return line(g, place, why);
  });
  const movedOn = openReviews
    .filter((r) => !stillWaiting.has(String(r.proof_key ?? "")))
    .map((r) => line(r, "moved_on", r.in_sheet ? "decided_on_portal" : "not_in_sheet"));

  const coaches = new Map<string, { coach_id: string | null; coach_name: string | null; waiting: number; qc_approved: number; qc_rejected: number; with_qc: number; not_in_queue: number; oldest: string | null }>();
  for (const g of onPortal) {
    const key = g.coach_id ?? "";
    const c = coaches.get(key) ?? { coach_id: g.coach_id, coach_name: g.coach_name, waiting: 0, qc_approved: 0, qc_rejected: 0, with_qc: 0, not_in_queue: 0, oldest: null };
    c.waiting++;
    if (g.qc === "Approved") c.qc_approved++;
    else if (g.qc === "Rejected") c.qc_rejected++;
    else if (g.qc) c.with_qc++;
    else c.not_in_queue++;
    if (g.date && (!c.oldest || g.date < c.oldest)) c.oldest = g.date;
    coaches.set(key, c);
  }
  const oldestFirst = (a: GapLine, b: GapLine) => String(a.date ?? "").localeCompare(String(b.date ?? ""));
  const of = (place: GapPlace) => tally(onPortal.filter((g) => g.place === place));
  return {
    waiting: tally(onPortal),
    in_our_system: tally(onPortal.filter((g) => g.qc)),
    places: { not_in_queue: of("not_in_queue"), no_coach: of("no_coach"), with_qc: of("with_qc"), coach_tab: of("coach_tab"), moved_on: tally(movedOn) },
    // The coaches with the most our quality team has already checked come first: those wait only for the coach.
    coaches: [...coaches.values()].sort((a, b) => b.qc_approved + b.qc_rejected - (a.qc_approved + a.qc_rejected) || b.waiting - a.waiting),
    gigs: [...onPortal, ...movedOn].sort(oldestFirst),
  };
}
