import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { csvCell, ensure } from "./domain/rules.ts";

/**
 * Spreadsheet round trip for the workspace.
 *
 * Export writes real Excel workbooks: one tab per dataset, a bold frozen
 * header row, column widths that fit the content and numbers stored as
 * numbers, so the files open cleanly in Excel and Google Sheets and can be
 * edited and uploaded again. Import reads the first worksheet, or the tab
 * whose name matches the module when a whole workbook comes back, so a
 * downloaded workbook can be edited in place and re-imported tab by tab.
 *
 * Only the parts of OOXML that matter for tabular data are produced or read.
 */

export type Sheet = { name: string; rows: any[]; columns?: string[] };

export function toCSV(rows: any[]) {
  const keys = Object.keys(rows[0] || { id: "" });
  return [
    keys.map(csvCell).join(","),
    ...rows.map((r) => keys.map((k) => csvCell(typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])).join(",")),
  ].join("\r\n");
}

const xml = (v: any) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function col(n: number) {
  let s = "";
  for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ and unique. */
function sheetName(name: string, taken: Set<string>) {
  const base = name.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let candidate = base;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = base.slice(0, 31 - String(i).length - 1) + " " + i;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function cellValue(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function worksheetXml(rows: any[], columns?: string[]) {
  const keys = columns || Object.keys(rows[0] || { id: "" });
  const data = [keys, ...rows.map((r) => keys.map((k) => cellValue(r[k])))];
  const widths = keys.map((k, j) =>
    Math.min(60, Math.max(10, ...data.slice(0, 500).map((row) => String(row[j] ?? "").length + 2))),
  );
  const cell = (v: any, ref: string, header: boolean) => {
    const style = header ? ' s="1"' : "";
    if (v === "" || v === null || v === undefined) return "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    if (typeof v === "boolean") return `<c r="${ref}" t="b"${style}><v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  return (
    '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${col(Math.max(keys.length - 1, 0))}${data.length}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    "<cols>" +
    widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join("") +
    "</cols><sheetData>" +
    data
      .map(
        (row, i) =>
          `<row r="${i + 1}">` + row.map((v, j) => cell(v, `${col(j)}${i + 1}`, i === 0)).join("") + "</row>",
      )
      .join("") +
    "</sheetData></worksheet>"
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** A workbook with one worksheet per dataset. */
export function toWorkbook(sheets: Sheet[]) {
  ensure(sheets.length > 0, "Nothing to export.");
  const taken = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, taken) }));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        named
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        "</Types>",
    ),
    "_rels/.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        named.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        "</sheets></workbook>",
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        named
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        "</Relationships>",
    ),
    "xl/styles.xml": strToU8(STYLES),
  };
  named.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(worksheetXml(s.rows, s.columns));
  });
  return zipSync(files);
}

export function toXLSX(rows: any[], name = "Operations") {
  return toWorkbook([{ name, rows }]);
}

export function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (c === "," && !quote) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quote) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  ensure(!quote, "CSV contains an unclosed quoted field.");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return objects(rows);
}

function objects(rows: string[][]) {
  ensure(rows.length > 0, "The spreadsheet is empty.");
  const seen = new Map<string, number>();
  // Sheets from other teams repeat header names; the second "name" becomes
  // "name (2)" so the row keeps every value and the import can report it.
  const keys = rows.shift()!.map((k) => {
    const key = (k || "").trim().replace(/^﻿/, "");
    if (!key) return key;
    const n = (seen.get(key.toLowerCase()) || 0) + 1;
    seen.set(key.toLowerCase(), n);
    return n === 1 ? key : `${key} (${n})`;
  });
  ensure(keys.some(Boolean), "The first row must hold the column names.");
  return rows
    .filter((r) => r.some((v) => v !== undefined && v !== ""))
    .map((r) => Object.fromEntries(keys.map((k, j) => [k, r[j] || ""]).filter(([k]) => k)));
}

/** "Task Bank", "task_bank" and "task-bank" name the same module. */
const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Reads a CSV or XLSX file into row objects keyed by the header row. With a
 * preferred sheet name, a workbook's matching tab is read; otherwise the
 * first tab is.
 */
export async function readSheet(file: File, preferredSheet?: string) {
  ensure(file.size <= 25 * 1024 * 1024, "Import files must be smaller than 25 MB.");
  if (file.name.toLowerCase().endsWith(".csv")) return parseCSV(await file.text());
  ensure(file.name.toLowerCase().endsWith(".xlsx"), "Choose an XLSX or CSV file.");
  const parts = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) =>
      f.originalSize < 96 * 1024 * 1024 &&
      /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name),
  });
  const parser = new DOMParser();
  const read = (name: string) => parser.parseFromString(strFromU8(parts[name]), "text/xml");
  ensure(parts["xl/workbook.xml"], "This file is not an Excel workbook.");
  const relationships = parts["xl/_rels/workbook.xml.rels"]
    ? new Map(
        Array.from(read("xl/_rels/workbook.xml.rels").getElementsByTagName("Relationship")).map((r) => [
          r.getAttribute("Id") || "",
          (r.getAttribute("Target") || "").replace(/^\/?(xl\/)?/, ""),
        ]),
      )
    : new Map<string, string>();
  const sheets = Array.from(read("xl/workbook.xml").getElementsByTagName("sheet")).map((s) => ({
    name: s.getAttribute("name") || "",
    path: "xl/" + (relationships.get(s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || "") || "worksheets/sheet1.xml"),
  }));
  ensure(sheets.length > 0, "The workbook has no worksheets.");
  const wanted = preferredSheet ? normalizeName(preferredSheet) : "";
  const chosen = (wanted && sheets.find((s) => normalizeName(s.name) === wanted)) || sheets[0];
  ensure(parts[chosen.path], `Worksheet "${chosen.name}" could not be read.`);
  const strings = parts["xl/sharedStrings.xml"]
    ? Array.from(read("xl/sharedStrings.xml").getElementsByTagName("si")).map((s) => s.textContent || "")
    : [];
  const doc = read(chosen.path);
  const rows = Array.from(doc.getElementsByTagName("row")).map((row) => {
    const out: string[] = [];
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      ensure(
        !c.getElementsByTagName("f").length,
        "Import values only; replace spreadsheet formulas with their values first.",
      );
      const ref = c.getAttribute("r") || "A1";
      let n = 0;
      for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + ch.charCodeAt(0) - 64;
      const v = c.getElementsByTagName("v")[0]?.textContent || "";
      const type = c.getAttribute("t");
      out[n - 1] =
        type === "s"
          ? strings[Number(v)]
          : type === "inlineStr"
            ? c.textContent || ""
            : type === "b"
              ? v === "1"
                ? "TRUE"
                : "FALSE"
              : v;
    }
    return out;
  });
  return objects(rows);
}
