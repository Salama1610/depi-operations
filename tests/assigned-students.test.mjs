// A person's students: the same number on every screen, each group and each
// student counted once, with the students who are not active shown apart so the
// total matches the roster (12 November 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { assignedStudents, groupsHeldBy, studentTotals, studentsOfGroups } from "../lib/domain/assigned-students.ts";

const groups = [
  { id: "G1", coordinator: "U1", supervisor: "U9", coach: "C1" },
  { id: "G2", coordinator: "U1", supervisor: "U1", coach: "U1" }, // the same person in three roles of one group
  { id: "G3", coordinator: "U2", supervisor: "U9", coach: "C1" },
];
const students = [
  { id: "S1", group_id: "G1", lifecycle: "Active" },
  { id: "S2", group_id: "G1", lifecycle: "Revoked" },
  { id: "S3", group_id: "G2", lifecycle: "Active" },
  { id: "S4", group_id: "G2", lifecycle: "Withdrawn" },
  { id: "S5", group_id: "G2", lifecycle: "Removed" },
  { id: "S6", group_id: "G3", lifecycle: "Active" },
];

test("a group is counted once, however many roles the person holds in it", () => {
  assert.deepEqual([...groupsHeldBy(groups, "U1")].sort(), ["G1", "G2"]);
  assert.deepEqual([...groupsHeldBy(groups, "U1", ["coordinator"])].sort(), ["G1", "G2"]);
  assert.deepEqual([...groupsHeldBy(groups, "C1")].sort(), ["G1", "G3"]);
  assert.equal(groupsHeldBy(groups, "").size, 0);
  assert.equal(groupsHeldBy(groups, null).size, 0);
});

test("a student is counted once even when the list repeats them", () => {
  const twice = [...students, { id: "S1", group_id: "G1", lifecycle: "Active" }, { id: "S3", group_id: "G2", lifecycle: "Active" }];
  assert.equal(studentsOfGroups(twice, new Set(["G1", "G2"])).length, 5);
  assert.equal(studentTotals(twice).total, 6);
});

test("active, revoked and not active add up to the roster's total", () => {
  const mine = assignedStudents(groups, students, "U1");
  assert.deepEqual(mine.totals, { total: 5, active: 2, revoked: 1, inactive: 2 });
  assert.equal(mine.totals.active + mine.totals.revoked + mine.totals.inactive, mine.totals.total);
  assert.equal(mine.active.length, 2);
});

test("students reached in somebody else's group are not this person's students", () => {
  // U2 coordinates G3 only; S1 to S5 are visible to them through an account but are not theirs.
  const mine = assignedStudents(groups, students, "U2");
  assert.deepEqual(mine.students.map((s) => s.id), ["S6"]);
  assert.equal(mine.totals.total, 1);
});

test("a person who holds no group has no students", () => {
  const none = assignedStudents(groups, students, "U404");
  assert.equal(none.totals.total, 0);
  assert.equal(none.students.length, 0);
});

test("any other status counts as not active, never as lost", () => {
  const totals = studentTotals([
    { id: "A", lifecycle: "Paused" },
    { id: "B", lifecycle: "Graduate Closed" },
    { id: "C", lifecycle: "Transferred" },
    { id: "D", lifecycle: "Active" },
  ]);
  assert.deepEqual(totals, { total: 4, active: 1, revoked: 0, inactive: 3 });
});
