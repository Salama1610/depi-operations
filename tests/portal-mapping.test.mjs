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
