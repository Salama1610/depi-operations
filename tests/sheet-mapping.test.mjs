// Linking an uploaded sheet to people already in the workspace.
//
// The sheets come from the ministry, the providers and the coaches, so the
// identifier arrives damaged in the ways spreadsheets damage long numbers, and
// the headings are written in whatever language and wording the source used.
// These tests pin the recovery rules and the heading guesses, because a wrong
// guess silently writes one student's data onto another.
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMapping,
  guessField,
  guessKeyColumn,
  guessMapping,
  isNationalId,
  nationalIdProblem,
  normalizeDigits,
  normalizeHeader,
  normalizeNationalId,
} from "../lib/domain/sheet-mapping.ts";

const arabic = (digits) => digits.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
const eastern = (digits) => digits.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
const ID = "29911260104731";

test("a national ID survives every way a spreadsheet mangles it", () => {
  assert.equal(normalizeNationalId(ID), ID);
  assert.equal(normalizeNationalId("  " + ID + " "), ID);
  assert.equal(normalizeNationalId("'" + ID), ID, "the apostrophe Excel adds to keep text");
  assert.equal(normalizeNationalId("299-1126-010-4731"), ID);
  assert.equal(normalizeNationalId("299 1126 010 4731"), ID);
  assert.equal(normalizeNationalId(arabic(ID)), ID, "Arabic-Indic digits");
  assert.equal(normalizeNationalId(eastern(ID)), ID, "Eastern Arabic digits");
  assert.equal(normalizeNationalId("2.9911260104731E+13"), ID, "Excel's scientific notation");
  assert.equal(normalizeNationalId("2,9911260104731e13"), ID, "with a comma decimal mark");
  assert.equal(normalizeNationalId(29911260104731), ID, "a number rather than text");
  for (const value of [null, undefined, "", "   ", "not an id", "N/A"]) assert.equal(normalizeNationalId(value), "");
});

test("only a real national ID is accepted as a key", () => {
  assert.ok(isNationalId(ID));
  assert.ok(isNationalId("3" + ID.slice(1)), "a 2000s birth year");
  assert.ok(!isNationalId("1" + ID.slice(1)), "a first digit that is not a century");
  assert.ok(!isNationalId(ID.slice(1)), "thirteen digits");
  assert.ok(!isNationalId(ID + "0"), "fifteen digits");
  assert.equal(nationalIdProblem(ID), null);
  assert.match(nationalIdProblem("123"), /14 digits; this cell has 3/);
  assert.match(nationalIdProblem("nope"), /does not hold a number/);
  assert.match(nationalIdProblem("1" + ID.slice(1)), /starts with 2 or 3/);
});

test("headings are compared without case, punctuation or Arabic spelling variants", () => {
  assert.equal(normalizeHeader("National ID"), normalizeHeader("national_id"));
  assert.equal(normalizeHeader("  E-Mail  "), normalizeHeader("email"));
  assert.equal(normalizeHeader("الرقم القومي"), normalizeHeader("الرقم القومى"), "yeh written either way");
  assert.equal(normalizeHeader("إسم"), normalizeHeader("اسم"), "alef written either way");
  assert.equal(normalizeDigits(arabic("2024")), "2024");
});

test("a heading is matched to the field it fills, in English or Arabic", () => {
  assert.equal(guessField("National ID"), "national_id");
  assert.equal(guessField("الرقم القومي"), "national_id");
  assert.equal(guessField("Student ID"), "national_id", "the programme calls the national ID the student ID");
  assert.equal(guessField("id"), "id", "the workspace reference is its own field");
  assert.equal(guessField("Mobile No."), "phone");
  assert.equal(guessField("رقم الموبايل"), "phone");
  assert.equal(guessField("Student Name"), "name");
  assert.equal(guessField("Anything Else"), null);
  assert.equal(guessField("National ID", ["name", "email"]), null, "a field the sheet may not fill is not proposed");
});

test("a whole sheet is proposed once, never mapping two columns to one field", () => {
  const allowed = ["national_id", "name", "email", "phone", "job_profile"];
  const mapping = guessMapping(
    ["الرقم القومي", "Student Name", "Mobile", "Phone Number", "Notes"],
    allowed,
  );
  assert.deepEqual(mapping, {
    "الرقم القومي": "national_id",
    "Student Name": "name",
    Mobile: "phone",
  });
  assert.ok(!("Phone Number" in mapping), "the first matching column keeps the field");
  assert.ok(!("Notes" in mapping), "an unrecognised heading is left for the person to map");
});

test("the key column is found from the mapping, or from the values themselves", () => {
  const rows = [{ A: ID, B: "Ali" }, { A: "3" + ID.slice(1), B: "Sara" }];
  assert.equal(guessKeyColumn(["A", "B"], rows, { A: "national_id" }), "A");
  assert.equal(guessKeyColumn(["A", "B"], rows, {}), "A", "a column full of national IDs is the key");
  assert.equal(guessKeyColumn(["B"], [{ B: "Ali" }, { B: "Sara" }], {}), null, "nothing that looks like a key");
});

test("applying a mapping keeps only mapped columns and cleans the key", () => {
  const rows = [
    { "الرقم القومي": "2.9911260104731E+13", Name: "  Ali  ", Notes: "ignore me" },
    { "الرقم القومي": arabic(ID), Name: "", Notes: "" },
  ];
  const mapped = applyMapping(rows, { "الرقم القومي": "national_id", Name: "name", Notes: "" });
  assert.deepEqual(mapped, [
    { national_id: ID, name: "Ali" },
    { national_id: ID, name: "" },
  ]);
});
