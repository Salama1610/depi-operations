// Whose service rows each person follows in Service operations (16 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { filterServiceRows, followsServiceRow, rowCoordinator, seesEveryServiceRow } from "../lib/domain/service-rows.ts";

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

// The filters of Service operations (17 Nov 2026).
const filterRows = [
  // C1's student, bought through an account written to C2.
  { id: "ACC-1", student_id: "ST-1", student_name: "Mona Adel", student_group: "G1", student_coordinator_id: "C1", coordinator_id: "C2", label: "mona@example.org", platform: "Kafeel", state: "Buy", service_url: "https://kafiil.com/a" },
  { id: "ACC-2", student_id: "ST-2", student_name: "Omar Said", student_group: "G2", student_coordinator_id: "C2", coordinator_id: "C2", label: "omar@example.org", platform: "Nafezly", state: "Done", service_url: "https://nafezly.com/b" },
  { id: "ACC-3", student_id: "ST-3", student_name: "Rana Fathy", student_group: "G1", student_coordinator_id: undefined, coordinator_id: "C2", label: "rana@example.org", platform: "Kafeel", state: "No order yet", service_url: "" },
];
const ids = (rows) => rows.map((r) => r.id);
const none = { q: "", status: "All", coordinator: "All", supervisor: "All", group: "All", platform: "All" };

test("the coordinator filter is the student's coordinator, the one the column shows, not the one written on the account", () => {
  assert.equal(rowCoordinator(filterRows[0], groupOf), "C1");
  assert.equal(rowCoordinator(filterRows[2], groupOf), "C1", "read from the student's group when the row has none");
  assert.deepEqual(ids(filterServiceRows(filterRows, { ...none, coordinator: "C1" }, groupOf)), ["ACC-1", "ACC-3"]);
  assert.deepEqual(ids(filterServiceRows(filterRows, { ...none, coordinator: "C2" }, groupOf)), ["ACC-2"], "ACC-1 and ACC-3 are written to C2 but are not C2's students");
});

test("every filter narrows and they combine; All and empty mean no filter", () => {
  assert.deepEqual(ids(filterServiceRows(filterRows, none, groupOf)), ["ACC-1", "ACC-2", "ACC-3"]);
  assert.deepEqual(ids(filterServiceRows(filterRows, {}, groupOf)), ["ACC-1", "ACC-2", "ACC-3"]);
  assert.deepEqual(ids(filterServiceRows(filterRows, { ...none, supervisor: "S1" }, groupOf)), ["ACC-1", "ACC-3"]);
  assert.deepEqual(ids(filterServiceRows(filterRows, { ...none, group: "G2" }, groupOf)), ["ACC-2"]);
  assert.deepEqual(ids(filterServiceRows(filterRows, { ...none, platform: "Kafeel" }, groupOf)), ["ACC-1", "ACC-3"]);
  assert.deepEqual(ids(filterServiceRows(filterRows, { ...none, status: "No order yet" }, groupOf)), ["ACC-3"]);
  assert.deepEqual(ids(filterServiceRows(filterRows, { ...none, platform: "Kafeel", status: "Buy" }, groupOf)), ["ACC-1"]);
  assert.deepEqual(ids(filterServiceRows(filterRows, { ...none, group: "G2", platform: "Kafeel" }, groupOf)), []);
  // The search finds the student, the ID, the account and the link, in any case.
  for (const q of ["mona", "ST-2", "OMAR@EXAMPLE", "nafezly.com/b"]) assert.equal(filterServiceRows(filterRows, { ...none, q }, groupOf).length, 1, q);
});

test("the state tiles count what the other filters leave, whichever state is chosen", () => {
  const chosen = { ...none, status: "Done", platform: "Kafeel" };
  const base = filterServiceRows(filterRows, chosen, groupOf, "status");
  assert.deepEqual(ids(base), ["ACC-1", "ACC-3"], "the state is left out");
  assert.deepEqual(["Buy", "Done", "No order yet"].map((state) => base.filter((r) => r.state === state).length), [1, 0, 1]);
  assert.deepEqual(ids(filterServiceRows(filterRows, chosen, groupOf)), [], "and on the list the state applies");
});
