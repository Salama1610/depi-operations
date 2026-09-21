// Shared helpers for the Supabase operational scripts. Reads connection
// settings from environment variables or from a private credentials JSON file
// (never committed) and returns a postgres.js client factory.
import fs from "node:fs";
import postgres from "postgres";

export function readCredentials(path) {
  if (!path) return {};
  const text = fs.readFileSync(path, "utf8").replace(/^﻿/, "");
  return JSON.parse(text);
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(item);
  }
  return args;
}

/**
 * Resolves the PostgreSQL URL. `mode` is "session" (port 5432, for DDL and
 * long imports) or "transaction" (port 6543, what the deployed runtime uses).
 */
export function resolveDatabaseUrl(args, mode = "session") {
  if (args["db-url"]) return String(args["db-url"]);
  const credentials = readCredentials(args.credentials);
  const fromFile = mode === "session" ? credentials.db_url_session : credentials.db_url_transaction;
  const url = fromFile || process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "No database URL. Pass --db-url, --credentials <private json with db_url_session/db_url_transaction>, or set SUPABASE_DB_URL.",
    );
  }
  return url;
}

export function resolveSupabaseApi(args) {
  const credentials = readCredentials(args.credentials);
  const url = args["supabase-url"] || credentials.supabase_url || process.env.SUPABASE_URL;
  const serviceRoleKey =
    args["service-role-key"] || credentials.service_role_key || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url: url ? String(url).replace(/\/$/, "") : undefined, serviceRoleKey };
}

export function isLocalUrl(url) {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

export function adminConnection(url, options = {}) {
  return postgres(url, {
    max: 1,
    prepare: false,
    // The driver re-serializes parameters with the server-described column
    // types. JSON text and dates must pass through unchanged (the runtime adapter
    // in lib/data/postgres.ts applies the same rule).
    types: {
      json: {
        to: 3802,
        from: [114, 3802],
        serialize: (value) => (typeof value === "string" ? value : JSON.stringify(value)),
        parse: (value) => value,
      },
      date: { to: 1082, from: [1082], serialize: (value) => String(value), parse: (value) => value },
    },
    ssl: isLocalUrl(url) ? false : "require",
    connect_timeout: 20,
    idle_timeout: 30,
    onnotice: () => {},
    ...options,
  });
}

export function redact(url) {
  return String(url).replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
}

/**
 * A minimal stand-in for the postgres.js client over the Management API:
 * `unsafe(query)` for reads, `begin(fn)` collecting the statements of one
 * migration into a single request. Parameters are inlined as literals because
 * the endpoint takes plain SQL text.
 */
export function managementApiConnection(a) {
  const credentials = readCredentials(a.credentials);
  const ref = a["project-ref"] || credentials.project_ref;
  const token = a["access-token"] || credentials.access_token || process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) throw new Error("--management-api needs a project ref and an access token (--credentials, flags or SUPABASE_ACCESS_TOKEN).");
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;
  const quote = (v) => (Array.isArray(v) ? "array[" + v.map(quote).join(",") + "]::text[]" : "'" + String(v).replace(/'/g, "''") + "'");
  async function run(query) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`management api ${r.status}: ${text.slice(0, 600)}`);
    return text ? JSON.parse(text) : [];
  }
  return {
    label: `management api project ${ref}`,
    unsafe: (query, params = []) => run(params.length ? query.replace(/\$(\d+)/g, (_, i) => quote(params[i - 1])) : query),
    begin: async (fn) => {
      const parts = [];
      await fn({ unsafe: async (query, params = []) => { parts.push(params.length ? query.replace(/\$(\d+)/g, (_, i) => quote(params[i - 1])) : query); } });
      return run(parts.join(";\n"));
    },
    end: async () => {},
  };
}

/**
 * The connection a script should use: the Management API when `--management-api`
 * is set (no database password needed, only a personal access token), else the
 * wire-protocol client. Both expose `unsafe`, `begin` and `end`.
 */
export function resolveConnection(args, mode = "session") {
  if (args["management-api"]) return managementApiConnection(args);
  return adminConnection(resolveDatabaseUrl(args, mode));
}
