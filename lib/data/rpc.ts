import {
  isoTimestamp,
  normalizeDatabaseError,
  prepareDialect,
  segments,
  translateSql,
  type ColumnTypeMap,
  type Dialect,
} from "./postgres.ts";

/**
 * HTTPS transport for the PostgreSQL adapter.
 *
 * The Cloudflare Worker cannot validate the Supabase pooler's private CA over
 * raw TCP, so in production the statements the application already writes
 * (translated by `translateSql`) are inlined with their parameters and posted
 * to `public.depi_execute` through PostgREST with the service role. One call
 * is one transaction, which keeps `batch()` atomic. Rows come back as JSON and
 * are normalized to the same shapes the D1 path produced (booleans 1/0, JSON
 * as text, timestamps as ISO-8601 UTC strings).
 */

export interface RpcStatement {
  sql: string;
  mode: "rows" | "exec";
}

export interface RpcStatementResult {
  rows: Record<string, unknown>[];
  changes: number;
}

/** Executes a list of statements atomically and returns one result per statement. */
export type StatementCaller = (statements: RpcStatement[]) => Promise<RpcStatementResult[]>;

/** Renders one bound value as a PostgreSQL literal of unknown type. */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot bind a non-finite number.");
    // Quoted so the literal stays untyped and coerces to the column type
    // (boolean, integer, numeric), exactly like an unbound wire parameter.
    return "'" + String(value) + "'";
  }
  if (typeof value === "bigint") return "'" + value.toString() + "'";
  if (value instanceof Date) return literal(value.toISOString());
  if (value instanceof Uint8Array) return "'\\x" + Buffer.from(value).toString("hex") + "'::bytea";
  if (typeof value === "string") {
    if (value.includes("\0")) throw new Error("Cannot bind a string containing NUL.");
    // E'' strings escape backslashes the same way whether or not
    // standard_conforming_strings is on.
    return "E'" + value.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
  }
  if (typeof value === "object") return literal(JSON.stringify(value));
  throw new Error(`Cannot bind a value of type ${typeof value}.`);
}

/** Replaces `$1..$n` outside quoted literals with the rendered parameter values. */
export function inlineParameters(sql: string, params: readonly unknown[]): string {
  let out = "";
  for (const segment of segments(sql)) {
    if (!segment.code) {
      out += segment.text;
      continue;
    }
    out += segment.text.replace(/\$(\d+)/g, (_match, index: string) => {
      const position = Number(index) - 1;
      if (position >= params.length) throw new Error(`Statement expects parameter $${index} but only ${params.length} were bound.`);
      return literal(params[position]);
    });
  }
  return out;
}

/** Whether the statement produces rows (SELECT/WITH or a RETURNING clause). */
export function statementMode(sql: string): RpcStatement["mode"] {
  if (/^\s*(select|with|values)\b/i.test(sql)) return "rows";
  for (const segment of segments(sql)) if (segment.code && /\breturning\b/i.test(segment.text)) return "rows";
  return "exec";
}

/** Strips trailing semicolons so a statement can be wrapped in a CTE. */
export function bareStatement(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "");
}

const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:[+-]\d{2}(?::?\d{2})?|Z)$/;

/**
 * Normalizes one JSON row from `to_jsonb()` to the value shapes the routes
 * expect: JSON booleans → 1/0, nested JSON → text, timestamps with an offset →
 * ISO-8601 UTC. Text columns in this schema store the `Z` form, so an offset
 * form can only come from a timestamptz column.
 */
export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === true) out[key] = 1;
    else if (value === false) out[key] = 0;
    else if (value !== null && typeof value === "object") out[key] = JSON.stringify(value);
    else if (typeof value === "string" && OFFSET_TIMESTAMP.test(value) && !value.endsWith("Z")) out[key] = isoTimestamp(value);
    else out[key] = value;
  }
  return out;
}

interface PostgrestError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

