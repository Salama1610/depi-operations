// Calendar days and programme weeks in Cairo, shared by the server rules.
// The programme week runs Friday to Thursday (see app/weekly-progress.tsx).

/** The Cairo calendar day of an instant, as YYYY-MM-DD. */
export function cairoDay(at: string | number | Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** A calendar day moved by n days. */
export function addDays(day: string, n: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Friday that opens the programme week containing `day`. */
export function programmeWeekStart(day: string): string {
  const weekday = new Date(day + "T12:00:00Z").getUTCDay(); // Friday is 5
  return addDays(day, -((weekday - 5 + 7) % 7));
}

/** Whether `at` falls on the same Cairo day as `day`, or on an earlier one. */
export function onOrBeforeDay(at: string | number | Date, day: string): boolean {
  return cairoDay(at) <= day;
}
