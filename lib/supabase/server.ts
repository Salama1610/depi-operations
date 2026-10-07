import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { cookies } from "next/headers";

function config() {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

export function isSupabaseConfigured() {
  return Boolean(config());
}

export async function createSupabaseServerClient() {
  const settings = config();
  if (!settings) throw new Error("Supabase authentication is not configured yet.");
  const cookieStore = await cookies();

  return createServerClient(settings.url, settings.key, {
    auth: { flowType: "pkce" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        try {
          // The session never needs reading from the page (there is no browser
          // Supabase client), so page scripts cannot read it either.
          values.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: options?.sameSite ?? "lax",
              secure: process.env.NODE_ENV === "production" ? true : options?.secure,
            }),
          );
        } catch {
          // Server Components cannot write cookies. Route handlers refresh them.
        }
      },
    },
  });
}

export async function getSupabaseUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}
