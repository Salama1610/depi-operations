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

export function credentialKeyConfigured(hex: string | undefined) {
  return /^[a-fA-F0-9]{64}$/.test(String(hex ?? ""));
}

export async function credentialKey(hex: string | undefined): Promise<CryptoKey> {
  if (!credentialKeyConfigured(hex)) {
    throw new Error(
      "Configure CREDENTIAL_ENCRYPTION_KEY with a 32-byte hexadecimal key before storing marketplace credentials.",
    );
  }
  const bytes = Uint8Array.from(String(hex).match(/../g)!, (pair) => parseInt(pair, 16));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
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
  iv: string;
}

/** Encrypts one account's username and password under a single random IV. */
export async function sealCredential(
  key: CryptoKey,
  accountId: string,
  username: string,
  password: string,
): Promise<SealedCredential> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = encoder.encode(accountId);
  const encrypt = async (value: string) =>
    toBase64(
      new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, encoder.encode(value)),
      ),
    );
  return { username: await encrypt(username), secret: await encrypt(password), iv: toBase64(iv) };
}

/** Reverses `sealCredential`. Throws if the row was written for another account. */
export async function openCredential(
  key: CryptoKey,
  accountId: string,
  sealed: SealedCredential,
): Promise<{ username: string; password: string }> {
  const iv = fromBase64(sealed.iv);
  const additionalData = encoder.encode(accountId);
  const decrypt = async (value: string) =>
    decoder.decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData }, key, fromBase64(value) as BufferSource),
    );
  try {
    return { username: await decrypt(sealed.username), password: await decrypt(sealed.secret) };
  } catch {
    throw new Error("The stored credential could not be decrypted with the configured key.");
  }
}
