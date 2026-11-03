// A student's figures from the ministry portal's sheets: the official record
// of graduation and gigs (see app/portal-view.tsx). The Overview and the
// Dashboard read them, so they change with every upload of the students or
// gigs sheet. One rule here, used by the workspace and the Dashboard alike.

/** Where a portal gig stands: approved or rejected for good, or waiting for the coach or the auditor. */
export type PortalGigStage = "approved" | "rejected" | "coach" | "auditor";

const decided = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * The gig's stage from its three statuses. The overall status settles it when
 * it is Approved or Rejected; otherwise the coach decides first (Pending,
 * blank or Edited after a change), then the auditor.
 */
export function portalGigStage(g: { status?: unknown; provider_status?: unknown; auditor_status?: unknown }): PortalGigStage {
  const status = decided(g.status);
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return decided(g.provider_status) === "approved" ? "auditor" : "coach";
}

export type PortalFigures = {
  /** The portal's Final Status is Graduated. */
  graduated: boolean;
  final_status: string | null;
  graduate_type: string | null;
  gigs: number;
  approved: number;
  rejected: number;
  /** Waiting for the coach's decision on the portal. */
  coach: number;
  /** Approved by the coach, waiting for the auditor. */
  auditor: number;
  /** Our quality team's verdicts on the student's gigs. */
  qc_approved: number;
  qc_rejected: number;
};

/** How far a final status has come, to pick one when a student has two portal records. */
const progress = (finalStatus: unknown) => ({ graduated: 2, started: 1 })[decided(finalStatus) as "graduated" | "started"] ?? 0;

/**
 * Each linked student's portal figures, from the students sheet's rows (their
 * final status) and the gigs sheet's rows (with our QC verdict as `qc`).
 * Keyed by our student ID; a student with no portal record has no entry.
 */
export function portalFiguresByStudent(
  students: { student_id?: unknown; final_status?: unknown; graduate_type?: unknown }[],
  gigs: { student_id?: unknown; status?: unknown; provider_status?: unknown; auditor_status?: unknown; qc?: unknown }[],
) {
  const out = new Map<string, PortalFigures>();
  for (const p of students) {
    const id = String(p.student_id ?? "");
    if (!id) continue;
    const seen = out.get(id);
    if (seen && progress(seen.final_status) >= progress(p.final_status)) continue;
    out.set(id, {
      graduated: decided(p.final_status) === "graduated",
      final_status: p.final_status == null ? null : String(p.final_status),
      graduate_type: p.graduate_type == null ? null : String(p.graduate_type),
      gigs: seen?.gigs ?? 0,
      approved: seen?.approved ?? 0,
      rejected: seen?.rejected ?? 0,
      coach: seen?.coach ?? 0,
      auditor: seen?.auditor ?? 0,
      qc_approved: seen?.qc_approved ?? 0,
      qc_rejected: seen?.qc_rejected ?? 0,
    });
  }
  for (const g of gigs) {
    const figures = out.get(String(g.student_id ?? ""));
    if (!figures) continue;
    figures.gigs++;
    figures[portalGigStage(g)]++;
    if (g.qc === "Approved") figures.qc_approved++;
    if (g.qc === "Rejected") figures.qc_rejected++;
  }
  return out;
}

/**
 * A student's graduation as every screen shows it (3 Nov 2026: from the
 * portal sheets, not our own evidence): "Graduated" when the portal's Final
 * Status says so, otherwise how many gigs the portal approved, out of three.
 */
export function portalGraduation(f?: { graduated?: boolean; approved?: number } | null) {
  if (f?.graduated) return "Graduated";
  return `${Math.min(Number(f?.approved) || 0, 3)}/3`;
}

/** The figures of a set of students added up, for a tile or a row of a table. */
export function sumPortalFigures(list: (PortalFigures | null | undefined)[]) {
  const total = { students: 0, graduated: 0, gigs: 0, approved: 0, rejected: 0, coach: 0, auditor: 0, qc_approved: 0, qc_rejected: 0 };
  for (const f of list) {
    if (!f) continue;
    total.students++;
    if (f.graduated) total.graduated++;
    total.gigs += f.gigs;
    total.approved += f.approved;
    total.rejected += f.rejected;
    total.coach += f.coach;
    total.auditor += f.auditor;
    total.qc_approved += f.qc_approved;
    total.qc_rejected += f.qc_rejected;
  }
  return total;
}
