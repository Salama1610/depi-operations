import { stmt } from "@/lib/server";

export const dynamic = "force-dynamic";

// For uptime monitoring (12 November 2026): whether the app answers and can
// reach its database, and how long that took. Nothing about the data.
export async function GET() {
  const started = Date.now();
  try {
    await stmt("SELECT 1 ok").first();
    return Response.json({ ok: true, database: "reachable", ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error(JSON.stringify({ level: "error", route: "health", message: String(error?.message ?? error).slice(0, 500) }));
    return Response.json({ ok: false, database: "unreachable", ms: Date.now() - started }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
