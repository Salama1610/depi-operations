import { NextResponse } from "next/server";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function logout(request: Request) {
  // The app's own Sign out links are plain links. A link on another site must
  // not sign anyone out (12 November 2026): browsers say where a click came
  // from, and a cross-site one just goes to the app.
  if (request.method === "GET" && request.headers.get("sec-fetch-site") === "cross-site")
    return NextResponse.redirect(new URL("/", request.url), { status: 303 });
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

export const GET = logout;
export const POST = logout;
