// Each coach's students by where they stand on the portal: every student in
// one count, so the counts add up to the students assigned.
import test from "node:test";
import assert from "node:assert/strict";
import { coachStudentCounts, portalStanding } from "../lib/domain/portal-coach-students.ts";

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
