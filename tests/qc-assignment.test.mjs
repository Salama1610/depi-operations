// Even distribution of quality work must be predictable, must never hand one
// reviewer the whole queue, and must take existing load into account.
import test from "node:test";
import assert from "node:assert/strict";
import { distributeEvenly, spread } from "../lib/domain/qc-assignment.ts";

const items = (n) => Array.from({ length: n }, (_, i) => `L${i + 1}`);

test("an empty queue or no reviewers assigns nothing", () => {
  assert.deepEqual(distributeEvenly([], [{ id: "a", open: 0 }]), []);
  assert.deepEqual(distributeEvenly(items(3), []), []);
});

test("a fresh queue splits as evenly as arithmetic allows", () => {
  const reviewers = [{ id: "qa-1", open: 0 }, { id: "qa-2", open: 0 }, { id: "qa-3", open: 0 }];
  const result = distributeEvenly(items(10), reviewers);
  assert.equal(result.length, 10);
  const counts = {};
  for (const { reviewerId } of result) counts[reviewerId] = (counts[reviewerId] || 0) + 1;
  assert.deepEqual(counts, { "qa-1": 4, "qa-2": 3, "qa-3": 3 });
  assert.ok(spread(reviewers, result) <= 1, "nobody may end more than one item ahead of anyone else");
});

test("existing load is levelled before new work is shared", () => {
  // qa-1 already holds five open items; qa-2 holds none. The next five all go
  // to qa-2, and only then does the split resume.
  const reviewers = [{ id: "qa-1", open: 5 }, { id: "qa-2", open: 0 }];
  const result = distributeEvenly(items(7), reviewers);
  const toTwo = result.filter((r) => r.reviewerId === "qa-2").length;
  const toOne = result.filter((r) => r.reviewerId === "qa-1").length;
  assert.equal(toTwo, 6);
  assert.equal(toOne, 1);
  assert.equal(spread(reviewers, result), 0);
});

test("the same inputs always produce the same allocation", () => {
  const reviewers = [{ id: "qa-b", open: 1 }, { id: "qa-a", open: 1 }];
  const first = distributeEvenly(items(5), reviewers);
  const second = distributeEvenly(items(5), [...reviewers].reverse());
  assert.deepEqual(first, second, "reviewer order in the input must not change the result");
  assert.equal(first[0].reviewerId, "qa-a", "ties break on reviewer id");
});

test("every item is assigned exactly once", () => {
  const result = distributeEvenly(items(23), [{ id: "x", open: 2 }, { id: "y", open: 0 }, { id: "z", open: 7 }]);
  assert.equal(new Set(result.map((r) => r.itemId)).size, 23);
});
