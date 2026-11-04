// Lookups over the workspace's lists, built once per load of the data.
//
// The Sessions page asked "which marks has this session?" and "who is in this
// group?" by searching a whole list, for every session and every student, each
// time anything on the page changed: a letter typed in a form took seconds on
// a staff laptop at the programme's size (measured 4 November 2026). With these
// each question is one lookup.

type Row = Record<string, any>;

function bucket(rows: Row[], key: string) {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const list = out.get(row[key]);
    if (list) list.push(row);
    else out.set(row[key], [row]);
  }
  return out;
}

export function buildWorkspaceIndex(d: Row) {
  const attendance: Row[] = d.attendance || [];
  const activeByGroup = bucket((d.students || []).filter((s: Row) => s.lifecycle === "Active"), "group_id");
  for (const roster of activeByGroup.values()) roster.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const marks = new Map<string, Row>();
  // The first mark of a session and student, as searching the list found it.
  for (const a of attendance) {
    const key = a.session_id + "|" + a.student_id;
    if (!marks.has(key)) marks.set(key, a);
  }
  return {
    /** A group's active students, by name. Shared: copy before changing. */
    activeByGroup,
    marksBySession: bucket(attendance, "session_id"),
    markOf: (sessionId: string, studentId: string) => marks.get(sessionId + "|" + studentId),
    checksBySession: bucket(d.sessionChecks || [], "session_id"),
    feedbackBySession: bucket(d.sessionFeedback || [], "session_id"),
    staffById: new Map<string, Row>((d.staff || []).map((s: Row) => [s.id, s])),
    groupsById: new Map<string, Row>((d.groups || []).map((g: Row) => [g.id, g])),
    studentsById: new Map<string, Row>((d.students || []).map((s: Row) => [s.id, s])),
  };
}

/** Remembers a date's formatted text: browsers format dates slowly, and the same few come up again on every redraw. */
export function rememberDates<T>(format: (iso: string, locale: string) => T) {
  const seen = new Map<string, T>();
  return (iso: string, locale = "") => {
    const key = locale + "|" + iso;
    let value = seen.get(key);
    if (value === undefined) {
      if (seen.size > 20000) seen.clear();
      value = format(iso, locale);
      seen.set(key, value);
    }
    return value;
  };
}
