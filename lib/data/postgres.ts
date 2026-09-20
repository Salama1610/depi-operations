import postgres from "postgres";

/**
 * PostgreSQL (Supabase) implementation of the statement interface the
 * application was written against (`prepare().bind().first()/all()/run()` and
 * atomic `batch()`).
 *
 * The routes and services keep their existing SQL. This module translates the
 * handful of SQLite-only idioms to PostgreSQL and normalizes result values so
 * rows look exactly like the ones the D1 path produced: booleans as 1/0,
 * timestamps as ISO-8601 strings, JSON columns as JSON text, numerics as
 * numbers. No caller has to know which engine is underneath.
 *
 * Every rewrite is driven by `supabase/column-types.json`, the table → column →
 * PostgreSQL type contract that mirrors the migrations.
 */

export type ColumnTypeMap = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface Dialect {
  readonly columnTypes: ColumnTypeMap;
  /** Column names that are `boolean` in PostgreSQL but 0/1 integers in SQLite. */
  readonly booleanColumns: ReadonlySet<string>;
  /** Column names stored as `jsonb`; cast to text before LIKE. */
  readonly jsonColumns: ReadonlySet<string>;
  /** Table → ordered column names, for positional inserts and ON CONFLICT updates. */
  readonly tableColumns: Readonly<Record<string, readonly string[]>>;
}

export function prepareDialect(columnTypes: ColumnTypeMap): Dialect {
  const booleanColumns = new Set<string>();
  const jsonColumns = new Set<string>();
  const tableColumns: Record<string, string[]> = {};
  for (const [table, columns] of Object.entries(columnTypes)) {
    tableColumns[table.toLowerCase()] = Object.keys(columns);
    for (const [column, type] of Object.entries(columns)) {
      if (type === "boolean") booleanColumns.add(column.toLowerCase());
      if (type === "jsonb" || type === "json") jsonColumns.add(column.toLowerCase());
    }
  }
  return { columnTypes, booleanColumns, jsonColumns, tableColumns };
}

const SKIPPED_STATEMENTS = /^(create\s+trigger|drop\s+trigger|pragma)\b/i;
const CONFLICT_UPDATE = /\bdo\s+update\s+set\b/i;
const TOKENS = /[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?|\(|\)|,|[^A-Za-z_(),]+/g;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Segment {
  code: boolean;
  text: string;
  offset: number;
}

/**
 * Splits SQL into alternating code and literal segments so rewrites never touch
 * the inside of a quoted string or identifier.
 */
export function segments(sql: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  let start = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      if (i > start) out.push({ code: true, text: sql.slice(start, i), offset: start });
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out.push({ code: false, text: sql.slice(i, j + 1), offset: i });
      i = j + 1;
      start = i;
      continue;
    }
    i++;
  }
  if (start < sql.length) out.push({ code: true, text: sql.slice(start), offset: start });
  return out;
}

/**
 * Splits `a, b, (c, d), 'e,f'` at top-level commas, honouring parentheses and
 * quoted literals.
 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Finds the closing parenthesis matching the one at `open`. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Offset of the first top-level WHERE/RETURNING keyword in `text`, or its length. */
function clauseEnd(text: string): number {
  let depth = 0;
  for (const segment of segments(text)) {
    if (!segment.code) continue;
    for (const match of segment.text.matchAll(TOKENS)) {
      const token = match[0];
      if (token === "(") depth++;
      else if (token === ")") depth--;
      else if (depth === 0 && /^(where|returning)$/i.test(token)) return segment.offset + (match.index ?? 0);
    }
  }
  return text.length;
}

/** Locates the SET clause of an UPDATE or of an INSERT ... ON CONFLICT DO UPDATE. */
function setClause(sql: string): { table: string; start: number; end: number } | null {
  const update = sql.match(/^\s*update\s+([A-Za-z_]\w*)\s+set\b/i);
  if (update) {
    const start = update[0].length;
    return { table: update[1], start, end: start + clauseEnd(sql.slice(start)) };
  }
  const insert = sql.match(/^\s*insert\s+(?:or\s+\w+\s+)?into\s+([A-Za-z_]\w*)/i);
  const conflict = CONFLICT_UPDATE.exec(sql);
  if (!insert || !conflict) return null;
  const start = conflict.index + conflict[0].length;
  return { table: insert[1], start, end: start + clauseEnd(sql.slice(start)) };
}

/**
 * Rewrites `INSERT INTO t ... ON CONFLICT DO UPDATE SET a=a+1 WHERE b=...` so
 * that every bare reference to a column of `t` on the right-hand side becomes
 * `t.column`; assignment targets and `excluded.*` references stay as written.
 */
