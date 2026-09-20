#!/usr/bin/env node
// Creates a Supabase Auth account for every student in the operational
// database, using the roster email as the username.
//
//   node --experimental-strip-types scripts/provision-student-logins.mjs \
//     --credentials ../.secrets/supabase-depi.json            # dry run
//   ... --apply                                               # create accounts
//   ... --apply --reset-existing                              # also reset passwords
//
// Password modes:
//   --password student-id   the student's business ID, as printed on the roster
//   --password random       a long random secret nobody is told (default); each
//                           student then activates through password recovery
//
// WARNING about `student-id`. The ID is not a secret: it appears in the roster
// workbook, in exports and on screens that staff can see. Anyone holding the
// roster can sign in as any student until that student changes their password.
// Use it only as a first-login credential for a supervised rollout, tell
// students to change it immediately, and never for staff accounts.
//
// The script never prints an email address or a password. It reports counts and
// writes a PII-free summary with --report.
import fs from "node:fs";
import { adminConnection, parseArgs, resolveDatabaseUrl, resolveSupabaseApi } from "./supabase-env.mjs";

const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const resetExisting = Boolean(args["reset-existing"]);
const mode = String(args.password || "random");
if (!["student-id", "random"].includes(mode)) {
  console.error('--password must be "student-id" or "random".');
  process.exit(1);
}

const api = resolveSupabaseApi(args);
if (!api.url || !api.serviceRoleKey) {
  console.error("Supabase URL and service-role key are required (--credentials or the environment).");
  process.exit(1);
}
const authBase = api.url.replace(/\/$/, "") + "/auth/v1/admin";
const headers = {
  Authorization: "Bearer " + api.serviceRoleKey,
  apikey: api.serviceRoleKey,
  "Content-Type": "application/json",
};

async function callAuth(path, { method = "GET", body } = {}) {
  const response = await fetch(authBase + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`auth ${method} ${path.split("?")[0]} -> ${response.status}`);
    error.status = response.status;
    error.detail = text.slice(0, 300);
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

function randomPassword() {
  return "Depi-" + Buffer.from(crypto.getRandomValues(new Uint8Array(27))).toString("base64url");
}

/** Every existing Auth identity, lowercased, mapped to its id. */
async function existingIdentities() {
  const found = new Map();
  for (let page = 1; ; page++) {
    const result = await callAuth(`/users?page=${page}&per_page=1000`);
    const users = result?.users ?? [];
    for (const user of users) if (user.email) found.set(String(user.email).trim().toLowerCase(), user.id);
    if (users.length < 1000) break;
  }
  return found;
}

const sql = adminConnection(resolveDatabaseUrl(args, "session"));
let report;
try {
  const students = await sql.unsafe(
    `select id, lower(btrim(email)) as email, name, lifecycle
       from students
      where email is not null and btrim(email) <> ''
      order by id`,
  );
  const active = students.filter(
    (s) => !["Removed", "Withdrawn", "Graduate Closed", "Non-Graduate Closed"].includes(s.lifecycle),
  );
  const skippedClosed = students.length - active.length;
  const tooShort = active.filter((s) => mode === "student-id" && String(s.id).length < 6);
  const existing = await existingIdentities();
  const toCreate = active.filter((s) => !existing.has(s.email));
  const alreadyThere = active.length - toCreate.length;

  report = {
    generated_at: new Date().toISOString(),
    password_mode: mode,
    students_with_email: students.length,
    skipped_closed_lifecycle: skippedClosed,
    eligible: active.length,
    already_have_an_account: alreadyThere,
    to_create: toCreate.length,
    rejected_short_id: tooShort.length,
    applied: apply,
  };

  console.log(`students with an email      ${students.length}`);
  console.log(`closed lifecycle, skipped   ${skippedClosed}`);
  console.log(`already have an account     ${alreadyThere}`);
  console.log(`accounts to create          ${toCreate.length}`);
  if (tooShort.length) console.log(`IDs too short for a password ${tooShort.length} (these would be skipped)`);
  if (mode === "student-id") {
    console.log("");
    console.log("NOTE: the student ID is printed on the roster, so it is a first-login");
    console.log("credential, not a secret. Students should change it immediately.");
  }

  if (!apply) {
    console.log("");
    console.log("Dry run. Nothing was created. Re-run with --apply to create the accounts.");
  } else {
    const password = (student) => (mode === "student-id" ? String(student.id) : randomPassword());
    const outcome = { created: 0, existing: 0, reset: 0, skipped: tooShort.length, failed: 0 };
    const failures = [];
    const queue = [...toCreate];
    if (resetExisting) {
      for (const student of active) {
        if (!existing.has(student.email) || String(student.id).length < 6) continue;
        try {
          await callAuth(`/users/${existing.get(student.email)}`, {
            method: "PUT",
            body: { password: password(student), email_confirm: true },
          });
          outcome.reset++;
        } catch (error) {
          outcome.failed++;
          failures.push({ student_id: student.id, status: error.status ?? 0 });
        }
      }
    }
    const workers = Math.max(1, Math.min(Number(args.workers || 8), 12));
    let index = 0;
    async function worker() {
      while (index < queue.length) {
        const student = queue[index++];
        if (String(student.id).length < 6) continue;
        try {
          await callAuth("/users", {
            method: "POST",
            body: {
              email: student.email,
              password: password(student),
              email_confirm: true,
              user_metadata: { full_name: student.name, account_source: "DEPI Round 5 roster" },
            },
          });
          outcome.created++;
        } catch (error) {
          if (error.status === 422) outcome.existing++;
          else {
            outcome.failed++;
            if (failures.length < 25) failures.push({ student_id: student.id, status: error.status ?? 0 });
          }
        }
        const done = outcome.created + outcome.existing + outcome.failed;
        if (done % 250 === 0) console.log(`processed ${done}/${queue.length}`);
      }
    }
    await Promise.all(Array.from({ length: workers }, worker));
    Object.assign(report, { outcome, failures });
    console.log(JSON.stringify(outcome, null, 2));
    if (failures.length) console.log("first failures:", JSON.stringify(failures.slice(0, 5)));
  }
} finally {
  await sql.end({ timeout: 5 });
}

if (args.report) {
  fs.writeFileSync(String(args.report), JSON.stringify(report, null, 2));
  console.log("report written to " + args.report);
}
