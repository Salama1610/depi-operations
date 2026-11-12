// One rule for "a person's students", so the same person shows the same number
// on every screen (12 November 2026). A person's students are the students of
// the groups they hold as coordinator, supervisor or coach in our system; each
// group is counted once however many of those roles the person has in it, and
// each student once however many ways they are reached. Students seen through
// a client account or an extra-coach assignment in somebody else's group are
// visible for the work but are not this person's students, so they are not in
// the count.
//
// The count is split by where each student stands, so that the total matches
// the roster (the coaching file lists every student of a group, whatever has
// happened to them since): active, revoked, and not active (withdrawn,
// removed, paused, closed).

export type GroupLike = { id?: unknown; coordinator?: unknown; supervisor?: unknown; coach?: unknown };
export type StudentLike = { id?: unknown; group_id?: unknown; lifecycle?: unknown };

export type HeldRole = "coordinator" | "supervisor" | "coach";
export const allHeldRoles: HeldRole[] = ["coordinator", "supervisor", "coach"];

/** The ids of the groups this person holds in the given roles: a Set, so a group is counted once. */
export function groupsHeldBy(groups: GroupLike[], personId: unknown, roles: HeldRole[] = allHeldRoles) {
  const who = String(personId ?? "");
  const out = new Set<string>();
  if (!who) return out;
  for (const g of groups) {
    const id = String(g.id ?? "");
    if (id && roles.some((r) => String(g[r] ?? "") === who)) out.add(id);
  }
  return out;
}

/** The students of those groups, one entry per student id. */
export function studentsOfGroups<T extends StudentLike>(students: T[], groupIds: Set<string>) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of students) {
    const id = String(s.id ?? "");
    if (!id || seen.has(id) || !groupIds.has(String(s.group_id ?? ""))) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
}

export type StudentTotals = {
  /** Every student of the groups, whatever their status. This is the figure the roster gives. */
  total: number;
  active: number;
  revoked: number;
  /** Withdrawn, removed, paused, transferred or closed: not revoked and not active. */
  inactive: number;
};

/** Where the students stand. active + inactive + revoked is always the total. */
export function studentTotals(students: StudentLike[]): StudentTotals {
  const totals: StudentTotals = { total: 0, active: 0, revoked: 0, inactive: 0 };
  const seen = new Set<string>();
  for (const s of students) {
    const id = String(s.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    totals.total++;
    const life = String(s.lifecycle ?? "");
    if (life === "Active") totals.active++;
    else if (life === "Revoked") totals.revoked++;
    else totals.inactive++;
  }
  return totals;
}

/** A person's students and their totals, in one call. */
export function assignedStudents<T extends StudentLike>(
  groups: GroupLike[],
  students: T[],
  personId: unknown,
  roles: HeldRole[] = allHeldRoles,
) {
  const groupIds = groupsHeldBy(groups, personId, roles);
  const list = studentsOfGroups(students, groupIds);
  return { groupIds, students: list, active: list.filter((s) => String(s.lifecycle ?? "") === "Active"), totals: studentTotals(list) };
}
