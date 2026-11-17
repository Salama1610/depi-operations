// A merge (17 November 2026): Coach Operations give one coach two groups'
// sessions at the same time. They share a merge_key; every other session keeps
// the rule of one session per coach per day.

/** The key the sessions of one coach on one day share when they are merged. */
export const mergeKey = (coachId: string, day: string) => `MRG-${coachId}-${day}`;

type Timed = { group_id?: unknown; starts_at?: unknown };

/**
 * Why these sessions cannot be merged, or null when they can: a merge is
 * one coach teaching different groups together, so they start at the same time.
 */
export function mergeProblem(session: Timed, peers: Timed[]): string | null {
  for (const peer of peers) {
    if (peer.group_id && peer.group_id === session.group_id) return `${peer.group_id} cannot be merged with itself.`;
    if (Date.parse(String(peer.starts_at)) !== Date.parse(String(session.starts_at)))
      return `A merge needs the same start time: ${peer.group_id} starts at a different time.`;
  }
  return null;
}
