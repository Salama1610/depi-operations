#!/usr/bin/env node
// Publishes operational data from the database into a Google Sheet, one tab
// per dataset.
//
// Direction is deliberately one way. The workspace stays the system of record:
// it is where the rules, the constraints and the audit trail live. A two-way
// sync would let a pasted cell bypass every one of them, so this tool only
// writes outward, and it replaces a tab's contents rather than merging.
//
//   node --experimental-strip-types scripts/publish-to-google-sheet.mjs \
//     --credentials ../.secrets/supabase-depi.json \
//     --service-account ../.secrets/google-service-account.json \
//     --sheet 1TONsgFiHg01VG9mqnXOWmOICE2Ul8P65gIx1UzkiMsY
//
//   --tabs students,groups,service_links   which datasets to publish
//   --dry-run                              show row counts and write nothing
//   --out <file.xlsx>                      write a local workbook instead, one tab
//                                          per dataset, for when the Google service
//                                          account is not set up yet
//
// Setup, once, in the Google account that owns the sheet:
//   1. Create a project at console.cloud.google.com and enable the Sheets API.
//   2. Create a service account and download its JSON key.
//   3. Share the sheet with the service account's client_email as an Editor.
// Nothing is billed; the Sheets API is free at this volume.
//
// Personal data leaves the database when you publish it, and anyone with
// access to the sheet can read it. Publish the narrow views, not the roster,
// unless you intend exactly that.
import fs from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { adminConnection, parseArgs, resolveDatabaseUrl } from "./supabase-env.mjs";

/** Each tab is one query. Add a row here to publish another view. */
const DATASETS = {
  groups: {
    title: "Groups",
    sql: `select g.id, g.name, g.track, g.provider, g.status, g.delivery_model, g.start_date,
                 c.name as coordinator, s.name as supervisor, h.name as coach, m.name as account_manager,
                 (select count(*) from students st where st.group_id = g.id) as students
            from groups g
            join users c on c.id = g.coordinator
            join users s on s.id = g.supervisor
            join users h on h.id = g.coach
            left join users m on m.id = g.account_manager
           order by g.id`,
  },
  service_status: {
    title: "Service link status",
    sql: `select s.id as student_id, s.name as student, s.group_id, g.track, c.name as coordinator,
                 coalesce(ss.status, 'Not submitted') as submission_status,
                 coalesce(agg.total, 0) as links_submitted,
                 coalesce(agg.locked, 0) as links_locked,
                 coalesce(agg.needs_correction, 0) as needs_correction,
                 ss.submitted_at, ss.qc_completed_at
            from students s
            join groups g on g.id = s.group_id
            join users c on c.id = g.coordinator
            left join service_submissions ss on ss.student_id = s.id
            left join (select student_id, count(*) total,
                              sum(case when qc_status = 'Locked' then 1 else 0 end) locked,
                              sum(case when qc_status = 'Needs Correction' then 1 else 0 end) needs_correction
                         from service_links group by student_id) agg on agg.student_id = s.id
           order by s.group_id, s.id`,
  },
  accounts: {
    title: "Controlled accounts",
    // Credentials are deliberately absent: they never leave the workspace.
    sql: `select a.id, a.platform, a.label, a.status, a.credits,
                 n.student_id, n.group_id, n.created_at as assigned_at
            from accounts a
            left join account_assignments n on n.account_id = a.id
           order by a.platform, a.id`,
  },
  roster_health: {
    title: "Roster health",
    sql: `select g.track, g.provider, count(*) as students,
                 sum(case when s.lifecycle = 'Active' then 1 else 0 end) as active,
                 sum(case when s.lifecycle = 'Paused' then 1 else 0 end) as paused,
                 sum(case when s.lifecycle = 'Withdrawn' then 1 else 0 end) as withdrawn
            from students s join groups g on g.id = s.group_id
           group by g.track, g.provider order by g.track, g.provider`,
  },
};

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args["dry-run"]);
const sheetId = String(args.sheet || process.env.GOOGLE_SHEET_ID || "").trim();
const requested = String(args.tabs || Object.keys(DATASETS).join(",")).split(",").map((t) => t.trim()).filter(Boolean);
for (const name of requested) {
  if (!DATASETS[name]) {
    console.error(`Unknown dataset ${name}. Available: ${Object.keys(DATASETS).join(", ")}`);
    process.exit(1);
  }
}
if (!sheetId) {
  console.error("Pass --sheet <spreadsheet id> (the long id in the sheet's URL).");
  process.exit(1);
}

