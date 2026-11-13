// Each coach's students by where they stand on the portal: every student in
// one count, so the counts add up to the students assigned.
import test from "node:test";
import assert from "node:assert/strict";
import { coachStudentCounts, portalStanding, rankCoaches } from "../lib/domain/portal-coach-students.ts";

test("the portal's Final Status gives where a student stands", () => {
  assert.equal(portalStanding("Graduated"), "graduated");
  assert.equal(portalStanding(" started "), "started");
  assert.equal(portalStanding("Not Started"), "not_started");
  assert.equal(portalStanding(""), "no_status");
  assert.equal(portalStanding(null), "no_status");
  assert.equal(portalStanding("Something new"), "no_status");
});

test("each coach's students are counted once, and a group without a coach comes last", () => {
  const { coaches, total } = coachStudentCounts(
    [
      { id: "S1", group_id: "G1", coach_id: "C2", coach_name: "Zeina" },
      { id: "S2", group_id: "G1", coach_id: "C2", coach_name: "Zeina" },
      { id: "S3", group_id: "G2", coach_id: "C2", coach_name: "Zeina" },
      { id: "S4", group_id: "G2", coach_id: "C2", coach_name: "Zeina" },
      { id: "S5", group_id: "G3", coach_id: "C1", coach_name: "Amal" },
      { id: "S6", group_id: "G4", coach_id: null, coach_name: null },
    ],
    [
      { student_id: "S1", final_status: "Graduated" },
      { student_id: "S2", final_status: "Started" },
      // Two portal records: the further one counts, whichever comes first.
      { student_id: "S2", final_status: "Not Started" },
      { student_id: "S3", final_status: "Not Started" },
      { student_id: "S3", final_status: "Started" },
      { student_id: "S5", final_status: "Not Started" },
      // Not among the coaches' students.
      { student_id: "OTHER", final_status: "Graduated" },
      { student_id: null, final_status: "Graduated" },
    ],
  );
  assert.deepEqual(coaches.map((c) => c.coach_name), ["Amal", "Zeina", null]);
  assert.deepEqual(coaches[1], { coach_id: "C2", coach_name: "Zeina", groups: 2, assigned: 4, started: 2, not_started: 0, graduated: 1, no_status: 1 });
  assert.deepEqual(coaches[0], { coach_id: "C1", coach_name: "Amal", groups: 1, assigned: 1, started: 0, not_started: 1, graduated: 0, no_status: 0 });
  assert.deepEqual(coaches[2], { coach_id: null, coach_name: null, groups: 1, assigned: 1, started: 0, not_started: 0, graduated: 0, no_status: 1 });
  assert.deepEqual(total, { assigned: 6, started: 2, not_started: 1, graduated: 1, no_status: 2 });
});

test("the coaches are ranked from the furthest behind: students not moving, as a share, and gigs left waiting", () => {
  const row = (coach_id, assigned, not_started, no_status) => ({ coach_id, coach_name: coach_id, groups: 1, assigned, started: assigned - not_started - no_status, not_started, graduated: 0, no_status });
  const today = new Date("2026-11-08T12:00:00Z");
  const ranking = rankCoaches(
    [row("A", 10, 8, 1), row("B", 40, 10, 0), row("C", 10, 2, 0), row(null, 5, 5, 0)],
    [
      { coach_id: "B", created_on: "2026-10-20" },
      { coach_id: "B", created_on: "2026-10-25" },
      { coach_id: "B", created_on: "2026-11-07" },
      // Sent again after an edit yesterday: waiting one day, not three weeks.
      { coach_id: "C", created_on: "2026-10-15", updated_on: "2026-11-07" },
      { coach_id: "A", created_on: "2026-10-30" },
      { coach_id: null, created_on: "2026-10-01" },
    ],
    today,
  );
  assert.deepEqual(ranking.map((r) => r.coach_id), ["A", "B", "C"], "a group without a coach is not ranked");
  assert.deepEqual(
    ranking.map((r) => [r.coach_id, r.rank, r.not_moving, r.not_moving_pct, r.waiting, r.slow, r.oldest_days]),
    [
      ["A", 1, 9, 90, 1, 1, 9],
      ["B", 2, 10, 25, 3, 2, 19],
      ["C", 3, 2, 20, 1, 0, 1],
    ],
  );
  assert.deepEqual(rankCoaches([row("D", 0, 0, 0)], [], today)[0], { ...row("D", 0, 0, 0), not_moving: 0, not_moving_pct: 0, waiting: 0, slow: 0, oldest_days: null, rank: 1 });
});

test("each group's share of graduates, the highest first (13 Nov 2026)", () => {
  const { groups } = coachStudentCounts(
    [
      { id: "S1", group_id: "G1", coach_id: "C1", coach_name: "Amal" },
      { id: "S2", group_id: "G1", coach_id: "C1", coach_name: "Amal" },
      { id: "S3", group_id: "G1", coach_id: "C1", coach_name: "Amal" },
      { id: "S4", group_id: "G2", coach_id: "C2", coach_name: "Zeina" },
      { id: "S5", group_id: "G2", coach_id: "C2", coach_name: "Zeina" },
    ],
    [
      { student_id: "S1", final_status: "Graduated" },
      { student_id: "S4", final_status: "Graduated" },
      { student_id: "S5", final_status: "Graduated" },
      { student_id: "S2", final_status: "Started" },
    ],
  );
  assert.deepEqual(
    groups.map((g) => [g.group_id, g.coach_name, g.assigned, g.graduated, g.graduated_pct]),
    [
      ["G2", "Zeina", 2, 2, 100],
      ["G1", "Amal", 3, 1, 33],
    ],
  );
});
