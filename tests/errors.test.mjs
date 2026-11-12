// How a route answers a failure (lib/errors.ts): a refusal keeps its message,
// a database rule keeps a message written for people, and anything else is
// logged and answered with a general message, never the driver's text.
import test from "node:test";
import assert from "node:assert/strict";
import { failure } from "../lib/errors.ts";
import { Refusal, ensure } from "../lib/domain/rules.ts";

const quietly = async (fn) => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
};

test("a refusal keeps its message and status, and is not logged as a fault", async () => {
  const thrown = (() => {
    try {
      ensure(false, "Choose a group.");
    } catch (e) {
      return e;
    }
  })();
  assert.ok(thrown instanceof Refusal);
  const { result, logged } = await quietly(() => failure(thrown, "test"));
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "Choose a group." });
  assert.equal(logged.length, 0);
  assert.equal((await failure(thrown, "test", { refusalStatus: 403 })).status, 403);
});

test("a database rule answers 409 with a message for people, not the key values", async () => {
  const unique = Object.assign(new Error('UNIQUE constraint failed: students.email (Key (email)=(someone@example.org) already exists.)'), { code: "23505" });
  const { result, logged } = await quietly(() => failure(unique, "test"));
  assert.equal(result.status, 409);
  const body = await result.json();
  assert.match(body.error, /duplicate record/);
  assert.ok(!body.error.includes("someone@example.org"));
  assert.equal(logged.length, 0);
  const trigger = Object.assign(new Error("Evidence reviews are immutable."), { code: "P0001" });
  assert.deepEqual(await (await failure(trigger, "test")).json(), { error: "Evidence reviews are immutable." });
});

test("anything else is logged with its route and answered with a general message", async () => {
  const outage = new Error("The database is unreachable: fetch failed (supabase.co)");
  const { result, logged } = await quietly(() => failure(outage, "operations", { user: { id: "staff-1" } }));
  assert.equal(result.status, 500);
  const body = await result.json();
  assert.ok(!body.error.includes("supabase"), "no transport detail reaches the person");
  assert.ok(body.reference, "a reference to quote");
  assert.equal(logged.length, 1);
  const entry = JSON.parse(logged[0]);
  assert.equal(entry.route, "operations");
  assert.equal(entry.user, "staff-1");
  assert.equal(entry.reference, body.reference);
  assert.match(entry.message, /unreachable/);
});
