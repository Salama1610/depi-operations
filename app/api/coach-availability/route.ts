import { actor, all, auditStmt, db, now, permit, rateLimit, stmt, uid } from "@/lib/server";
import { sameSide } from "@/lib/demo";
import { ensure } from "@/lib/domain/rules";
import { cleanSlots, parseSlots, sessionHours } from "@/lib/domain/coach-availability";

export const dynamic = "force-dynamic";

// Every coach on the system with the hours they can take a session and the
// hours their sessions already take, for Coach Operations and the
// administrators to find who is free on a day and at a time.
//
// Declared hours are kept in coach_availability (one row per coach); booked
// hours are read from the coach's upcoming sessions, so they never go stale.
// Coach Operations and the administrators see and edit every coach.
const managers = ["Coach Operations", "Operations Systems / Admin"];
const noStore = { headers: { "Cache-Control": "no-store" } };

const rolesOf = (value: unknown): string[] => {
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(String(value || "[]"));
  } catch {
    return [];
  }
};

/** Coaches on the caller's side (demo or real), leaving out the placeholder for groups without one. */
async function coaches(u: any) {
  const people = await all(
    `SELECT u.id,u.name,u.email,u.phone,u.title,u.roles,u.active FROM users u
     WHERE ${sameSide(u, "u.id")} AND u.id NOT LIKE 'system-unassigned-%' ORDER BY u.name`,
  );
  return people.filter((p: any) => rolesOf(p.roles).includes("Coach"));
}

export async function GET() {
  try {
    const u = await actor();
    permit(u, managers);
    await rateLimit("coach-availability:" + u.id, 60, 60);
    const people = await coaches(u);
    const side = sameSide(u, "g.id");
    // From the start of today (Cairo is never more than three hours ahead of UTC).
    const since = new Date(Date.now() - 27 * 3600000).toISOString();
    const [declared, assignments, sessions] = await Promise.all([
      all(
        `SELECT a.user_id,a.slots,a.note,a.updated_at,p.name updated_by_name FROM coach_availability a
         LEFT JOIN users p ON p.id=a.updated_by WHERE ${sameSide(u, "a.user_id")}`,
      ),
      all(
        `SELECT g.id group_id,g.track,g.status,g.coach,gc.user_id,gc.coach_type FROM groups g
         LEFT JOIN group_coaches gc ON gc.group_id=g.id AND gc.status='Active'
         WHERE ${side} AND g.status='Active'`,
      ),
      all(
        `SELECT t.id,t.group_id,t.starts_at,t.duration_minutes,coalesce(t.coach_id,g.coach) coach_id,g.track
         FROM sessions t JOIN groups g ON g.id=t.group_id
         WHERE ${side} AND t.status<>'Cancelled' AND t.starts_at>=? ORDER BY t.starts_at`,
        since,
      ),
    ]);

    const byCoach = new Map(people.map((p: any) => [p.id, p]));
    const declaredBy = new Map(declared.map((d: any) => [d.user_id, d]));

    // The groups each coach runs: as the group's coach or through an active assignment.
    const groupsOf = new Map<string, Map<string, { group_id: string; track: string; types: Set<string> }>>();
    const addGroup = (coach: string, group: string, track: string, type?: string | null) => {
      if (!byCoach.has(coach)) return;
      const mine = groupsOf.get(coach) || new Map();
      const row = mine.get(group) || { group_id: group, track, types: new Set<string>() };
      if (type) row.types.add(type);
      mine.set(group, row);
      groupsOf.set(coach, mine);
    };
    for (const a of assignments) {
      if (a.coach) addGroup(a.coach, a.group_id, a.track);
      if (a.user_id) addGroup(a.user_id, a.group_id, a.track, a.coach_type);
    }

    // Upcoming sessions folded into the weekly pattern: one line per group,
    // weekday and start time, with how many are still to come and the next date.
    const booked = new Map<string, Map<string, any>>();
    for (const s of sessions) {
      if (!byCoach.has(s.coach_id)) continue;
      const when = sessionHours(s.starts_at, s.duration_minutes);
      const key = `${s.group_id}|${when.day}|${when.time}`;
      const mine = booked.get(s.coach_id) || new Map();
      const row = mine.get(key) || { group_id: s.group_id, track: s.track, day: when.day, time: when.time, hours: when.hours, keys: when.keys, upcoming: 0, next: s.starts_at };
      row.upcoming += 1;
      mine.set(key, row);
      booked.set(s.coach_id, mine);
    }

    return Response.json(
      {
        coaches: people.map((p: any) => {
          const d: any = declaredBy.get(p.id);
          const groups = [...(groupsOf.get(p.id)?.values() || [])].map((g) => ({ ...g, types: [...g.types] }));
          return {
            id: p.id,
            name: p.name,
            email: p.email,
            phone: p.phone,
            title: p.title,
            active: Number(p.active) === 1 || p.active === true,
            groups,
            tracks: [...new Set(groups.map((g) => g.track).filter(Boolean))].sort(),
            sessions: [...(booked.get(p.id)?.values() || [])],
            declared: d ? parseSlots(d.slots) : null,
            note: d?.note || "",
            updated_at: d?.updated_at || null,
            updated_by_name: d?.updated_by_name || null,
          };
        }),
      },
      noStore,
    );
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    permit(u, managers);
    await rateLimit("coach-availability-write:" + u.id, 60, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();
    const requestId = String(x.request_id || uid("REQ"));
    const coach = (await coaches(u)).find((p: any) => p.id === String(x.user_id || ""));
    ensure(coach, "Choose a coach.");
    const previous: any = await stmt("SELECT * FROM coach_availability WHERE user_id=?", coach.id).first();

    if (x.action === "clear") {
      // Back to "not declared yet".
      ensure(previous, "This coach has no availability recorded.");
      await db().batch([
        stmt("DELETE FROM coach_availability WHERE user_id=?", coach.id),
        auditStmt(u, "Coach availability cleared", coach.id, null, previous, requestId),
      ]);
      return Response.json({ ok: true });
    }

    ensure(x.action === "save", "Unknown action.");
    ensure(Array.isArray(x.slots), "Choose the hours this coach is free.");
    const slots = cleanSlots(x.slots);
    const note = String(x.note || "").trim();
    ensure(note.length <= 500, "Keep the note under 500 characters.");
    const t = now();
    await db().batch([
      stmt(
        `INSERT INTO coach_availability(user_id,slots,note,updated_by,updated_at) VALUES(?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET slots=excluded.slots,note=excluded.note,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        coach.id, JSON.stringify(slots), note || null, u.id, t,
      ),
      auditStmt(u, "Coach availability saved", coach.id, { slots: slots.length, note: note || null }, previous, requestId),
    ]);
    return Response.json({ ok: true, slots });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
