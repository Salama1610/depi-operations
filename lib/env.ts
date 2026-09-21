/**
 * Runtime settings, independent of where the app runs.
 *
 * The app started life on Cloudflare Workers, where settings arrive through a
 * bindings module that does not exist anywhere else. On Vercel, or any Node
 * server, they are ordinary environment variables. Every server module reads
 * from here so that the same code runs in both places, and the test harness
 * injects its own values through `globalThis.__testEnv` without mocking a
 * module.
 *
 * Only string settings are read from the process environment. The optional
 * `DB` and `BUCKET` objects are the local D1/R2 stand-ins that tests inject;
 * a real deployment never sets them.
 */
export interface AppEnv {
  DB?: D1Database;
  BUCKET?: R2Bucket;
  AUTOMATION_HMAC_SECRET?: string;
  AUTOMATION_ACTOR_EMAIL?: string;
  VAULT_URL?: string;
  VAULT_TOKEN?: string;
  BACKUP_ENCRYPTION_KEY?: string;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_EVIDENCE_BUCKET?: string;
  SUPABASE_DB_URL?: string;
  SUPABASE_DB_TRANSPORT?: string;
  LOCAL_DATA_FALLBACK?: string;
}

function injected(): Partial<AppEnv> | undefined {
  return (globalThis as { __testEnv?: Partial<AppEnv> }).__testEnv;
}

export const env: AppEnv = new Proxy({} as AppEnv, {
  get(_target, key: string) {
    const override = injected();
    if (override && key in override) return override[key as keyof AppEnv];
    const processEnv = typeof process !== "undefined" ? process.env : undefined;
    return processEnv?.[key];
  },
  has(_target, key: string) {
    const override = injected();
    if (override && key in override) return true;
    return typeof process !== "undefined" && key in process.env;
  },
});
