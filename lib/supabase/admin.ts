import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let adminClient: SupabaseClient | undefined;

/**
 * Server-only Supabase client for the operational data migration path.
 *
 * The service-role key bypasses RLS and must never be passed to browser code.
 * API routes still have to authorize the caller before using this client.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  const url = env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase backend access is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in protected server settings.",
    );
  }

  adminClient ??= createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return adminClient;
}

