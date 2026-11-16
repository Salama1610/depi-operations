// Whose service rows each person follows in Service operations (16 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { followsServiceRow, seesEveryServiceRow } from "../lib/domain/service-rows.ts";

const groups = new Map([
  ["G1", { id: "G1", coordinator: "C1", supervisor: "S1" }],
  ["G2", { id: "G2", coordinator: "C2", supervisor: "S2" }],
]);
const groupOf = (id) => groups.get(id);
// An account written to C2 whose student is in C1's group.
const row = { id: "ACC-1", coordinator_id: "C2", student_id: "ST-1", student_group: "G1", student_coordinator_id: "C1" };

test("a coordinator follows their own groups' students, whoever is written on the account", () => {
  assert.equal(followsServiceRow({ id: "C1", roles: ["Operations Coordinator"] }, row, groupOf), true);
  assert.equal(followsServiceRow({ id: "C2", roles: ["Operations Coordinator"] }, row, groupOf), false, "the account's coordinator, not the student's");
  assert.equal(followsServiceRow({ id: "C1", roles: '["Operations Coordinator"]' }, { ...row, student_coordinator_id: undefined }, groupOf), true, "roles as stored text, the coordinator read from the group");
  assert.equal(followsServiceRow({ id: "C1", roles: ["Operations Coordinator"] }, { ...row, student_id: null }, groupOf), false, "no student, no row");
});

test("a supervisor follows their groups' students; the keepers and leaders every row", () => {
  assert.equal(followsServiceRow({ id: "S1", roles: ["Team Supervisor"], team: "Target Team" }, row, groupOf), true);
  assert.equal(followsServiceRow({ id: "S2", roles: ["Team Supervisor"], team: "Target Team" }, row, groupOf), false);
  const waheed = { id: "W", roles: ["Team Supervisor"], team: "Service Team" };
  const taha = { id: "T", roles: ["Project Operations", "Team Supervisor"] };
  assert.equal(seesEveryServiceRow(waheed) && seesEveryServiceRow(taha), true);
  assert.equal(followsServiceRow(waheed, row, groupOf) && followsServiceRow(taha, row, groupOf), true);
});

test("every row is followed by exactly one coordinator, so the coordinators add up to the keepers", () => {
  const rows = [row, { ...row, id: "ACC-2", student_id: "ST-2", student_group: "G2", student_coordinator_id: "C2" }, { ...row, id: "ACC-3", student_id: "ST-3" }];
  const coordinators = ["C1", "C2"].map((id) => ({ id, roles: ["Operations Coordinator"] }));
  for (const r of rows) assert.equal(coordinators.filter((c) => followsServiceRow(c, r, groupOf)).length, 1);
  const total = coordinators.reduce((n, c) => n + rows.filter((r) => followsServiceRow(c, r, groupOf)).length, 0);
  assert.equal(total, rows.filter((r) => followsServiceRow({ id: "W", roles: ["Team Supervisor"], team: "Service Team" }, r, groupOf)).length);
});
