import assert from "node:assert/strict";
import test from "node:test";
import { cleanSlots, freeFor, hourRuns, hourState, sessionHours } from "../lib/domain/coach-availability.ts";

test("a session takes the Cairo hours it runs over", () => {
  // 16:00 UTC in October is 19:00 in Cairo (EEST, UTC+3).
  const h = sessionHours("2026-10-17T16:00:00.000Z", 180);
  assert.equal(h.day, "Sat");
  assert.equal(h.time, "19:00");
  assert.deepEqual(h.keys, ["Sat-19", "Sat-20", "Sat-21"]);
  assert.deepEqual(sessionHours("2026-10-17T14:30:00.000Z", 90).hours, [17, 18]);
});

test("free hours keep only valid hours, once, in week order", () => {
  assert.deepEqual(cleanSlots(["Sun-17", "Sat-9", "Sat-9", "Sat-8", "Fri-23", "x"]), ["Sat-9", "Sun-17"]);
  assert.deepEqual(hourRuns([21, 17, 18, 19]), [[17, 20], [21, 22]]);
});

test("a coach is free when declared and not booked, on every or any chosen day", () => {
  const declared = new Set(["Sat-17", "Sat-18", "Sat-19", "Sun-17", "Sun-18", "Sun-19"]);
  const booked = new Set(["Sun-18"]);
  assert.equal(hourState(declared, booked, "Sun-18"), "booked");
  assert.equal(hourState(declared, booked, "Mon-18"), "away");
  assert.equal(hourState(null, booked, "Mon-18"), "open");
  assert.equal(freeFor(declared, booked, ["Sat"], 17, 20), true);
  assert.equal(freeFor(declared, booked, ["Sat", "Sun"], 17, 20), false);
  assert.equal(freeFor(declared, booked, ["Sat", "Sun"], 17, 20, { match: "any" }), true);
  assert.equal(freeFor(null, booked, ["Mon"], 17, 20), false);
  assert.equal(freeFor(null, booked, ["Mon"], 17, 20, { includeOpen: true }), true);
  assert.equal(freeFor(null, booked, ["Sun"], 17, 20, { includeOpen: true }), false);
  assert.equal(freeFor(declared, booked, [], 17, 20), true, "no day chosen filters nothing");
});
