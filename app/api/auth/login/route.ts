import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { db, rateLimit, stmt } from "@/lib/server";

export const dynamic = "force-dynamic";

// A first password is the national ID, which has a predictable shape, so
// guessing is slowed. Only wrong passwords count (12 November 2026): counting
// every attempt let anyone lock a person out by trying their email 40 times.
// The tight limit is per account and network address, so one stranger cannot
// shut the owner out from elsewhere; a looser one per account caps guessing
// spread over many addresses.
const failureLimits = [
  { key: (email: string, address: string) => `login-fail:${email}:${address}`, limit: 10, seconds: 900 },
  { key: (email: string) => `login-fail-account:${email}`, limit: 100, seconds: 86400 },
];

const bucketId = (key: string, seconds: number) => `${key}:${Math.floor(Date.now() / (seconds * 1000))}`;

async function tooManyFailures(email: string, address: string) {
  const rows = await Promise.all(
    failureLimits.map((f) => stmt("SELECT count FROM rate_limits WHERE id=?", bucketId(f.key(email, address), f.seconds)).first() as Promise<any>),
  );
  return rows.some((row, i) => Number(row?.count || 0) >= failureLimits[i].limit);
}

async function countFailure(email: string, address: string) {
  await db().batch(
    failureLimits.map((f) => {
      const bucket = Math.floor(Date.now() / (f.seconds * 1000));
      return stmt(
        "INSERT INTO rate_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1",
        `${f.key(email, address)}:${bucket}`,
        new Date((bucket + 2) * f.seconds * 1000).toISOString(),
      );
    }),
  );
}

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) return Response.json({ error: "Authentication setup is not complete." }, { status: 503 });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "This request is not allowed." }, { status: 403 });
    const body = await request.json() as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email || !body.password || body.password.length > 256) return Response.json({ error: "Enter your email and password." }, { status: 400 });
    const address = (request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
    const tooMany = { error: "Too many sign-in attempts. Wait 15 minutes and try again, or reset your password." };
    try {
      // Generous per network address, since a whole office may sign in from one.
      await rateLimit("login-address:" + address, 120, 900);
    } catch {
      return Response.json(tooMany, { status: 429 });
    }
    if (await tooManyFailures(email, address)) return Response.json(tooMany, { status: 429 });
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: body.password });
    // The national ID is the password; changing it is up to the person.
    if (error || !data.user) {
      await countFailure(email, address);
      // A failed sign-in is in the logs, so a run of them can be seen (12 November 2026).
      console.warn(JSON.stringify({ level: "warn", route: "auth/login", event: "sign-in failed", email, address }));
      return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    // In the logs too, kept out of the audit trail so it does not crowd
    // each person's own history.
    console.info(JSON.stringify({ level: "info", route: "auth/login", event: "signed in", email, address }));
    return Response.json({ ok: true, redirect: "/" });
  } catch (error: any) {
    console.error(JSON.stringify({ level: "error", route: "auth/login", message: String(error?.message ?? error).slice(0, 500) }));
    return Response.json({ error: "Sign-in is temporarily unavailable. Please try again." }, { status: 500 });
  }
}
