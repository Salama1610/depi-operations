import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) return Response.json({ error: "Authentication setup is not complete." }, { status: 503 });
    const origin = request.headers.get("origin");
    const siteOrigin = new URL(request.url).origin;
    if (origin && origin !== siteOrigin) return Response.json({ error: "This request is not allowed." }, { status: 403 });
    const body = await request.json() as { email?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email) return Response.json({ error: "Enter your email address." }, { status: 400 });
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${siteOrigin}/auth/callback?next=/auth/update-password` });
    return Response.json({ ok: true, message: "If this email is registered, a reset link is on its way." });
  } catch {
    return Response.json({ error: "Password reset is temporarily unavailable." }, { status: 500 });
  }
}
