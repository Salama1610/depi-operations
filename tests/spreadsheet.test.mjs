// The Excel writer produces workbooks that Excel and Google Sheets open and
// that the import reader gets back unchanged: one tab per dataset, a bold
// frozen header, numbers stored as numbers, and sheet names that follow the
// Excel rules (31 characters, no []:*?/\, unique). These tests unzip the
// output and check the XML parts directly, since the reader needs a browser
// DOMParser and is exercised in the UI.
import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { toWorkbook, toXLSX, parseCSV, toCSV } from "../lib/spreadsheet.ts";
import { accountReviewRows, reviewColumns, reviewDropdowns, reviewHowTo, reviewInputColumns, reviewOrderWord } from "../lib/domain/account-review.ts";

const parts = (bytes) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));

test("a workbook holds one worksheet per dataset with frozen bold headers", () => {
  const files = parts(
    toWorkbook([
      { name: "students", rows: [{ id: "S1", name: "Ali <b>", score: 12.5, active: true, meta: { a: 1 } }] },
      { name: "task_bank", rows: [] },
    ]),
  );
  assert.match(files["xl/workbook.xml"], /<sheet name="students" sheetId="1" r:id="rId1"\/>/);
  assert.match(files["xl/workbook.xml"], /<sheet name="task_bank" sheetId="2" r:id="rId2"\/>/);
  assert.match(files["xl/_rels/workbook.xml.rels"], /Target="styles.xml"/);
  assert.match(files["[Content_Types].xml"], /worksheets\/sheet2\.xml/);
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">id<\/t><\/is><\/c>/, "header cells use the bold style");
  assert.match(sheet, /<c r="B2" t="inlineStr"><is><t xml:space="preserve">Ali &lt;b&gt;<\/t><\/is><\/c>/, "text is escaped");
  assert.match(sheet, /<c r="C2"><v>12.5<\/v><\/c>/, "numbers are numeric cells");
  assert.match(sheet, /<c r="D2" t="b"><v>1<\/v><\/c>/, "booleans are boolean cells");
  assert.match(sheet, /<t xml:space="preserve">\{&quot;a&quot;:1\}<\/t>/, "objects are serialized");
  assert.match(sheet, /<cols><col min="1" max="1" width="\d+" customWidth="1"\/>/);
  assert.match(files["xl/worksheets/sheet2.xml"], /<row r="1"><c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">id<\/t>/, "an empty dataset still gets a header");
  assert.match(files["xl/styles.xml"], /<cellXfs count="4">/);
});

test("sheet names follow the Excel rules and stay unique", () => {
  const files = parts(
    toWorkbook([
      { name: "a/very:long*name?with[illegal]characters and more", rows: [] },
      { name: "dup", rows: [] },
      { name: "DUP", rows: [] },
    ]),
  );
  const names = [...files["xl/workbook.xml"].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(names[0].length <= 31, true);
  assert.doesNotMatch(names[0], /[[\]:*?/\\]/);
  assert.deepEqual(names.slice(1), ["dup", "DUP 2"]);
});

test("toXLSX names its single tab after the dataset", () => {
  const files = parts(toXLSX([{ id: "G1" }], "groups"));
  assert.match(files["xl/workbook.xml"], /<sheet name="groups"/);
});

test("CSV round trip keeps quoted commas, quotes and blank rows out", () => {
  const rows = [{ id: "S1", note: 'a, "quoted" value' }, { id: "S2", note: "" }];
  const back = parseCSV(toCSV(rows) + "\r\n,,\r\n");
  assert.deepEqual(back, rows);
});

test("a sheet can carry drop-down columns, shaded input columns and filter buttons", () => {
  const files = parts(
    toWorkbook([
      {
        name: "Review",
        rows: [{ Account: "a@example.org", Decision: "", Note: "" }, { Account: "b@example.org", Decision: "", Note: "" }],
        columns: ["Account", "Decision", "Note"],
        dropdowns: [{ column: "Decision", options: ["Buys this service", "Cancel"], prompt: "Pick one" }],
        inputColumns: ["Decision", "Note"],
        filter: true,
      },
    ]),
  );
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<autoFilter ref="A1:C3"\/>/);
  assert.match(sheet, /<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="stop"/);
  assert.match(sheet, /sqref="B2:B3"><formula1>"Buys this service,Cancel"<\/formula1>/, "the list is on the Decision column, below its header");
  assert.match(sheet, /error="Pick one of: Buys this service, Cancel"/, "anything else is refused, with the reason");
  assert.match(sheet, /<col min="2" max="2" width="\d+" customWidth="1" style="2"\/>/, "an input column is shaded down its length");
  assert.doesNotMatch(sheet, /<col min="1" max="1"[^>]*style=/, "the other columns are plain");
  assert.match(sheet, /<c r="B1" t="inlineStr" s="3">/, "an input column's header is bold and shaded");
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1">/);
  // Dropdowns come after the data and nothing else changes for an ordinary sheet.
  assert.ok(sheet.indexOf("</sheetData>") < sheet.indexOf("<autoFilter") && sheet.indexOf("<autoFilter") < sheet.indexOf("<dataValidations"));
  assert.doesNotMatch(parts(toWorkbook([{ name: "plain", rows: [{ a: 1 }] }]))["xl/worksheets/sheet1.xml"], /dataValidation|autoFilter|style="/);
  // A list that Excel could not read is refused rather than written.
  assert.throws(() => toWorkbook([{ name: "x", rows: [{ a: "" }], dropdowns: [{ column: "a", options: ["one, two"] }] }]), /comma/);
  assert.throws(() => toWorkbook([{ name: "x", rows: [{ a: "" }], dropdowns: [{ column: "missing", options: ["one"] }] }]), /column of the sheet/);
});

test("the account review sheet has one row per account and student, the reviewers' columns blank, and no password or contact", () => {
  const rows = accountReviewRows(
    [
      {
        label: "kafiil-two@example.org", platform: "Kafiil", status: "Assigned", credits: "12.5", password: "never-in-the-sheet", owner_name: "Hidden Owner",
        student_name: "Zed Student", student_id: "S2", student_group: "ALX5_DRT1_S1", student_coordinator_name: "Coordinator B", supervisor: "sup-1",
        service_url: "https://kafiil.com/service/2", service_platform: "Kafiil", service_slot: 2, phone: "01000000000", email: "zed@example.org",
        state: "Proof Uploaded", latest: { amount: "5", bought_on: "Kafiil", updated_at: "2026-11-10T09:00:00Z" },
      },
      {
        label: "nafezly-one@example.org", platform: "Nafezly", status: "Locked", credits: 0,
        student_name: "Amr Student", student_id: "S1", student_group: "ALX5_DRT1_S1", coordinator_id: "coord-a", supervisor: "sup-1",
        state: "No order yet", latest: null,
      },
    ],
    { owner: (id) => ({ "sup-1": "Abdullah Waheed", "coord-a": "Coordinator A" })[id] || id, provider: (g) => (g === "ALX5_DRT1_S1" ? "YAT" : "") },
  );
  assert.deepEqual(Object.keys(rows[0]), Object.values(reviewColumns), "the columns are the declared ones, in order");
  assert.deepEqual(rows.map((r) => r.Student), ["Amr Student", "Zed Student"], "ordered by coordinator, then student");
  const [amr, zed] = rows;
  assert.deepEqual([amr["Order status"], amr["Price paid"], amr.Coordinator, amr.Supervisor, amr["Training provider"]], ["No order yet", "", "Coordinator A", "Abdullah Waheed", "YAT"]);
  assert.deepEqual([zed["Order status"], zed["Price paid"], zed["Credit left"], zed["Bought on"], zed["Order last updated"], zed["Service no."]], ["POH uploaded", 5, 12.5, "Kafiil", "2026-11-10", 2]);
  for (const r of rows) for (const k of reviewInputColumns) assert.equal(r[k], "", k + " is left for the reviewers");
  const everything = JSON.stringify(rows);
  for (const secret of ["never-in-the-sheet", "Hidden Owner", "01000000000", "zed@example.org"]) assert.ok(!everything.includes(secret), secret + " stays out");
  // The decision columns offer exactly the two answers, and are the ones that are shaded.
  assert.deepEqual(reviewDropdowns.map((d) => d.column), ["Project Operations: decision", "Abdullah Waheed: decision"]);
  for (const d of reviewDropdowns) assert.deepEqual(d.options, ["Buys this service", "Cancel"]);
  assert.deepEqual(reviewInputColumns, ["Project Operations: decision", "Abdullah Waheed: decision", "Column or data to remove", "Notes"]);
  assert.equal(reviewOrderWord("Cancelled"), "Canceled");
  assert.ok(reviewHowTo.length >= 4);
  // The whole workbook builds, with the instructions as a second tab.
  const files = parts(
    toWorkbook([
      { name: "Account review", rows, columns: Object.values(reviewColumns), dropdowns: reviewDropdowns, inputColumns: reviewInputColumns, filter: true },
      { name: "How to fill in", rows: reviewHowTo },
    ]),
  );
  assert.match(files["xl/workbook.xml"], /<sheet name="Account review" sheetId="1"/);
  assert.match(files["xl/worksheets/sheet1.xml"], /sqref="R2:R3"><formula1>"Buys this service,Cancel"<\/formula1>/, "Project Operations' column");
  assert.match(files["xl/worksheets/sheet1.xml"], /sqref="S2:S3"><formula1>"Buys this service,Cancel"<\/formula1>/, "Abdullah Waheed's column");
});
