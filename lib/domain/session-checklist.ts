// The per-session checklist from the operations sheet.
//
// The coordinator and the coach tick their own steps; the steps the app
// already knows (the coach's confirmation, the attendance register and the
// sum of the confirmations) are worked out and cannot be ticked by hand.

export type ChecklistStage = "Before" | "During" | "After";
export type ChecklistOwner = "coordinator" | "coach" | "auto";

export type ChecklistItem = {
  key: string;
  label: string;
  stage: ChecklistStage;
  owner: ChecklistOwner;
  /** The first session week the step applies to. */
  fromWeek?: number;
};

export const sessionChecklist: ChecklistItem[] = [
  { key: "trainer_notified", label: "Trainer notified", stage: "Before", owner: "coordinator" },
  { key: "trainer_confirmed", label: "Trainer confirmed", stage: "Before", owner: "auto" },
  { key: "whatsapp_confirmed", label: "Confirmed on WhatsApp", stage: "Before", owner: "coordinator" },
  { key: "technical_confirmed", label: "Technical confirmed", stage: "Before", owner: "coordinator" },
  { key: "all_confirmations", label: "All confirmations", stage: "Before", owner: "auto" },
  { key: "trainer_joined", label: "Trainer joined the session", stage: "During", owner: "coach" },
  { key: "attendance_recorded", label: "Attendance recorded", stage: "After", owner: "auto" },
  { key: "assignment_sent", label: "Assignment sent", stage: "After", owner: "coordinator" },
  { key: "assignment_collected", label: "Assignment collected", stage: "After", owner: "coordinator", fromWeek: 2 },
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
  state.trainer_confirmed = session.coach_unavailable
    ? { done: false, flagged: String(session.coach_unavailable) }
    : { done: Boolean(session.coach_confirmed_at), at: session.coach_confirmed_at };
  const before = ["trainer_notified", "trainer_confirmed", "whatsapp_confirmed", "technical_confirmed"];
  const away = session.coach_unavailable || session.coordinator_unavailable;
  state.all_confirmations = away
    ? { done: false, flagged: String(away) }
    : { done: before.every((k) => state[k]?.done) };
  state.attendance_recorded = {
    done: activeStudents.length > 0 && activeStudents.every((id) => marked.has(id)),
  };
  const result: Record<string, CheckState> = {};
  for (const item of sessionChecklist)
    if (appliesTo(item, session)) result[item.key] = state[item.key] || { done: false };
  return result;
}