function qualifyConflictUpdate(sql: string, dialect: Dialect): string {
  const target = sql.match(/\binsert\s+(?:or\s+\w+\s+)?into\s+([A-Za-z_]\w*)/i);
  const clause = CONFLICT_UPDATE.exec(sql);
  if (!target || !clause) return sql;
  const table = target[1];
  const columns = new Set((dialect.tableColumns[table.toLowerCase()] ?? []).map((c) => c.toLowerCase()));
  if (columns.size === 0) return sql;
  const splitAt = clause.index + clause[0].length;
  let out = sql.slice(0, splitAt);
  let depth = 0;
  let expectTarget = true;
  let inCondition = false;
  for (const segment of segments(sql.slice(splitAt))) {
    if (!segment.code) {
      out += segment.text;
      continue;
    }
    const text = segment.text;
    let cursor = 0;
    for (const match of text.matchAll(TOKENS)) {
      const token = match[0];
      const position = match.index ?? 0;
      out += text.slice(cursor, position);
      cursor = position + token.length;
      let emitted = token;
      if (token === "(") depth++;
      else if (token === ")") depth--;
      else if (token === ",") {
        if (depth === 0 && !inCondition) expectTarget = true;
      } else if (/^[A-Za-z_]/.test(token)) {
        const upper = token.toUpperCase();
        if (depth === 0 && (upper === "WHERE" || upper === "RETURNING")) {
          inCondition = true;
          expectTarget = false;
        } else if (expectTarget && depth === 0) {
          expectTarget = false;
        } else if (!token.includes(".") && columns.has(token.toLowerCase()) && !/^\s*\(/.test(text.slice(cursor))) {
          emitted = `${table}.${token}`;
        }
      }
      out += emitted;
    }
    out += text.slice(cursor);
  }
  return out;
}

/**
 * `SET col=CASE WHEN … THEN ? ELSE NULL END` resolves to text in PostgreSQL
 * when no branch carries a known type, which SQLite never minded. Assignments
 * whose expression contains a CASE are cast to the column's declared type.
 */
function castCaseAssignments(sql: string, dialect: Dialect): string {
  const clause = setClause(sql);
  if (!clause) return sql;
  const types = dialect.columnTypes[clause.table.toLowerCase()];
  if (!types) return sql;
  const assignments = splitTopLevel(sql.slice(clause.start, clause.end)).map((assignment) => {
    const eq = assignment.indexOf("=");
    if (eq < 0) return assignment;
    const column = assignment.slice(0, eq).trim().toLowerCase();
    const expression = assignment.slice(eq + 1);
    const type = types[column];
    if (!type || /^text\b/i.test(type) || !/\bcase\b/i.test(expression)) return assignment;
    const trailing = expression.match(/\s*$/)?.[0] ?? "";
    return `${assignment.slice(0, eq + 1)}(${expression.trim()})::${type}${trailing}`;
  });
  return sql.slice(0, clause.start) + assignments.join(",") + sql.slice(clause.end);
}

/**
 * SQLite stores booleans as 0/1, so inserts write literal integers. PostgreSQL
 * rejects an integer expression for a boolean column, so literal 0/1 values in
 * `INSERT ... VALUES` tuples become true/false at boolean column positions.
 */
function rewriteBooleanInsertLiterals(sql: string, dialect: Dialect): string {
  if (dialect.booleanColumns.size === 0) return sql;
  const head = sql.match(/^\s*insert\s+(?:or\s+\w+\s+)?into\s+([A-Za-z_]\w*)\s*/i);
  if (!head) return sql;
  const allColumns = dialect.tableColumns[head[1].toLowerCase()];
  if (!allColumns) return sql;
  let cursor = head[0].length;
  let columns: readonly string[] = allColumns;
  if (sql[cursor] === "(") {
    const end = closingParen(sql, cursor);
    if (end < 0) return sql;
    columns = splitTopLevel(sql.slice(cursor + 1, end)).map((c) => c.trim().toLowerCase());
    cursor = end + 1;
  }
  const positions = new Set<number>();
  columns.forEach((column, index) => {
    if (dialect.booleanColumns.has(column.toLowerCase())) positions.add(index);
  });
  if (positions.size === 0) return sql;
  const values = /\s*values\s*/iy;
  values.lastIndex = cursor;
  if (!values.exec(sql)) return sql;
  let out = sql.slice(0, values.lastIndex);
  let index = values.lastIndex;
  while (sql[index] === "(") {
    const end = closingParen(sql, index);
    if (end < 0) return sql;
    const tuple = splitTopLevel(sql.slice(index + 1, end)).map((value, position) => {
      const literal = value.trim();
      if (!positions.has(position)) return value;
      if (literal === "1") return value.replace("1", "true");
      if (literal === "0") return value.replace("0", "false");
      return value;
    });
    out += "(" + tuple.join(",") + ")";
    index = end + 1;
    const separator = /\s*,\s*/y;
    separator.lastIndex = index;
    if (separator.exec(sql)) {
      out += sql.slice(index, separator.lastIndex);
      index = separator.lastIndex;
    } else break;
  }
  return out + sql.slice(index);
}

/**
 * Translates one SQLite/D1 statement to PostgreSQL. Returns `null` for
 * statements that have no PostgreSQL counterpart at runtime (SQLite trigger
 * installation and PRAGMAs) because the Supabase migrations already install
 * the equivalent safeguards.
 */
export function translateSql(sql: string, dialect: Dialect): string | null {
  const trimmed = sql.trim();
  if (SKIPPED_STATEMENTS.test(trimmed)) return null;

  // json_extract(col,'$.key') is only used against numeric policy settings.
  let source = trimmed.replace(
    /\bjson_extract\(\s*([A-Za-z_][\w.]*)\s*,\s*'\$\.([A-Za-z_]\w*)'\s*\)/gi,
    "(($1->>'$2')::numeric)",
  );
  if (CONFLICT_UPDATE.test(source)) source = qualifyConflictUpdate(source, dialect);
  source = castCaseAssignments(source, dialect);
  source = rewriteBooleanInsertLiterals(source, dialect);

  const booleanPattern =
    dialect.booleanColumns.size > 0
      ? new RegExp(
          `\\b((?:[A-Za-z_]\\w*\\.)?(?:${[...dialect.booleanColumns].map(escapeRegExp).join("|")}))\\s*(=|<>|!=)\\s*([01])\\b`,
          "gi",
        )
      : null;
  const jsonLikePattern =
    dialect.jsonColumns.size > 0
      ? new RegExp(
          `\\b((?:[A-Za-z_]\\w*\\.)?(?:${[...dialect.jsonColumns].map(escapeRegExp).join("|")}))(\\s+(?:not\\s+)?(?:i)?like\\b)`,
          "gi",
        )
      : null;

  let placeholder = 0;
  let ignoreConflicts = false;
  let out = "";
  for (const segment of segments(source)) {
    if (!segment.code) {
      out += segment.text;
      continue;
    }
    let code = segment.text;
    if (/\binsert\s+or\s+ignore\s+into\b/i.test(code)) {
      ignoreConflicts = true;
      code = code.replace(/\binsert\s+or\s+ignore\s+into\b/gi, "INSERT INTO");
    }
    if (jsonLikePattern) code = code.replace(jsonLikePattern, "$1::text$2");
    code = code
      .replace(/\?/g, () => `$${++placeholder}`)
      .replace(/\bjson_group_array\(\s*([\w.]+)\s*\)/gi, "coalesce(jsonb_agg($1),'[]'::jsonb)")
      .replace(/\bgroup_concat\(\s*([\w.]+)\s*\)/gi, "string_agg(($1)::text, ',')")
      .replace(/\bmin\(\s*(\d+)\s*,/gi, "least($1,")
      .replace(/\bmax\(\s*(\d+)\s*,/gi, "greatest($1,")
      .replace(/\bifnull\(/gi, "coalesce(")
      .replace(/(?<![A-Za-z_])like\b/gi, "ILIKE");
    if (booleanPattern) {
      code = code.replace(booleanPattern, (_m, column: string, op: string, value: string) => {
        return `${column} ${op} ${value === "1" ? "true" : "false"}`;
      });
    }
    out += code;
  }

  if (ignoreConflicts && !/\bon\s+conflict\b/i.test(out)) {
    const returning = out.search(/\breturning\b/i);
    out =
      returning >= 0
        ? `${out.slice(0, returning).trimEnd()} ON CONFLICT DO NOTHING ${out.slice(returning)}`
        : `${out} ON CONFLICT DO NOTHING`;
  }
  return out;
}

/** Converts PostgreSQL text timestamps to the ISO-8601 form D1 rows carried. */
export function isoTimestamp(value: string): string {
  let text = value.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(text)) text += ":00";
  else if (!/(Z|[+-]\d{2}:\d{2})$/.test(text)) text += "Z";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * Driver type handlers shared by the runtime adapter and the migration script.
 * The serializers matter as much as the parsers: postgres.js otherwise learns
 * a parameter is jsonb and JSON-encodes already-serialized text a second time.
 */
export const postgresTypes = {
  bool: {
    to: 16,
    from: [16],
    serialize: (value: unknown) =>
      value === true || value === 1 || value === "1" || value === "t" || value === "true" ? "t" : "f",
    parse: (value: string) => (value === "t" ? 1 : 0),
  },
  bigint: {
    to: 20,
    from: [20],
    serialize: (value: unknown) => String(value),
    parse: (value: string) => Number(value),
  },
  numeric: {
    to: 1700,
    from: [1700],
    serialize: (value: unknown) => String(value),
    parse: (value: string) => Number(value),
  },
  timestamp: {
    to: 1184,
    from: [1114, 1184],
    serialize: (value: unknown) => (value instanceof Date ? value.toISOString() : String(value)),
    parse: isoTimestamp,
  },
  date: {
    to: 1082,
    from: [1082],
    serialize: (value: unknown) => String(value),
    parse: (value: string) => value,
  },
  json: {
    to: 3802,
    from: [114, 3802],
    serialize: (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value)),
    parse: (value: string) => value,
  },
};

interface PostgresErrorLike {
  code?: string;
  message: string;
  detail?: string;
  table_name?: string;
  constraint_name?: string;
}

/**
 * Surfaces constraint failures with the wording the routes already recognise
 * (`UNIQUE constraint failed`, `FOREIGN KEY constraint failed`) so user-facing
 * messages stay identical to the D1 deployment.
 */
export function normalizeDatabaseError(error: unknown): Error {
  const e = (error ?? {}) as PostgresErrorLike;
  const where = [e.table_name, e.constraint_name].filter(Boolean).join(".");
  let message = e.message || String(error);
  if (e.code === "23505") message = `UNIQUE constraint failed: ${where}${e.detail ? " (" + e.detail + ")" : ""}`;
  else if (e.code === "23503") message = `FOREIGN KEY constraint failed: ${where}${e.detail ? " (" + e.detail + ")" : ""}`;
  const normalized = new Error(message, { cause: error });
  (normalized as Error & { code?: string }).code = e.code;
  return normalized;
}

interface BoundStatement extends D1PreparedStatement {
  readonly text: string;
  readonly params: unknown[];
}

export interface PostgresDatabase extends D1Database {
  /** Closes pooled connections. Used by tests and one-off scripts. */
  end(): Promise<void>;
  readonly sql: postgres.Sql;
  readonly dialect: Dialect;
}

export interface PostgresDatabaseOptions {
  columnTypes: ColumnTypeMap;
  max?: number;
  ssl?: boolean | "require";
}

function isLocal(url: string) {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

export function createPostgresDatabase(url: string, options: PostgresDatabaseOptions): PostgresDatabase {
  const dialect = prepareDialect(options.columnTypes);
  const sql = postgres(url, {
    prepare: false,
    fetch_types: false,
    max: options.max ?? 3,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: options.ssl ?? (isLocal(url) ? false : "require"),
    types: postgresTypes,
    onnotice: () => {},
  });

  const execute = async (
    client: postgres.Sql | postgres.TransactionSql,
    text: string,
    params: unknown[],
  ): Promise<D1Result> => {
    const translated = translateSql(text, dialect);
    if (translated === null) return { results: [], success: true, meta: { changes: 0 } };
    try {
      const rows = await client.unsafe(
        translated,
        params.map((value) => (value === undefined ? null : value)) as never,
      );
      return {
        results: Array.from(rows as unknown as Record<string, unknown>[]),
        success: true,
        meta: { changes: rows.count ?? 0 },
      };
    } catch (error) {
      throw normalizeDatabaseError(error);
    }
  };

  const statement = (text: string, params: unknown[]): BoundStatement => ({
    text,
    params,
    bind: (...values: unknown[]) => statement(text, values),
    first: async <T = Record<string, unknown>>() =>
      ((await execute(sql, text, params)).results[0] as T | undefined) ?? null,
    all: async <T = Record<string, unknown>>() => (await execute(sql, text, params)) as D1Result<T>,
    run: async () => execute(sql, text, params),
  });

  return {
    sql,
    dialect,
    prepare: (query: string) => statement(query, []),
    async batch(statements: D1PreparedStatement[]) {
      return sql.begin(async (tx) => {
        const results: D1Result[] = [];
        for (const item of statements as BoundStatement[]) {
          results.push(await execute(tx, item.text, item.params));
        }
        return results;
      }) as Promise<D1Result[]>;
    },
    end: () => sql.end({ timeout: 5 }),
  };
}
