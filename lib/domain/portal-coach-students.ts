// How far each coach's students have come on the ministry portal, for Coach
// Operations and the administrators (5 November 2026). A coach's students are
// those of the groups they coach in our system (groups.coach; since 8 November
// 2026, not the portal's coach), and where each student stands is the portal's
// Final Status. Every student is in
// exactly one count, so the counts add up to the students assigned.

export const coachStudentRoles = ["Coach Operations", "Operations Systems / Admin"];

export type PortalStanding = "graduated" | "started" | "not_started" | "no_status";

const standings: PortalStanding[] = ["no_status", "not_started", "started", "graduated"];

/** Where a Final Status puts a student. Blank, or a value the portal has not used before, is no status. */
export function portalStanding(finalStatus: unknown): PortalStanding {
  const status = String(finalStatus ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (status === "graduated") return "graduated";
  if (status === "started") return "started";
  if (status === "not started") return "not_started";
  return "no_status";
}

type Counts = { assigned: number; started: number; not_started: number; graduated: number; no_status: number };
export type CoachStudentsRow = Counts & { coach_id: string | null; coach_name: string | null; groups: number };

const emptyCounts = (): Counts => ({ assigned: 0, started: 0, not_started: 0, graduated: 0, no_status: 0 });

/** One row per coach, by name, with the students of a group without a coach last, and the totals. */
export function coachStudentCounts(
  students: { id: unknown; group_id: unknown; coach_id?: unknown; coach_name?: unknown }[],
  portal: { student_id?: unknown; final_status?: unknown }[],
) {
  // A student with two portal records stands at the further one.
  const standingOf = new Map<string, PortalStanding>();
  for (const p of portal) {
    const id = String(p.student_id ?? "");
    if (!id) continue;
    const standing = portalStanding(p.final_status);
    const seen = standingOf.get(id);
    if (!seen || standings.indexOf(standing) > standings.indexOf(seen)) standingOf.set(id, standing);
  }
  const rows = new Map<string, Counts & { coach_id: string | null; coach_name: string | null; groupIds: Set<string> }>();
  const total = emptyCounts();
  for (const s of students) {
    const coachId = s.coach_id ? String(s.coach_id) : null;
    const key = coachId ?? "";
    const row = rows.get(key) || { ...emptyCounts(), coach_id: coachId, coach_name: s.coach_name ? String(s.coach_name) : null, groupIds: new Set<string>() };
    rows.set(key, row);
    const standing = standingOf.get(String(s.id)) ?? "no_status";
    row.groupIds.add(String(s.group_id));
    row.assigned++;
    row[standing]++;
    total.assigned++;
    total[standing]++;
  }
  const coaches: CoachStudentsRow[] = [...rows.values()]
    .map(({ groupIds, ...row }) => ({ ...row, groups: groupIds.size }))
    .sort((a, b) => Number(!a.coach_id) - Number(!b.coach_id) || String(a.coach_name ?? a.coach_id).localeCompare(String(b.coach_name ?? b.coach_id)));
  return { coaches, total };
}
