import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});
after(async () => {
  await vite.close();
});

const { weekStart, WeeklyProgress } = await vite.ssrLoadModule("/app/weekly-progress.tsx");
const { LocaleProvider } = await vite.ssrLoadModule("/lib/i18n/context.tsx");

test("the programme week opens on Friday and closes on Thursday", () => {
  assert.equal(weekStart("2026-10-16"), "2026-10-16", "a Friday opens its own week");
  assert.equal(weekStart("2026-10-22"), "2026-10-16", "the Thursday after still belongs to it");
  assert.equal(weekStart("2026-10-23"), "2026-10-23", "the next Friday starts a new week");
  assert.equal(weekStart("2026-10-18"), "2026-10-16", "a Sunday belongs to the week that began on Friday");
});

/** A small workspace in the current week, so the default view shows it. */
function workspace(roles) {
  const cairo = (offsetDays) => {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(d);
  };
  const today = cairo(0);
  const start = weekStart(today);
  const inWeek = start + "T10:00:00Z";
  const lastWeek = new Date(Date.parse(start + "T10:00:00Z") - 3 * 86400000).toISOString();
  return {
    user: { id: "sup-a", roles },
    staff: [
      { id: "coord-1", name: "Aya Coordinator", title: "Project Coordinator", roles: '["Operations Coordinator"]' },
      { id: "coord-2", name: "Bassem Coordinator", title: "Operations Coordinator", roles: '["Operations Coordinator"]' },
      { id: "sup-a", name: "Supervisor A", roles: '["Team Supervisor"]' },
      { id: "sup-b", name: "Supervisor B", roles: '["Team Supervisor"]' },
    ],
    groups: [
      { id: "G1", status: "Active", coordinator: "coord-1", supervisor: "sup-a" },
      { id: "G2", status: "Active", coordinator: "coord-2", supervisor: "sup-b" },
    ],
    students: [
      { id: "S1", name: "Student One", group_id: "G1", lifecycle: "Active", risk: { status: "On Track" } },
      { id: "S2", name: "Student Two", group_id: "G1", lifecycle: "Active", risk: { status: "Critical" } },
      { id: "S3", name: "Student Three", group_id: "G1", lifecycle: "Withdrawn", risk: { status: "On Track" } },
      { id: "S4", name: "Student Four", group_id: "G2", lifecycle: "Active", risk: { status: "On Track" } },
    ],
    sessions: [{ id: "SES1", group_id: "G1", session_day: start, status: "Completed" }],
    attendance: [{ session_id: "SES1", student_id: "S1", status: "Present" }],
    // S1 contacted this week; S2 only last week, so not counted.
    contacts: [
      { student_id: "S1", occurred_at: inWeek },
      { student_id: "S2", occurred_at: lastWeek },
    ],
    serviceLinks: [{ student_id: "S1", submitted_at: inWeek, qc_status: "Locked", qc_at: inWeek }],
    evidence: [],
    tasks: [{ owner: "coord-1", status: "Open", due: "2000-01-01T00:00:00Z" }],
  };
}

const render = (data, locale = "en") =>
  renderToStaticMarkup(
    React.createElement(LocaleProvider, { locale }, React.createElement(WeeklyProgress, { data, onStudent: () => {} })),
  );

test("a leader sees every coordinator with this week's figures", () => {
  const html = render(workspace(["Project Operations"]));
  assert.match(html, /Aya Coordinator/);
  assert.match(html, /Bassem Coordinator/);
  assert.match(html, /Project Coordinator/, "the coordinator's title is shown");
  // 3 active students across both groups, 1 contacted this week.
  assert.match(html, /1 \/ 3/);
  assert.match(html, /All supervisors/, "leaders can narrow the view by supervisor");
});

test("a supervisor's view is the groups they were given and nothing else", () => {
  // The server already sends a supervisor only their own groups; this is that payload.
  const data = workspace(["Team Supervisor"]);
  data.groups = data.groups.filter((g) => g.supervisor === "sup-a");
  data.students = data.students.filter((s) => s.group_id === "G1");
  const html = render(data);
  assert.match(html, /Aya Coordinator/);
  assert.doesNotMatch(html, /Bassem Coordinator/);
  assert.doesNotMatch(html, /All supervisors/, "a supervisor has no one else's groups to pick");
  // Withdrawn students are not counted: 2 active, 1 contacted.
  assert.match(html, /1 \/ 2/);
});

test("the weekly view reads in Arabic", () => {
  const html = render(workspace(["Project Operations"]), "ar");
  assert.match(html, /هذا الأسبوع/);
  assert.match(html, /المنسقون هذا الأسبوع/);
  assert.match(html, /منسق مشروع/);
});
