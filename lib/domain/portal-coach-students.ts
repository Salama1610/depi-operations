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
/** One group: its students by where they stand, and the share graduated (13 November 2026). */
export type GroupStudentsRow = Counts & { group_id: string; coach_id: string | null; coach_name: string | null; graduated_pct: number };

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
  const byGroup = new Map<string, Counts & { group_id: string; coach_id: string | null; coach_name: string | null }>();
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
    const groupId = String(s.group_id);
    const group = byGroup.get(groupId) || { ...emptyCounts(), group_id: groupId, coach_id: coachId, coach_name: s.coach_name ? String(s.coach_name) : null };
    byGroup.set(groupId, group);
    group.assigned++;
    group[standing]++;
    total.assigned++;
    total[standing]++;
  }
  const coaches: CoachStudentsRow[] = [...rows.values()]
    .map(({ groupIds, ...row }) => ({ ...row, groups: groupIds.size }))
    .sort((a, b) => Number(!a.coach_id) - Number(!b.coach_id) || String(a.coach_name ?? a.coach_id).localeCompare(String(b.coach_name ?? b.coach_id)));
  // Each group's share of graduates, the highest first.
  const groups: GroupStudentsRow[] = [...byGroup.values()]
    .map((g) => ({ ...g, graduated_pct: g.assigned ? Math.round((g.graduated / g.assigned) * 100) : 0 }))
    .sort((a, b) => b.graduated_pct - a.graduated_pct || b.graduated - a.graduated || a.group_id.localeCompare(b.group_id));
  return { coaches, groups, total };
}

/** A gig waits too long for the coach's decision after this many days. */
export const slowAfterDays = 7;

export type CoachRankRow = CoachStudentsRow & {
  /** Not started on the portal, or not on the students sheet at all. */
  not_moving: number;
  not_moving_pct: number;
  /** Gigs of the coach's students waiting for the coach's decision on the portal. */
  waiting: number;
  /** Of those, waiting longer than slowAfterDays. */
  slow: number;
  oldest_days: number | null;
  /** 1 is the coach furthest behind. */
  rank: number;
};

/**
 * The coaches ranked from the furthest behind (8 November 2026), on two
 * measures read from the portal sheets: the share of their students who have
 * not started or are not on the portal yet, and how many of their students'
 * gigs have waited for their decision longer than slowAfterDays. Each measure
 * ranks the coaches on its own; the overall rank adds the two ranks, so
 * neither measure outweighs the other. A share, not a count, for students, so
 * a coach is not ranked lower for having more of them. Students of a group
 * without a coach are left out of the ranking.
 */
export function rankCoaches(
  coaches: CoachStudentsRow[],
  waits: { coach_id?: unknown; created_on?: unknown; updated_on?: unknown }[],
  today: Date = new Date(),
): CoachRankRow[] {
  const day = 86400000;
  const gigs = new Map<string, { waiting: number; slow: number; oldest: number | null }>();
  for (const w of waits) {
    if (!w.coach_id) continue;
    const key = String(w.coach_id);
    const g = gigs.get(key) || { waiting: 0, slow: 0, oldest: null };
    gigs.set(key, g);
    g.waiting++;
    // Waiting since the gig was sent, or sent again after an edit.
    const since = Date.parse(String(w.updated_on || w.created_on || ""));
    if (Number.isNaN(since)) continue;
    const days = Math.max(0, Math.floor((today.getTime() - since) / day));
    if (days > slowAfterDays) g.slow++;
    if (g.oldest === null || days > g.oldest) g.oldest = days;
  }
  const rows = coaches
    .filter((c) => c.coach_id && c.coach_id !== "system-unassigned-coach")
    .map((c) => {
      const g = gigs.get(String(c.coach_id)) || { waiting: 0, slow: 0, oldest: null };
      const notMoving = c.not_started + c.no_status;
      return { ...c, not_moving: notMoving, not_moving_pct: c.assigned ? Math.round((notMoving / c.assigned) * 100) : 0, waiting: g.waiting, slow: g.slow, oldest_days: g.oldest, rank: 0 };
    });
  // Equal values share a rank, as in a league table.
  const rankBy = (value: (r: (typeof rows)[number]) => number) => {
    const values = rows.map(value).sort((a, b) => b - a);
    return new Map(rows.map((r) => [r, values.indexOf(value(r)) + 1]));
  };
  const byStudents = rankBy((r) => r.not_moving_pct);
  const byGigs = rankBy((r) => r.slow);
  const score = (r: (typeof rows)[number]) => byStudents.get(r)! + byGigs.get(r)!;
  rows.sort(
    (a, b) =>
      score(a) - score(b) ||
      b.not_moving_pct - a.not_moving_pct ||
      b.slow - a.slow ||
      String(a.coach_name ?? a.coach_id).localeCompare(String(b.coach_name ?? b.coach_id)),
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}
