// A student's three client accounts are two on one marketplace and one on the
// other, never all three on the same one (12 November 2026).
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountMixMessage,
  accountMixProblem,
  accountsFollowTheRule,
  nextAccountMustBeOn,
  otherMarketplace,
} from "../lib/domain/student-accounts.ts";

test("two on Kafeel and one on Nafezly, or the opposite, are allowed", () => {
  assert.equal(accountMixProblem(["Kafeel", "Kafeel"], "Nafezly"), null);
  assert.equal(accountMixProblem(["Nafezly", "Nafezly"], "Kafeel"), null);
  assert.equal(accountMixProblem(["Kafeel", "Nafezly"], "Kafeel"), null);
  assert.equal(accountMixProblem(["Kafeel", "Nafezly"], "Nafezly"), null);
});

test("a third account on the marketplace of two identical ones is refused", () => {
  assert.equal(accountMixProblem(["Kafeel", "Kafeel"], "Kafeel"), "same");
  assert.equal(accountMixProblem(["Nafezly", "Nafezly"], "Nafezly"), "same");
});

test("fewer than two accounts can be on either marketplace", () => {
  assert.equal(accountMixProblem([], "Kafeel"), null);
  assert.equal(accountMixProblem(["Kafeel"], "Kafeel"), null);
  assert.equal(accountMixProblem(["Nafezly"], "Nafezly"), null);
});

test("nobody holds more than three", () => {
  assert.equal(accountMixProblem(["Kafeel", "Kafeel", "Nafezly"], "Nafezly"), "full");
  assert.equal(accountMixProblem(["Kafeel", "Nafezly", "Nafezly"], "Kafeel"), "full");
});

test("the message names the marketplace the student needs", () => {
  assert.match(accountMixMessage("Kafeel"), /both on Kafeel, so the third has to be on Nafezly/);
  assert.match(accountMixMessage("Nafezly"), /both on Nafezly, so the third has to be on Kafeel/);
  assert.equal(otherMarketplace("Kafeel"), "Nafezly");
  assert.equal(otherMarketplace("Khamsat"), "");
});

test("a set of accounts follows the rule unless it is three of one marketplace or more than three", () => {
  assert.equal(accountsFollowTheRule(["Kafeel", "Kafeel", "Nafezly"]), true);
  assert.equal(accountsFollowTheRule(["Nafezly", "Nafezly", "Kafeel"]), true);
  assert.equal(accountsFollowTheRule(["Kafeel", "Kafeel"]), true);
  assert.equal(accountsFollowTheRule(["Kafeel", "Kafeel", "Kafeel"]), false);
  assert.equal(accountsFollowTheRule(["Nafezly", "Nafezly", "Nafezly"]), false);
  assert.equal(accountsFollowTheRule(["Kafeel", "Nafezly", "Kafeel", "Nafezly"]), false);
});

test("a student with two on one marketplace is told which one the next must be on", () => {
  assert.equal(nextAccountMustBeOn(["Kafeel", "Kafeel"]), "Nafezly");
  assert.equal(nextAccountMustBeOn(["Nafezly", "Nafezly"]), "Kafeel");
  assert.equal(nextAccountMustBeOn(["Kafeel", "Nafezly"]), null);
  assert.equal(nextAccountMustBeOn(["Kafeel"]), null);
  assert.equal(nextAccountMustBeOn([]), null);
});
