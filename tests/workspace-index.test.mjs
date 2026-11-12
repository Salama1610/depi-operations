import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildWorkspaceIndex, rememberDates } from "../lib/workspace-index.ts";

test("the workspace index answers what searching the lists answered", () => {
  const d = {
    students: [
      { id: "S2", name: "Zed", group_id: "G1", lifecycle: "Active" },
      { id: "S1", name: "Ann", group_id: "G1", lifecycle: "Active" },
      { id: "S3", name: "Gone", group_id: "G1", lifecycle: "Withdrawn" },
      { id: "S4", name: "Other", group_id: "G2", lifecycle: "Active" },
    ],
    attendance: [
      { session_id: "A", student_id: "S1", status: "Present" },
      { session_id: "A", student_id: "S1", status: "Absent" },
      { session_id: "A", student_id: "S2", status: "Absent" },
      { session_id: "B", student_id: "S4", status: "Present" },
    ],
    sessionChecks: [{ session_id: "A", item: "attendance_taken" }],
    sessionFeedback: [{ session_id: "B", student_id: "S4" }],
    staff: [{ id: "U1", name: "Sara" }],
    groups: [{ id: "G1", name: "One" }],
  };
  const index = buildWorkspaceIndex(d);
  assert.deepEqual(index.activeByGroup.get("G1").map((s) => s.id), ["S1", "S2"], "active students only, by name");
  assert.equal(index.activeByGroup.get("G9"), undefined);
  assert.equal(index.marksBySession.get("A").length, 3);
  assert.equal(index.markOf("A", "S1").status, "Present", "the first mark, as Array.find returned it");
  assert.equal(index.markOf("A", "S4"), undefined);
  assert.equal(index.checksBySession.get("A").length, 1);
  assert.equal(index.feedbackBySession.get("B").length, 1);
  assert.equal(index.staffById.get("U1").name, "Sara");
  assert.equal(index.groupsById.get("G1").name, "One");
  assert.equal(index.studentsById.get("S3").name, "Gone", "every student, whatever their lifecycle");
  assert.equal(buildWorkspaceIndex({}).marksBySession.size, 0, "an empty workspace");
});

test("a date is formatted once per date and language", () => {
  let calls = 0;
  const format = rememberDates((iso, locale) => {
    calls += 1;
    return locale + ":" + iso;
  });
  assert.equal(format("2026-11-04", "ar"), "ar:2026-11-04");
  assert.equal(format("2026-11-04", "ar"), "ar:2026-11-04");
  assert.equal(format("2026-11-04", "en"), "en:2026-11-04");
  assert.equal(calls, 2);
});

test("the page under a form follows every state except the form's own", () => {
  const source = fs.readFileSync("app/operations.tsx", "utf8").replace(/\r\n/g, "\n");
  const body = source.slice(source.indexOf("export default function Operations("));
  const declared = [...body.matchAll(/\[(\w+), set\w+\] = useState/g)].map((m) => m[1]);
  assert.ok(declared.length > 40, "the states were found");
  const list = body.match(/\}, \[locale, ([^\]]+)\]\);/);
  assert.ok(list, "the page's list of states was found");
  const listed = new Set(list[1].split(",").map((v) => v.trim()));
  const formOnly = new Set(["form", "formError", "modal"]);
  for (const name of declared)
    // The search box's text is followed through its deferred copy (12 Nov 2026): the
    // lists catch up a moment after each letter instead of redrawing on every one.
    if (!formOnly.has(name)) assert.ok(listed.has(name) || (name === "search" && listed.has("searchQuery")), `add ${name} to the page's list in app/operations.tsx, or the page will not redraw when it changes`);
  for (const name of formOnly) assert.ok(!listed.has(name), `${name} stays off the list, so typing does not redraw the page`);
  // Nothing in the page reads the form, or it would go stale while someone types.
  const page = body.slice(body.indexOf("const content: any = useMemo("), body.indexOf("}, [locale, "));
  assert.doesNotMatch(page, /[^.\w]form(\.|\[)|[^.\w]formError\b|[^.\w]modal(\?|\.|!)/, "the page must not read form, formError or modal");
});
