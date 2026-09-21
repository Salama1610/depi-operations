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
  assert.match(files["xl/styles.xml"], /<cellXfs count="2">/);
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
