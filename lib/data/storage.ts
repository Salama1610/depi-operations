import { env } from "@/lib/env";
import { getSupabaseAdminClient } from "../supabase/admin";
import { localFallbackAllowed } from "./database";

/**
 * Evidence object store used by upload, delivery, backup and pilot fixtures.
 *
 * The shape mirrors the R2 binding the routes were written against so no
 * caller changes. Production uses the private Supabase bucket through the
 * server-only service role and fails closed without it; the injected binding
 * is honoured only when `LOCAL_DATA_FALLBACK=1` (tests and developer previews).
 */
export interface ObjectStore {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  delete(key: string): Promise<void>;
}

export const DEFAULT_EVIDENCE_BUCKET = "depi-evidence";

export function isSupabaseStorageConfigured() {
  return Boolean(env.SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function toBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function createSupabaseObjectStore(bucketName: string): ObjectStore {
  const bucket = () => getSupabaseAdminClient().storage.from(bucketName);
  return {
    async put(key, value, options) {
      const contentType = options?.httpMetadata?.contentType ?? "application/octet-stream";
      const body = new Blob([toBytes(value) as BlobPart], { type: contentType });
      const { error } = await bucket().upload(key, body, { contentType, upsert: false });
      if (error) throw new Error("Evidence storage rejected the upload: " + error.message);
      return { key };
    },
    async get(key) {
      const { data, error } = await bucket().download(key);
      if (error || !data) return null;
      return { body: data.stream() };
    },
    async delete(key) {
      const { error } = await bucket().remove([key]);
      if (error) throw new Error("Evidence storage could not delete the object: " + error.message);
    },
  };
}

let store: ObjectStore | undefined;

/** Resolves the evidence store for this deployment. */
export function objectStore(): ObjectStore | undefined {
  if (isSupabaseStorageConfigured()) {
    store ??= createSupabaseObjectStore(env.SUPABASE_EVIDENCE_BUCKET?.trim() || DEFAULT_EVIDENCE_BUCKET);
    return store;
  }
  return localFallbackAllowed() ? (env.BUCKET ?? undefined) : undefined;
}
