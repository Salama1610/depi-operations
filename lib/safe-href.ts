/**
 * A link typed by a person or read from a sheet, as an href: only web and
 * WhatsApp addresses open; anything else (javascript:, data:, a file path)
 * is not a link at all (12 November 2026). React and browsers block the worst
 * of these already; this is the second line of defence.
 */
export function safeHref(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
