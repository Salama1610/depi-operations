import test from "node:test";
import assert from "node:assert/strict";
import {
  levelOf,
  openFlags,
  scoreOf,
  sessionSummaries,
  totals,
  trendByWeek,
  weeklyBlocks,
} from "../lib/domain/feedback.ts";

const response = (session_id, a, b = a, c = a) => ({ session_id, satisfaction: a, clarity: b, usefulness: c });

test("one rule colours a score: 4 and up good, 3 up to 4 orange, below 3 red", () => {
  assert.equal(levelOf(5), "good");
  assert.equal(levelOf(4), "good");
  assert.equal(levelOf(3.9), "watch");
  assert.equal(levelOf(3), "watch");
  assert.equal(levelOf(2.9), "flag");
  assert.equal(levelOf(1), "flag");
  assert.equal(levelOf(null), null);
});

test("a score is the average of every rating, to one decimal, ignoring anything that is not 1 to 5", () => {
  assert.equal(scoreOf([response("S", 5, 4, 3)]), 4);
  assert.equal(scoreOf([response("S", 3, 3, 2), response("S", 3, 3, 3)]), 2.8);
  // 2.97 shows as 3.0, so it is orange, not red: the colour agrees with the number.
  assert.equal(scoreOf([...Array(32)].map(() => response("S", 3)).concat([response("S", 2)])), 3);
  assert.equal(scoreOf([response("S", 0, 9, "x")]), null);
  assert.equal(scoreOf([]), null);
});

const sessions = [
  { id: "S1", group_id: "G1", coach_id: "C1", week: 1, starts_at: "2026-10-02T09:00:00Z" },
  { id: "S2", group_id: "G1", coach_id: "C1", week: 2, starts_at: "2026-10-09T09:00:00Z" },
  { id: "S3", group_id: "G2", coach_id: "C2", week: 2, starts_at: "2026-10-09T12:00:00Z" },
  { id: "S4", group_id: "G2", coach_id: "C2", week: 3, starts_at: "2026-10-16T12:00:00Z" },
];
const rows = [
  response("S1", 5), response("S1", 4),
  response("S2", 2), response("S2", 3, 2, 2),
  response("S3", 3), response("S3", 4, 3, 3),
];

test("only rated sessions are summarised, newest first", () => {
  const summaries = sessionSummaries(sessions, rows);
  assert.deepEqual(summaries.map((s) => [s.session_id, s.score, s.level, s.responses]), [
    ["S3", 3.2, "watch", 2],
    ["S2", 2.2, "flag", 2],
    ["S1", 4.5, "good", 2],
  ]);
});

test("totals give the average, how often each rating was given, and each question", () => {
  const all = totals(rows);
  assert.equal(all.responses, 6);
  assert.deepEqual(all.distribution, [0, 5, 6, 4, 3]);
  assert.equal(all.distribution.reduce((a, b) => a + b, 0), 18);
  assert.equal(all.score, 3.3);
  assert.equal(all.satisfaction, 3.5);
});

test("the trend runs oldest week first", () => {
  const trend = trendByWeek(sessionSummaries(sessions, rows), rows);
  assert.deepEqual(trend, [
    { week: 1, score: 4.5, responses: 2 },
    { week: 2, score: 2.7, responses: 4 },
  ]);
});

test("each week is a block of coaches, lowest first, with flags still open", () => {
  const summaries = sessionSummaries(sessions, rows);
  const blocks = weeklyBlocks(summaries, rows, new Set());
  assert.deepEqual(blocks.map((b) => b.week), [2, 1]);
  const week2 = blocks[0];
  assert.equal(week2.responses, 4);
  assert.equal(week2.flags, 1);
  assert.equal(week2.open_flags, 1);
  assert.deepEqual(week2.coaches.map((c) => [c.coach_id, c.score, c.level, c.open_flags]), [
    ["C1", 2.2, "flag", 1],
    ["C2", 3.2, "watch", 0],
  ]);
  const handled = weeklyBlocks(summaries, rows, new Set(["S2"]))[0];
  assert.equal(handled.flags, 1);
  assert.equal(handled.open_flags, 0);
});

test("open flags are the red sessions nobody has handled, the longest-waiting first", () => {
  const more = [...rows, response("S4", 1)];
  const summaries = sessionSummaries(sessions, more);
  assert.deepEqual(openFlags(summaries, new Set()).map((s) => s.session_id), ["S2", "S4"]);
  assert.deepEqual(openFlags(summaries, new Set(["S2"])).map((s) => s.session_id), ["S4"]);
});
