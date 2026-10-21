// When a session ends (21 October 2026): at its start plus its duration, or
// earlier if its coordinator marked it done. Feedback opens from this moment
// and stays open a week; "held" and "ended" views use the same rule.

type SessionTimes = { starts_at: string; duration_minutes?: number | string | null; ended_at?: string | null };

/** The session's end, in milliseconds. */
export function sessionEnd(s: SessionTimes) {
  const scheduled = Date.parse(s.starts_at) + Number(s.duration_minutes || 180) * 60000;
  const marked = s.ended_at ? Date.parse(s.ended_at) : NaN;
  return Number.isFinite(marked) ? Math.min(marked, scheduled) : scheduled;
}

/** Whether the session has ended by `now` (default: this moment). */
export function sessionEnded(s: SessionTimes, now = Date.now()) {
  return sessionEnd(s) <= now;
}
