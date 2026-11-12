// How a route answers when something goes wrong (12 November 2026).
//
// Three kinds of failure, told apart so an outage is never mistaken for a
// permission problem and the logs say what broke:
// - a refusal: ensure() or permit() said no. The person sees the message, which
//   was written for them, with 4xx.
// - a rule of the database: a unique key, a foreign key or a workflow trigger
//   refused the change. Also written for people (or mapped below), with 409.
// - anything else: the database unreachable, a bug, a timeout. It is logged
//   with the route and the person, and they see a general message with 500,
//   never the transport's or the driver's text.

import { Refusal } from "./domain/rules.ts";

export { Refusal };

const unexpectedMessage = "Something went wrong on our side. Please try again; if it keeps happening, report it from the Support page.";

/** Whether a database error is one of its rules refusing a change, not a fault. */
function databaseRule(e: any) {
  const code = String(e?.code ?? e?.cause?.code ?? "");
  // 23xxx integrity (unique, foreign key, check, not null), P0001 a trigger's raise.
  if (/^23\d{3}$/.test(code) || code === "P0001") return true;
  // The local SQLite engine used by tests and previews.
  if (code === "ERR_SQLITE_ERROR") return true;
  return /UNIQUE constraint|FOREIGN KEY constraint|CHECK constraint|immutable/i.test(String(e?.message || ""));
}

function friendly(message: string) {
  if (/UNIQUE constraint/.test(message)) return "A duplicate record or concurrent assignment was blocked. Refresh and review the existing record.";
  if (/FOREIGN KEY/.test(message)) return "A linked record does not exist. Check the selected student, owner and group.";
  return message;
}

/**
 * The response for an error thrown inside a route. `refusalStatus` is what a
 * refusal answers with when the route has its own convention (the workspace
 * load answers 403).
 */
export function failure(e: unknown, route: string, options: { refusalStatus?: number; user?: { id?: string } | null; headers?: HeadersInit } = {}) {
  const error = e as any;
  const headers = options.headers;
  if (error instanceof Refusal) return Response.json({ error: error.message }, { status: options.refusalStatus ?? error.status, headers });
  if (databaseRule(error)) return Response.json({ error: friendly(String(error.message || "")) }, { status: 409, headers });
  const reference = typeof crypto?.randomUUID === "function" ? crypto.randomUUID().slice(0, 8) : String(Date.now());
  console.error(
    JSON.stringify({
      level: "error",
      route,
      reference,
      user: options.user?.id ?? null,
      name: error?.name,
      message: String(error?.message ?? error).slice(0, 1000),
      code: error?.code ?? error?.cause?.code ?? null,
      stack: String(error?.stack ?? "").split("\n").slice(0, 6).join(" | "),
    }),
  );
  return Response.json({ error: unexpectedMessage, reference }, { status: 500, headers });
}