function serviceAccount() {
  const path = args["service-account"] || process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!path) throw new Error("Pass --service-account <json key file> from the Google Cloud console.");
  const key = JSON.parse(fs.readFileSync(String(path), "utf8"));
  if (!key.client_email || !key.private_key) throw new Error("That file is not a Google service-account key.");
  return key;
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Signs the service-account assertion and exchanges it for an access token. */
async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const der = Buffer.from(
    key.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, ""),
    "base64",
  );
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(`${header}.${claim}`),
  );
  const assertion = `${header}.${claim}.${base64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Google refused the service account: ${response.status} ${body.slice(0, 300)}`);
  return JSON.parse(body).access_token;
}

async function sheets(token, path, { method = "GET", body } = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sheets API ${method} ${path.split("?")[0]} -> ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Google Sheets accepts strings, numbers and booleans; everything else is text. */
function cell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const COLUMN = (index) => {
  let name = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) name = String.fromCharCode(65 + (n % 26)) + name;
  return name;
};
const escapeXml = (value) =>
  String(value).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

/**
 * A workbook with one worksheet per dataset, written with inline strings so no
 * shared-string table is needed. Used by --out, for when the Google service
 * account is not set up yet: the file imports into the same sheet by hand.
 */
function workbook(sheetsByTitle) {
  const titles = Object.keys(sheetsByTitle);
  const overrides = titles
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const files = {
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        overrides +
        "</Types>",
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        titles.map((t, i) => `<sheet name="${escapeXml(t)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        "</sheets></workbook>",
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        titles
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        "</Relationships>",
    ),
  };
  titles.forEach((title, index) => {
    const rows = sheetsByTitle[title];
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const grid = [headers, ...rows.map((row) => headers.map((h) => cell(row[h])))];
    const body = grid
      .map(
        (row, r) =>
          `<row r="${r + 1}">` +
          row
            .map((value, c) =>
              typeof value === "number" && Number.isFinite(value)
                ? `<c r="${COLUMN(c)}${r + 1}"><v>${value}</v></c>`
                : `<c r="${COLUMN(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`,
            )
            .join("") +
          "</row>",
      )
      .join("");
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        body +
        "</sheetData></worksheet>",
    );
  });
  return zipSync(files);
}

const sql = adminConnection(resolveDatabaseUrl(args, "session"));
try {
  const tables = {};
  for (const name of requested) {
    const rows = await sql.unsafe(DATASETS[name].sql);
    tables[name] = rows;
    console.log(`${DATASETS[name].title.padEnd(22)} ${rows.length} rows`);
  }
  if (args.out) {
    const byTitle = Object.fromEntries(requested.map((name) => [DATASETS[name].title, tables[name]]));
    fs.writeFileSync(String(args.out), Buffer.from(workbook(byTitle)));
    console.log(`\nworkbook written to ${args.out}`);
    console.log("In the sheet: File, then Import, then Upload, and replace the spreadsheet.");
  } else if (dryRun) {
    console.log("\nDry run. Nothing was written to the sheet.");
  } else {
    const token = await accessToken(serviceAccount());
    const meta = await sheets(token, "?fields=sheets.properties");
    const existing = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
    const missing = requested.map((n) => DATASETS[n].title).filter((title) => !existing.has(title));
    if (missing.length) {
      await sheets(token, ":batchUpdate", {
        method: "POST",
        body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      });
      console.log(`created tabs: ${missing.join(", ")}`);
    }
    for (const name of requested) {
      const { title } = DATASETS[name];
      const rows = tables[name];
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const values = [headers, ...rows.map((row) => headers.map((h) => cell(row[h])))];
      await sheets(token, `/values/${encodeURIComponent(title)}:clear`, { method: "POST", body: {} });
      await sheets(token, `/values/${encodeURIComponent(title)}!A1?valueInputOption=RAW`, {
        method: "PUT",
        body: { values },
      });
      console.log(`published ${title}: ${rows.length} rows`);
    }
    console.log(`\nhttps://docs.google.com/spreadsheets/d/${sheetId}/edit`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
