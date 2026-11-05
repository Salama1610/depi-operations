// Which quality review belongs to a row of the ministry portal's gigs sheet.
//
// The "Status Proof Screenshot" link is the one cell that does not repeat
// from gig to gig, and it stays the same each time the sheet is exported, so
// a review is kept under that link: a new upload finds the same review, with
// its Quality Member and its verdict. A gig with no proof link falls back to
// its ID. A new proof on a gig is a new thing to check.

import { portalGigStage } from "./portal-figures.ts";

/** The key of a gig's review: its proof link, lower-cased and trimmed, or "gig:" and its ID. */
export function proofKey(gig: { proof_url?: unknown; portal_gig_id?: unknown }) {
  const proof = String(gig.proof_url ?? "").trim().toLowerCase();
  return proof || "gig:" + String(gig.portal_gig_id ?? "").trim();
}

/** The same key in SQL, for the portal_gigs row aliased `z`. */
export const proofKeySql = (z = "z") =>
  `CASE WHEN coalesce(trim(${z}.proof_url),'')<>'' THEN lower(trim(${z}.proof_url)) ELSE 'gig:' || trim(${z}.portal_gig_id) END`;

/** Whether the gig still waits for the coach on the portal: the only gigs worth checking first. */
export const waitsForCoach = (gig: { status?: unknown; provider_status?: unknown; auditor_status?: unknown }) => portalGigStage(gig) === "coach";

/**
 * The proofs in a sheet's rows that wait for the coach on no row: the portal
 * has moved past them, so nothing is left for our quality team to check. A
 * proof that is not in the sheet is not among them; the sheet says nothing of it.
 */
export function settledProofs(rows: { proof_url?: unknown; portal_gig_id?: unknown; status?: unknown; provider_status?: unknown }[]) {
  const inSheet = new Set<string>();
  const waiting = new Set<string>();
  for (const g of rows) {
    const key = proofKey(g);
    inSheet.add(key);
    if (waitsForCoach(g)) waiting.add(key);
  }
  return new Set([...inSheet].filter((key) => !waiting.has(key)));
}
