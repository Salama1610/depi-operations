import { env } from "cloudflare:workers";
import columnTypes from "../../supabase/column-types.json";
import { createPostgresDatabase, type ColumnTypeMap } from "./postgres";
import { createRpcCaller, createRpcDatabase } from "./rpc";

/**
 * Selects the operational database for this deployment.
 *
 * Production is Supabase PostgreSQL and fails closed without it. The deployed
 * Worker reaches it over HTTPS through `public.depi_execute` (see
 * `lib/data/rpc.ts`) using `SUPABASE_URL` and the server-only
 * `SUPABASE_SERVICE_ROLE_KEY`: workerd cannot validate the pooler's private CA
 * over raw TCP, so the wire-protocol client is used only where Node runs
 * (scripts, tests) or when `SUPABASE_DB_TRANSPORT=postgres` is set explicitly
 * together with `SUPABASE_DB_URL`. The injected D1 binding is honoured only
 * when `LOCAL_DATA_FALLBACK=1` (tests and developer previews) and remains the
 * source of the one-time migration.
 */

export const COLUMN_TYPES: ColumnTypeMap = columnTypes as ColumnTypeMap;

let client: D1Database | undefined;

/** Whether the injected D1/R2 bindings may be used instead of Supabase. */
export function localFallbackAllowed() {
  return env.LOCAL_DATA_FALLBACK?.trim() === "1";
}

function rpcSettings() {
  const url = env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

function wireUrl() {
  return env.SUPABASE_DB_URL?.trim() || null;
}

export function databaseBackend(): "supabase-rpc" | "supabase-postgres" | "d1" | "none" {
  const forceWire = env.SUPABASE_DB_TRANSPORT?.trim().toLowerCase() === "postgres";
  if (forceWire && wireUrl()) return "supabase-postgres";
  if (rpcSettings()) return "supabase-rpc";
  if (wireUrl()) return "supabase-postgres";
  return localFallbackAllowed() && env.DB ? "d1" : "none";
}

export function isSupabaseDatabaseConfigured() {
  return databaseBackend().startsWith("supabase");
}

export function database(): D1Database | undefined {
  if (client) return client;
  switch (databaseBackend()) {
    case "supabase-rpc": {
      const { url, serviceRoleKey } = rpcSettings()!;
      client = createRpcDatabase(createRpcCaller(url, serviceRoleKey), { columnTypes: COLUMN_TYPES });
      return client;
    }
    case "supabase-postgres":
      client = createPostgresDatabase(wireUrl()!, { columnTypes: COLUMN_TYPES });
      return client;
    case "d1":
      return env.DB;
    default:
      return undefined;
  }
}
