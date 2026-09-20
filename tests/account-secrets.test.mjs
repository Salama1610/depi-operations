// Marketplace credentials must be unreadable in the database and bound to the
// account they belong to, so a row copied from one account onto another fails
// rather than revealing the wrong login.
import test from "node:test";
import assert from "node:assert/strict";
import {
  credentialKey,
  credentialKeyConfigured,
  openCredential,
  sealCredential,
} from "../lib/domain/account-secrets.ts";

const KEY = "b".repeat(64);

test("a key is required, and must be 32 bytes of hexadecimal", async () => {
  assert.equal(credentialKeyConfigured(KEY), true);
  assert.equal(credentialKeyConfigured(undefined), false);
  assert.equal(credentialKeyConfigured(""), false);
  assert.equal(credentialKeyConfigured("short"), false);
  assert.equal(credentialKeyConfigured("z".repeat(64)), false);
  await assert.rejects(credentialKey("nope"), /CREDENTIAL_ENCRYPTION_KEY/);
});

test("a stored credential reveals nothing and comes back intact", async () => {
  const key = await credentialKey(KEY);
  const username = "depi.kafeel.07@example.invalid";
  const password = "a-real-looking-secret-42";
  const sealed = await sealCredential(key, "ACC-7", username, password);

  const stored = JSON.stringify(sealed);
  assert.ok(!stored.includes(username), "the username must not be readable in the stored row");
  assert.ok(!stored.includes(password), "the password must not be readable in the stored row");
  assert.ok(!stored.includes("example.invalid"));

  const opened = await openCredential(key, "ACC-7", sealed);
  assert.deepEqual(opened, { username, password });
});

test("the same credential encrypts differently every time", async () => {
  const key = await credentialKey(KEY);
  const a = await sealCredential(key, "ACC-7", "same", "same-password");
  const b = await sealCredential(key, "ACC-7", "same", "same-password");
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.secret, b.secret, "a repeated password must not produce a repeated ciphertext");
});

test("a credential cannot be opened for the wrong account or the wrong key", async () => {
  const key = await credentialKey(KEY);
  const sealed = await sealCredential(key, "ACC-7", "user", "password-1");
  await assert.rejects(openCredential(key, "ACC-8", sealed), /could not be decrypted/);
  const otherKey = await credentialKey("c".repeat(64));
  await assert.rejects(openCredential(otherKey, "ACC-7", sealed), /could not be decrypted/);
});

test("unicode credentials survive the round trip", async () => {
  const key = await credentialKey(KEY);
  const username = "حساب@example.invalid";
  const password = "كلمة-المرور-٩٩";
  const sealed = await sealCredential(key, "ACC-9", username, password);
  assert.deepEqual(await openCredential(key, "ACC-9", sealed), { username, password });
});