/** Maps a PostgREST error body to the error shape `normalizeDatabaseError` expects. */
export function rpcError(status: number, body: PostgrestError | string): Error {
  if (typeof body === "string") return new Error(`Supabase SQL transport failed (HTTP ${status}): ${body.slice(0, 300)}`);
  const message = body.message ?? `HTTP ${status}`;
  const constraint = message.match(/constraint "([^"]+)"/)?.[1];
  const table = message.match(/relation "([^"]+)"/)?.[1] ?? message.match(/on table "([^"]+)"/)?.[1];
  return normalizeDatabaseError({
    code: body.code,
    message,
    detail: body.details ?? undefined,
    table_name: table,
    constraint_name: constraint,
  });
}

export interface RpcCallerOptions {
  fetch?: typeof fetch;
  functionName?: string;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
}

/** Builds the caller that posts statements to `/rest/v1/rpc/depi_execute`. */
export function createRpcCaller(supabaseUrl: string, serviceRoleKey: string, options: RpcCallerOptions = {}): StatementCaller {
  const endpoint = supabaseUrl.replace(/\/+$/, "") + "/rest/v1/rpc/" + (options.functionName ?? "depi_execute");
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return async (statements) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: "Bearer " + serviceRoleKey,
          "Content-Type": "application/json",
          Accept: "application/json",
          Prefer: "params=single-object",
        },
        body: JSON.stringify({ statements }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error("The database is unreachable: " + (error instanceof Error ? error.message : String(error)), { cause: error });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) {
      let body: PostgrestError | string = text;
      try {
        body = JSON.parse(text) as PostgrestError;
      } catch {
        /* keep text */
      }
      throw rpcError(response.status, body);
    }
    const parsed = JSON.parse(text) as { rows: Record<string, unknown>[]; changes: number }[];
    if (!Array.isArray(parsed) || parsed.length !== statements.length) {
      throw new Error(`Supabase SQL transport returned ${Array.isArray(parsed) ? parsed.length : "no"} results for ${statements.length} statements.`);
    }
    return parsed.map((entry) => ({ rows: entry.rows ?? [], changes: Number(entry.changes ?? 0) }));
  };
}

interface BoundStatement extends D1PreparedStatement {
  readonly text: string;
  readonly params: unknown[];
}

export interface RpcDatabase extends D1Database {
  readonly dialect: Dialect;
  readonly transport: "rpc";
}

/**
 * Statement interface (`prepare().bind().first()/all()/run()`, atomic
 * `batch()`) backed by a `StatementCaller`.
 */
export function createRpcDatabase(caller: StatementCaller, options: { columnTypes: ColumnTypeMap }): RpcDatabase {
  const dialect = prepareDialect(options.columnTypes);

  const prepareStatement = (text: string, params: unknown[]): RpcStatement | null => {
    const translated = translateSql(text, dialect);
    if (translated === null) return null;
    const sql = bareStatement(inlineParameters(translated, params));
    return { sql, mode: statementMode(sql) };
  };

  const toResult = (entry: RpcStatementResult): D1Result => ({
    results: entry.rows.map(normalizeRow),
    success: true,
    meta: { changes: entry.changes },
  });

  const skipped = (): D1Result => ({ results: [], success: true, meta: { changes: 0 } });

  const executeMany = async (items: BoundStatement[]): Promise<D1Result[]> => {
    const prepared = items.map((item) => prepareStatement(item.text, item.params));
    const active = prepared.filter((statement): statement is RpcStatement => statement !== null);
    const executed = active.length ? await caller(active) : [];
    let cursor = 0;
    return prepared.map((statement) => (statement === null ? skipped() : toResult(executed[cursor++])));
  };

  const statement = (text: string, params: unknown[]): BoundStatement => ({
    text,
    params,
    bind: (...values: unknown[]) => statement(text, values),
    first: async <T = Record<string, unknown>>() =>
      ((await executeMany([statement(text, params)]))[0].results[0] as T | undefined) ?? null,
    all: async <T = Record<string, unknown>>() => (await executeMany([statement(text, params)]))[0] as D1Result<T>,
    run: async () => (await executeMany([statement(text, params)]))[0],
  });

  return {
    dialect,
    transport: "rpc",
    prepare: (query: string) => statement(query, []),
    batch: (statements: D1PreparedStatement[]) => executeMany(statements as BoundStatement[]),
  };
}
