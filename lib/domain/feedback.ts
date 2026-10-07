/**
 * Students' feedback after their sessions, summarised for the people who run
 * the groups.
 *
 * Each response rates the session three ways, 1 to 5: how satisfied the student
 * was, how clear the coach's explanation was, and how useful the mentorship
 * was. A session's score is the average of every rating its students gave it,
 * to one decimal. One rule colours a score everywhere in the app:
 *
 *   4 or more        good
 *   3 up to 4        watch (orange)
 *   below 3          flag (red): it stays on Coach Operations' first screen
 *                    until someone records what was done about it
 */

export type FeedbackLevel = "good" | "watch" | "flag";

/** Scores below this are orange. */
export const watchBelow = 4;
/** Scores below this are red flags. */
export const flagBelow = 3;

export type Ratings = { satisfaction: number | string; clarity: number | string; usefulness: number | string };

export type FeedbackSession = {
  id: string;
  group_id: string;
  coach_id?: string | null;
  week?: number | string | null;
  starts_at: string;
};

export type SessionSummary = {
  session_id: string;
  group_id: string;
  coach_id: string | null;
  week: number;
  starts_at: string;
  responses: number;
  score: number;
  level: FeedbackLevel;
};

/** A rating as stored, if it is one: a whole number from 1 to 5. */
function rating(value: number | string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** The three ratings of one response. */
function ratingsOf(row: Ratings) {
  return [row.satisfaction, row.clarity, row.usefulness].map(rating).filter((n): n is number => n !== null);
}

/** The mean to one decimal, or null when there is nothing to average. */
function averageOf(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 10) / 10 : null;
}

/**
 * The average of every rating in these responses, to one decimal, or null
 * when there are none. The level is taken from this rounded figure, so the
 * colour always agrees with the number shown beside it.
 */
export function scoreOf(rows: Ratings[]): number | null {
  return averageOf(rows.flatMap(ratingsOf));
}

export function levelOf(score: number | null | undefined): FeedbackLevel | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return score < flagBelow ? "flag" : score < watchBelow ? "watch" : "good";
}

/** Every rated session with its score and level, newest first. */
export function sessionSummaries<R extends Ratings & { session_id: string }>(
  sessions: FeedbackSession[],
  rows: R[],
): SessionSummary[] {
  const bySession = new Map<string, R[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id);
    if (list) list.push(row);
    else bySession.set(row.session_id, [row]);
  }
  const out: SessionSummary[] = [];
  for (const session of sessions) {
    const given = bySession.get(session.id);
    const score = given ? scoreOf(given) : null;
    if (!given || score === null) continue;
    out.push({
      session_id: session.id,
      group_id: session.group_id,
      coach_id: session.coach_id || null,
      week: Number(session.week) || 0,
      starts_at: session.starts_at,
      responses: given.length,
      score,
      level: levelOf(score)!,
    });
  }
  return out.sort((a, b) => b.starts_at.localeCompare(a.starts_at));
}

/**
 * The whole picture: the average, how often each rating 1 to 5 was given
 * (counting each of a response's three ratings), and each question's average.
 */
export function totals(rows: Ratings[]) {
  const distribution = [0, 0, 0, 0, 0];
  for (const n of rows.flatMap(ratingsOf)) distribution[n - 1] += 1;
  const question = (key: keyof Ratings) => averageOf(rows.map((r) => rating(r[key])).filter((n): n is number => n !== null));
  return {
    responses: rows.length,
    score: scoreOf(rows),
    distribution,
    satisfaction: question("satisfaction"),
    clarity: question("clarity"),
    usefulness: question("usefulness"),
  };
}

/** The average by programme week, oldest first, for the trend line. */
export function trendByWeek(summaries: SessionSummary[], rows: (Ratings & { session_id: string })[]) {
  const weekOf = new Map(summaries.map((s) => [s.session_id, s.week]));
  const byWeek = new Map<number, (Ratings & { session_id: string })[]>();
  for (const row of rows) {
    const week = weekOf.get(row.session_id);
    if (week === undefined) continue;
    const list = byWeek.get(week);
    if (list) list.push(row);
    else byWeek.set(week, [row]);
  }
  return [...byWeek.entries()]
    .map(([week, list]) => ({ week, score: scoreOf(list)!, responses: list.length }))
    .filter((point) => point.score !== null)
    .sort((a, b) => a.week - b.week);
}

export type CoachWeek = {
  coach_id: string | null;
  sessions: number;
  responses: number;
  score: number;
  level: FeedbackLevel;
  flags: number;
  open_flags: number;
};

/**
 * One block per week, newest first: the week's average, its number of
 * responses and red flags, and the same for each coach that week.
 */
export function weeklyBlocks(
  summaries: SessionSummary[],
  rows: (Ratings & { session_id: string })[],
  handled: Set<string>,
) {
  const rowsBySession = new Map<string, (Ratings & { session_id: string })[]>();
  for (const row of rows) {
    const list = rowsBySession.get(row.session_id);
    if (list) list.push(row);
    else rowsBySession.set(row.session_id, [row]);
  }
  const weeks = new Map<number, SessionSummary[]>();
  for (const summary of summaries) {
    const list = weeks.get(summary.week);
    if (list) list.push(summary);
    else weeks.set(summary.week, [summary]);
  }
  return [...weeks.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([week, list]) => {
      const weekRows = list.flatMap((s) => rowsBySession.get(s.session_id) || []);
      const score = scoreOf(weekRows)!;
      const coaches = new Map<string, SessionSummary[]>();
      for (const summary of list) {
        const key = summary.coach_id || "";
        const group = coaches.get(key);
        if (group) group.push(summary);
        else coaches.set(key, [summary]);
      }
      const coachRows: CoachWeek[] = [...coaches.entries()].map(([coach, sessions]) => {
        const coachScore = scoreOf(sessions.flatMap((s) => rowsBySession.get(s.session_id) || []))!;
        const flagged = sessions.filter((s) => s.level === "flag");
        return {
          coach_id: coach || null,
          sessions: sessions.length,
          responses: sessions.reduce((n, s) => n + s.responses, 0),
          score: coachScore,
          level: levelOf(coachScore)!,
          flags: flagged.length,
          open_flags: flagged.filter((s) => !handled.has(s.session_id)).length,
        };
      });
      // Lowest first, so the coach who needs attention leads the week.
      coachRows.sort((a, b) => a.score - b.score || b.responses - a.responses);
      const flags = list.filter((s) => s.level === "flag");
      return {
        week,
        score,
        level: levelOf(score)!,
        sessions: list.length,
        responses: weekRows.length,
        flags: flags.length,
        open_flags: flags.filter((s) => !handled.has(s.session_id)).length,
        coaches: coachRows,
      };
    });
}

/** Red flags nobody has handled yet, oldest first: the longest-waiting leads. */
export function openFlags(summaries: SessionSummary[], handled: Set<string>) {
  return summaries
    .filter((s) => s.level === "flag" && !handled.has(s.session_id))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
