// The column mapping a portal upload starts from.
import test from "node:test";
import assert from "node:assert/strict";
import { portalMappingFor } from "../lib/domain/portal-sheets.ts";

test("a saved mapping that lacks a column still picks that column up by its name", () => {
  const saved = { ID: "portal_id", Status: "status", "Old Column": "email" };
  const headers = ["ID", "Email", "Full Name", "Status", "Final Status", "Graduate Type"];
  assert.deepEqual(portalMappingFor("students", headers, saved), {
    ID: "portal_id",
    Status: "status",
    Email: "email",
    "Full Name": "full_name",
    "Final Status": "final_status",
    "Graduate Type": "graduate_type",
  });
});

test("a saved choice wins over a guess, and a field is never mapped twice", () => {
  const saved = { ID: "portal_gig_id", "Student ID": "portal_student_id", "Coach Decision": "trainer_status" };
  const m = portalMappingFor("gigs", ["ID", "Student ID", "Coach Decision", "Trainer Status", "Status"], saved);
  assert.equal(m["Coach Decision"], "trainer_status");
  assert.equal(m["Trainer Status"], undefined);
  assert.equal(m.Status, "status");
});

test("with nothing saved it is the plain guess", () => {
  assert.deepEqual(portalMappingFor("gigs", ["ID", "Student ID", "Trainer Status"], null), { ID: "portal_gig_id", "Student ID": "portal_student_id", "Trainer Status": "trainer_status" });
});

test("a phone or email two of our students share links neither of them, and a phone in a free-text cell links nobody", async () => {
  const { claimKey, linkStudent } = await import("../lib/domain/portal-sheets.ts");
  const byEmail = new Map(), byPhone = new Map(), byNationalId = new Map();
  claimKey(byPhone, "01000000001", "S1");
  claimKey(byPhone, "01000000001", "S2");
  claimKey(byPhone, "01000000002", "S3");
  claimKey(byEmail, "one@example.org", "S1");
  claimKey(byEmail, "one@example.org", "S1");
  assert.equal(linkStudent({ phone: "01000000001" }, byEmail, byPhone, byNationalId), null, "a family phone names nobody");
  assert.equal(linkStudent({ phone: "01000000002" }, byEmail, byPhone, byNationalId), "S3");
  assert.equal(linkStudent({ email: "one@example.org" }, byEmail, byPhone, byNationalId), "S1", "the same student twice is still one");
  assert.equal(linkStudent({}, byEmail, byPhone, byNationalId, { cells: ["call 01000000002 after 5"] }), null, "not a phone in a note");
  assert.equal(linkStudent({}, byEmail, byPhone, byNationalId, { cells: ["mail one@example.org"] }), "S1", "an email in a note still counts");
});

test("a written day/month/year date is read as Egypt writes it, in Cairo time", async () => {
  const { sheetDate } = await import("../lib/domain/portal-sheets.ts");
  assert.equal(sheetDate("03/11/2026"), "2026-11-02T22:00:00.000Z", "3 November, not 11 March");
  assert.equal(sheetDate("13/11/2026"), "2026-11-12T22:00:00.000Z", "a day over 12 is not refused");
  assert.equal(sheetDate("13/11/2026 2:30 PM"), "2026-11-13T12:30:00.000Z");
  assert.equal(sheetDate("31/13/2026"), null);
  assert.equal(sheetDate("2026-11-03T10:00:00Z"), "2026-11-03T10:00:00.000Z", "ISO dates as before");
});
