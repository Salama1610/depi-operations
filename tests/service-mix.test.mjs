// In the service groups a student's three services must cover both marketplaces:
// two on one and one on the other, never three on one (12 November 2026).
// Everywhere else the mix stays "any".
import test from "node:test";
import assert from "node:assert/strict";
import {
  buysServices,
  normalizeServiceSlots,
  serviceProgress,
  servicesComplete,
  servicesCompleteFrom,
  submissionComplete,
} from "../lib/domain/service-links.ts";

const SERVICE = "CAI5_DRT1_S1";
const OTHER = "CAI5_DRT9_G9";
const link = (platform, qc_status = "Locked") => ({ platform, qc_status });
const k = (i) => `https://kafiil.com/service/${i}-a`;
const n = (i) => `https://nafezly.com/service/${i}-a`;

test("the service groups are the ones that buy services", () => {
  assert.equal(buysServices(SERVICE), true);
  assert.equal(buysServices(OTHER), false);
  assert.equal(buysServices(" cai5_drt1_s1 "), true);
});

test("a service-group student's services are complete only with both marketplaces among the three", () => {
  assert.equal(servicesComplete([link("Kafiil"), link("Kafiil"), link("Nafezly")], SERVICE), true);
  assert.equal(servicesComplete([link("Nafezly"), link("Nafezly"), link("Kafiil")], SERVICE), true);
  assert.equal(servicesComplete([link("Kafiil"), link("Kafiil"), link("Kafiil")], SERVICE), false, "three on one marketplace");
  assert.equal(servicesComplete([link("Nafezly"), link("Nafezly"), link("Nafezly")], SERVICE), false);
  assert.equal(servicesComplete([link("Kafiil"), link("Kafiil"), link("Kafiil"), link("Nafezly")], SERVICE), true, "a fourth on the other marketplace covers both");
});

test("outside the service groups three on one marketplace is still complete", () => {
  assert.equal(servicesComplete([link("Kafiil"), link("Kafiil"), link("Kafiil")], OTHER), true);
  assert.equal(servicesComplete([link("Nafezly"), link("Nafezly"), link("Nafezly")]), true, "no group: any mix");
});

test("a link waiting for review, or fewer than three, is never complete", () => {
  assert.equal(servicesComplete([link("Kafiil"), link("Nafezly"), link("Kafiil", "Pending")], SERVICE), false);
  assert.equal(servicesComplete([link("Kafiil"), link("Nafezly")], SERVICE), false);
  assert.equal(servicesComplete([link("Kafiil"), link("Nafezly"), link("External service")], SERVICE), false, "other sites do not count");
  assert.equal(servicesCompleteFrom({ kafiil: 2, nafezly: 1 }, 0, SERVICE), true);
  assert.equal(servicesCompleteFrom({ kafiil: 3, nafezly: 0 }, 0, SERVICE), false);
});

test("the workspace's per-student counts follow the same rule", () => {
  const row = (kafiil, nafezly, pending = 0, group_id = SERVICE) => ({ links_done: kafiil + nafezly, links_kafiil_done: kafiil, links_nafezly_done: nafezly, links_pending: pending, group_id });
  assert.equal(submissionComplete(row(2, 1)), true);
  assert.equal(submissionComplete(row(3, 0)), false);
  assert.equal(submissionComplete(row(3, 0, 0, OTHER)), true);
  assert.equal(submissionComplete(row(2, 1, 1)), false);
  assert.equal(submissionComplete({ links_done: 3, links_pending: 0 }), true, "counts without the split read as before");
});

test("progress names the marketplace a service-group student is still missing", () => {
  const two = serviceProgress(["Kafiil", "Kafiil"], SERVICE);
  assert.deepEqual([two.met, two.missing], [false, ["Nafezly"]]);
  const three = serviceProgress(["Kafiil", "Kafiil", "Kafiil"], SERVICE);
  assert.deepEqual([three.required, three.met, three.missing], [3, false, ["Nafezly"]]);
  const mixed = serviceProgress(["Nafezly", "Kafiil", "Nafezly"], SERVICE);
  assert.deepEqual([mixed.met, mixed.missing], [true, []]);
  assert.equal(serviceProgress(["Kafiil", "Kafiil", "Kafiil"], OTHER).met, true, "outside the service groups any mix is met");
  assert.equal(serviceProgress(["Kafiil", "Kafiil", "Kafiil"], true).met, false, "the page is told once that both are needed");
  assert.deepEqual(serviceProgress([], SERVICE).missing, ["Kafiil", "Nafezly"]);
});

test("a service-group submission with all links on one marketplace is refused, two and one is accepted", () => {
  assert.throws(() => normalizeServiceSlots([k(1), k(2), k(3)], SERVICE), /at least one on Kafiil and one on Nafezly/);
  assert.throws(() => normalizeServiceSlots([n(1), n(2), n(3)], SERVICE), /at least one on Kafiil and one on Nafezly/);
  assert.deepEqual(normalizeServiceSlots([k(1), k(2), n(3)], SERVICE), [k(1), k(2), n(3)]);
  assert.deepEqual(normalizeServiceSlots([n(1), n(2), k(3)], SERVICE), [n(1), n(2), k(3)]);
  assert.deepEqual(normalizeServiceSlots([k(1), k(2), k(3)], OTHER), [k(1), k(2), k(3)], "outside the service groups three on one is accepted");
  assert.deepEqual(normalizeServiceSlots([k(1), k(2), k(3)]), [k(1), k(2), k(3)], "no group: any mix");
  assert.throws(() => normalizeServiceSlots([k(1), n(2)], SERVICE), /at least 3 Kafiil or Nafezly links/);
});
