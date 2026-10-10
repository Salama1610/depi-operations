// The checklist for each session, with whose step each one is:
// - the day before, the coordinator confirms with the coach (the coach's own
//   confirmation also counts);
// - the morning of, Coach Operations checks the day's sessions;
// - during it, the coordinator sees the coach enter;
// - after it, attendance is taken (worked out from the register, never
//   ticked by hand). Students' feedback opens on their own page by itself.

export type ChecklistStage = "Before" | "During" | "After";
export type ChecklistOwner = "coordinator" | "coach" | "coach_ops" | "auto";

export type ChecklistItem = {
  key: string;
  label: string;
  stage: ChecklistStage;
  owner: ChecklistOwner;
  /** The first session week the step applies to. */
  fromWeek?: number;
  /** When it is due, in words, so each party knows when their step comes. */
  when?: string;
};

export const sessionChecklist: ChecklistItem[] = [
  { key: "instructor_confirmed", label: "Coach confirmed", stage: "Before", owner: "coordinator", when: "The day before" },
  { key: "coach_ops_checked", label: "Coach Operations checked", stage: "Before", owner: "coach_ops", when: "The morning of the session" },
  { key: "instructor_entered", label: "Coach entered the session", stage: "During", owner: "coordinator" },
  { key: "attendance_taken", label: "Attendance taken", stage: "After", owner: "auto" },
];

/** Steps cleared when a session moves: they were done for the old time. */
export const beforeSessionKeys = sessionChecklist
  .filter((i) => i.stage === "Before" && i.owner !== "auto")
  .map((i) => i.key);

export function checklistItem(key: string) {
  return sessionChecklist.find((i) => i.key === key);
}

export function appliesTo(item: ChecklistItem, session: { week?: number | null }) {
  return !item.fromWeek || Number(session.week || 0) >= item.fromWeek;
}

export type CheckState = { done: boolean; flagged?: string; by?: string | null; at?: string | null };

/**
 * Each applicable step's state for one session.
 * `ticks` are that session's session_checks rows; `activeStudents` the ids of
 * the group's active students; `marked` the student ids with attendance.
 */
export function checklistState(
  session: any,
  ticks: { item: string; done_by?: string | null; done_at?: string | null }[],
  activeStudents: string[],
  marked: Set<string>,
): Record<string, CheckState> {
  const state: Record<string, CheckState> = {};
  for (const tick of ticks) state[tick.item] = { done: true, by: tick.done_by, at: tick.done_at };
  // The coordinator confirms the coach; the coach confirming the session
  // counts too, and the coach saying they cannot come flags it.
  if (session.coach_unavailable) state.instructor_confirmed = { done: false, flagged: String(session.coach_unavailable) };
  else if (!state.instructor_confirmed?.done && session.coach_confirmed_at)
    state.instructor_confirmed = { done: true, at: session.coach_confirmed_at };
  state.attendance_taken = {
    done: activeStudents.length > 0 && activeStudents.every((id) => marked.has(id)),
  };
  const result: Record<string, CheckState> = {};
  for (const item of sessionChecklist)
    if (appliesTo(item, session)) result[item.key] = state[item.key] || { done: false };
  return result;
}
