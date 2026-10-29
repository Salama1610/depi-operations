// A proof screenshot uploaded twice under two links is still one picture:
// the fingerprints must match it, and must tell two different screenshots apart.
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { dhashFromGrey, fingerprint, hammingHex, samePicture, SAME_PICTURE_DISTANCE } from "../lib/domain/proof-image.ts";

/** A made-up screenshot: a few coloured bars and a block, as an image of `kind`. */
async function screenshot(variant, kind = "jpeg", quality = 90, width = 900) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
    <rect width="900" height="600" fill="#f4f6fb"/>
    <rect x="40" y="40" width="${variant === "b" ? 300 : 820}" height="70" fill="#315ce8"/>
    <rect x="40" y="150" width="520" height="40" fill="#69768f"/>
    <rect x="${variant === "b" ? 600 : 40}" y="230" width="260" height="300" fill="#ef5a12"/>
    <circle cx="${variant === "b" ? 200 : 700}" cy="380" r="110" fill="#2f8a73"/>
  </svg>`;
  const img = sharp(Buffer.from(svg)).resize(width);
  return new Uint8Array(await (kind === "png" ? img.png() : img.jpeg({ quality })).toBuffer());
}

test("the difference hash reads brighter-than-the-next-pixel, 256 bits as 64 hex digits", () => {
  const size = 16;
  const grey = Array.from({ length: (size + 1) * size }, (_, i) => (i % (size + 1)) * 10);
  assert.equal(dhashFromGrey(grey), "0".repeat(64), "each pixel darker than its neighbour");
  const falling = grey.map((v) => 255 - v);
  assert.equal(dhashFromGrey(falling), "f".repeat(64));
  assert.equal(hammingHex("0f", "00"), 4);
  assert.equal(hammingHex("ab", "abc"), Infinity);
});

test("one screenshot saved again, smaller or recompressed, is the same picture", async () => {
  const original = await fingerprint(await screenshot("a", "jpeg", 92));
  const again = await fingerprint(await screenshot("a", "jpeg", 55, 640));
  const asPng = await fingerprint(await screenshot("a", "png"));
  const other = await fingerprint(await screenshot("b"));
  assert.notEqual(original.sha256, again.sha256, "the files differ byte for byte");
  assert.ok(hammingHex(original.dhash, again.dhash) <= SAME_PICTURE_DISTANCE, "but the picture is the same");
  assert.ok(hammingHex(original.dhash, asPng.dhash) <= SAME_PICTURE_DISTANCE);
  assert.ok(hammingHex(original.dhash, other.dhash) > SAME_PICTURE_DISTANCE * 3, "a different screenshot is far apart");
  const prints = [
    { proof_url: "u1", ...original },
    { proof_url: "u2", ...again },
    { proof_url: "u3", ...other },
  ];
  assert.deepEqual(samePicture(prints[0], prints).map((p) => p.proof_url), ["u2"]);
  assert.deepEqual(samePicture(prints[2], prints), []);
});
