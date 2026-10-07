/**
 * Marketplace credentials held by the programme.
 *
 * The previous cohort kept these in spreadsheet columns, where anyone with the
 * file could read every account. Here the username and password are encrypted
 * with AES-GCM under a server-only key before they reach the database, so the
 * stored rows are useless on their own, and no client role can read the table
 * at all. The API decrypts on request, shows the value briefly, and records who
 * asked and why.
 *
 * The account id is the additional authenticated data, so ciphertext copied
 * from one account onto another fails to decrypt instead of silently revealing
 * the wrong credential.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The 32 key bytes, from 64 hexadecimal characters or from base64 (the form
 * `openssl rand -base64 32` produces, and the one the deployment was given).
 */
function keyBytes(value: string | undefined): Uint8Array | null {
  const text = String(value ?? "").trim();
  if (/^[a-fA-F0-9]{64}$/.test(text)) return Uint8Array.from(text.match(/../g)!, (pair) => parseInt(pair, 16));
  if (/^[A-Za-z0-9+/]{43}=$/.test(text)) {
    const bytes = fromBase64(text);
    return bytes.length === 32 ? bytes : null;
  }
  return null;
}

export function credentialKeyConfigured(value: string | undefined) {
  return keyBytes(value) !== null;
}

export async function credentialKey(value: string | undefined): Promise<CryptoKey> {
  const bytes = keyBytes(value);
  if (!bytes) {
    throw new Error(
      "Configure CREDENTIAL_ENCRYPTION_KEY with a 32-byte key (64 hexadecimal characters or base64) before storing credentials.",
    );
  }
  return crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export interface SealedCredential {
  username: string;
  secret: string;
  /** The username's IV and the password's, "<base64>.<base64>"; a single IV in rows sealed before October 2026. */
  iv: string;
}

/**
 * Encrypts one account's username and password, each under its own random IV.
 *
 * AES-GCM must never reuse an IV under one key: two values sealed with the same
 * one XOR to the XOR of their plaintexts, so a known username gives away the
 * password, and the authentication key leaks too. The two IVs are stored
 * together in the one column; "." is not a base64 character.
 */
export async function sealCredential(
  key: CryptoKey,
  accountId: string,
  username: string,
  password: string,
): Promise<SealedCredential> {
  const additionalData = encoder.encode(accountId);
  const encrypt = async (value: string, iv: Uint8Array) =>
    toBase64(
      new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData }, key, encoder.encode(value)),
      ),
    );
  const usernameIv = crypto.getRandomValues(new Uint8Array(12));
  const secretIv = crypto.getRandomValues(new Uint8Array(12));
  return {
    username: await encrypt(username, usernameIv),
    secret: await encrypt(password, secretIv),
    iv: `${toBase64(usernameIv)}.${toBase64(secretIv)}`,
  };
}

/** Whether a row still has the single shared IV of the old format and should be sealed again. */
export function needsReseal(sealed: Pick<SealedCredential, "iv">) {
  return !String(sealed.iv).includes(".");
}

/** Reverses `sealCredential`, old format included. Throws if the row was written for another account. */
export async function openCredential(
  key: CryptoKey,
  accountId: string,
  sealed: SealedCredential,
): Promise<{ username: string; password: string }> {
  const [usernameIv, secretIv = usernameIv] = String(sealed.iv).split(".").map(fromBase64);
  const additionalData = encoder.encode(accountId);
  const decrypt = async (value: string, iv: Uint8Array) =>
    decoder.decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData }, key, fromBase64(value) as BufferSource),
    );
  try {
    return { username: await decrypt(sealed.username, usernameIv), password: await decrypt(sealed.secret, secretIv) };
  } catch {
    throw new Error("The stored credential could not be decrypted with the configured key.");
  }
}
