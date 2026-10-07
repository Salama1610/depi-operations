import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) return Response.json({ error: "Authentication setup is not complete." }, { status: 503 });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "This request is not allowed." }, { status: 403 });
    const body = await request.json() as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email || !body.password || body.password.length > 256) return Response.json({ error: "Enter your email and password." }, { status: 400 });
    // A first password is the national ID, which has a predictable shape, so
    // guessing is slowed per account (and, generously, per network address,
    // since a whole office may sign in from one).
    const address = (request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
    try {
      await rateLimit("login-address:" + address, 120, 900);
      await rateLimit("login-account:" + email, 10, 900);
      await rateLimit("login-account-day:" + email, 40, 86400);
    } catch {
      return Response.json({ error: "Too many sign-in attempts. Wait 15 minutes and try again, or reset your password." }, { status: 429 });
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: body.password });
    if (error) return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    // The national ID is the password; changing it is up to the person.
    if (!data.user) return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    return Response.json({ ok: true, redirect: "/" });
  } catch {
    return Response.json({ error: "Sign-in is temporarily unavailable. Please try again." }, { status: 500 });
  }
}
