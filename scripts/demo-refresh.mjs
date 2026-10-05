// Puts the demo workspace back to its starting state, from a terminal: the
// same plan as the "Reset the demo" button (lib/demo.ts), plus the demo
// sign-ins with the shared demo password.
//
//   node --experimental-strip-types scripts/demo-refresh.mjs --credentials ../.secrets/supabase-depi.json
//
// The credentials file holds supabase_url and the service role key
// (secret_key or service_role_key).
import fs from "node:fs";
import { createRpcCaller, createRpcDatabase } from "../lib/data/rpc.ts";
import { demoPeople, demoPlan, demoStudentEmail, DEMO_PASSWORD } from "../lib/demo.ts";

const at = process.argv.indexOf("--credentials");
if (at < 0) throw new Error("Pass --credentials <file>.");
const credentials = JSON.parse(fs.readFileSync(process.argv[at + 1], "utf8"));
const url = credentials.supabase_url;
const key = credentials.secret_key || credentials.service_role_key;
const columnTypes = JSON.parse(fs.readFileSync(new URL("../supabase/column-types.json", import.meta.url), "utf8"));
const db = createRpcDatabase(createRpcCaller(url, key), { columnTypes });

let kept = 0;
for (const [sql, ...params] of demoPlan(Date.now())) {
  try {
    await db.prepare(sql).bind(...params).run();
  } catch (error) {
    kept++;
    console.warn("kept:", sql.slice(0, 60), "-", error.message.slice(0, 160));
  }
}

async function auth(path, init = {}) {
  const response = await fetch(`${url}/auth/v1/admin/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
}
for (const { email, name } of [...demoPeople, { email: demoStudentEmail, name: "Demo Student" }]) {
  const found = await auth(`users?per_page=20&filter=${encodeURIComponent(email)}`);
  const existing = (found.users || []).find((user) => String(user.email || "").toLowerCase() === email);
  const body = { password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: name, demo: true } };
  if (existing) await auth(`users/${existing.id}`, { method: "PUT", body: JSON.stringify({ ...body, ban_duration: "none" }) });
  else await auth("users", { method: "POST", body: JSON.stringify({ email, ...body }) });
  console.log(existing ? "reset  " : "created", email);
}
console.log(`Demo refreshed. ${kept} statement(s) kept the existing rows.`);
