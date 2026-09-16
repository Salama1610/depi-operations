import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "This request is not allowed." }, { status: 403 });
    const body = await request.json() as { password?: string };
    if (!body.password || body.password.length < 8 || body.password.length > 256) return Response.json({ error: "Use a password between 8 and 256 characters." }, { status: 400 });
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return Response.json({ error: "Your reset session has expired. Request a new link." }, { status: 401 });
    const { error } = await supabase.auth.updateUser({ password: body.password });
    if (error) return Response.json({ error: "Unable to update this password. Request a new reset link." }, { status: 400 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Password update is temporarily unavailable." }, { status: 500 });
  }
}
