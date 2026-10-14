// Coach availability: the hours of the week a coach says they can take a
// session, and the hours their sessions already take.
//
// A week is Saturday to Friday, the order the coach schedule uses. An hour is
// written "Sat-17" (Saturday, 5 PM to 6 PM, Cairo time). Sessions run three
// hours, so a 5 PM session takes Sat-17, Sat-18 and Sat-19.

export const availabilityDays = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export type AvailabilityDay = (typeof availabilityDays)[number];
/** The first hour of each block a coach can be booked in: 9 AM to 10 PM (the last block ends at 11 PM). */
export const availabilityHours = Array.from({ length: 14 }, (_, i) => 9 + i);

export const slotKey = (day: string, hour: number) => `${day}-${hour}`;

/** Only well-formed hours inside the grid, once each, in week order. */
export function cleanSlots(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const valid = new Set(availabilityDays.flatMap((d) => availabilityHours.map((h) => slotKey(d, h))));
  const seen = new Set(list.map(String).filter((k) => valid.has(k)));
  return availabilityDays.flatMap((d) => availabilityHours.map((h) => slotKey(d, h))).filter((k) => seen.has(k));
}

export function parseSlots(text: unknown): string[] {
  if (Array.isArray(text)) return cleanSlots(text);
  try {
    return cleanSlots(JSON.parse(String(text || "[]")));
  } catch {
    return [];
  }
}

const cairo = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The Cairo weekday, start time and hours a session takes. */
export function sessionHours(startsAt: string, durationMinutes = 180) {
  const parts = cairo.formatToParts(new Date(startsAt));
  const part = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const day = part("weekday");
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  const start = hour * 60 + minute;
  const end = start + (Number(durationMinutes) || 180);
  const hours: number[] = [];
  for (let h = hour; h * 60 < end; h++) if (h < 24) hours.push(h);
  return { day, time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, hours, keys: hours.map((h) => slotKey(day, h)) };
}

/** "5 PM" / "٥ م" style label for an hour of the day. */
export function hourLabel(hour: number, locale = "en") {
  const h = ((hour + 11) % 12) + 1;
  const pm = hour % 24 >= 12;
  return locale === "ar" ? `${h} ${pm ? "م" : "ص"}` : `${h} ${pm ? "PM" : "AM"}`;
}

/** Joined runs of hours on one day: [17,18,19,21] -> [[17,20],[21,22]] (end exclusive). */
export function hourRuns(hours: number[]) {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const h of sorted) {
    const last = runs[runs.length - 1];
    if (last && last[1] === h) last[1] = h + 1;
    else runs.push([h, h + 1]);
  }
  return runs;
}

export type HourState = "free" | "booked" | "away" | "open";

/**
 * One hour for one coach. "booked": a session takes it. "free": declared and
 * not booked. "away": the coach declared their week and this hour is not in it.
 * "open": nothing declared yet and nothing booked.
 */
export function hourState(declared: Set<string> | null, booked: Set<string>, key: string): HourState {
  if (booked.has(key)) return "booked";
  if (!declared) return "open";
  return declared.has(key) ? "free" : "away";
}

/**
 * Whether a coach fits a filter: free for every hour from `from` to `to` (end
 * exclusive) on all of the chosen days, or on at least one of them.
 * `includeOpen` counts a coach with no declared availability as free where
 * nothing is booked.
 */
export function freeFor(
  declared: Set<string> | null,
  booked: Set<string>,
  days: readonly string[],
  from: number,
  to: number,
  { match = "all", includeOpen = false }: { match?: "all" | "any"; includeOpen?: boolean } = {},
) {
  if (!days.length) return true;
  const fits = (day: string) => {
    for (let h = from; h < to; h++) {
      const state = hourState(declared, booked, slotKey(day, h));
      if (!(state === "free" || (includeOpen && state === "open"))) return false;
    }
    return true;
  };
  return match === "any" ? days.some(fits) : days.every(fits);
}
