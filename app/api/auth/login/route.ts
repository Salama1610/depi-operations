import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) return Response.json({ error: "Authentication setup is not complete." }, { status: 503 });
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "This request is not allowed." }, { status: 403 });
    const body = await request.json() as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email || !body.password || body.password.length > 256) return Response.json({ error: "Enter your email and password." }, { status: 400 });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: body.password });
    if (error) return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    return Response.json({ ok: true, redirect: "/" });
  } catch {
    return Response.json({ error: "Sign-in is temporarily unavailable. Please try again." }, { status: 500 });
  }
}
