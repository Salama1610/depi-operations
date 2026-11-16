// A student holds at most three client accounts, and since 17 November 2026
// the three may all be on one marketplace.
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountMixMessage,
  accountMixProblem,
  accountsFollowTheRule,
  nextAccountMustBeOn,
  otherMarketplace,
  sameMarketplaceAllowed,
} from "../lib/domain/student-accounts.ts";

test("two on Kafeel and one on Nafezly, or the opposite, are allowed", () => {
  assert.equal(accountMixProblem(["Kafeel", "Kafeel"], "Nafezly"), null);
  assert.equal(accountMixProblem(["Nafezly", "Nafezly"], "Kafeel"), null);
  assert.equal(accountMixProblem(["Kafeel", "Nafezly"], "Kafeel"), null);
  assert.equal(accountMixProblem(["Kafeel", "Nafezly"], "Nafezly"), null);
});

test("a third account on the marketplace of two identical ones is allowed", () => {
  assert.equal(accountMixProblem(["Kafeel", "Kafeel"], "Kafeel"), null);
  assert.equal(accountMixProblem(["Nafezly", "Nafezly"], "Nafezly"), null);
  assert.equal(sameMarketplaceAllowed, true);
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

test("a set of accounts follows the rule unless it is more than three", () => {
  assert.equal(accountsFollowTheRule(["Kafeel", "Kafeel", "Nafezly"]), true);
  assert.equal(accountsFollowTheRule(["Nafezly", "Nafezly", "Kafeel"]), true);
  assert.equal(accountsFollowTheRule(["Kafeel", "Kafeel"]), true);
  assert.equal(accountsFollowTheRule(["Kafeel", "Kafeel", "Kafeel"]), true);
  assert.equal(accountsFollowTheRule(["Nafezly", "Nafezly", "Nafezly"]), true);
  assert.equal(accountsFollowTheRule(["Kafeel", "Nafezly", "Kafeel", "Nafezly"]), false);
});

test("no marketplace is forced on a student's next account", () => {
  assert.equal(nextAccountMustBeOn(["Kafeel", "Kafeel"]), null);
  assert.equal(nextAccountMustBeOn(["Nafezly", "Nafezly"]), null);
  assert.equal(nextAccountMustBeOn(["Kafeel", "Nafezly"]), null);
  assert.equal(nextAccountMustBeOn([]), null);
});
