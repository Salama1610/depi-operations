// A proof screenshot's fingerprint, so the same picture is recognised even
// when it is uploaded again under another link.
//
// Two fingerprints are kept for each image:
// - sha256 of the file itself: the very same file, byte for byte;
// - a 256-bit difference hash (dHash) of the picture shrunk to 17×16 grey
//   pixels, each bit saying whether a pixel is brighter than its right-hand
//   neighbour. A screenshot saved again, recompressed or resized keeps nearly
//   the same bits, so a small Hamming distance means the same picture.

export const DHASH_SIZE = 16;
/** Bits out of 256 that may differ for two images still to count as the same picture. */
export const SAME_PICTURE_DISTANCE = 10;

/** The dHash of a grey image of (size+1) × size pixels, row by row, as 64 hex digits. */
export function dhashFromGrey(grey: ArrayLike<number>, size = DHASH_SIZE) {
  let hex = "";
  let nibble = 0;
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * (size + 1) + x;
      nibble = (nibble << 1) | (grey[i] > grey[i + 1] ? 1 : 0);
      if (++count % 4 === 0) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  }
  return hex;
}

const bitsIn = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Hamming distance between two hex dHashes of the same length. */
export function hammingHex(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += bitsIn[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

export type ProofPrint = { proof_url: string; sha256: string | null; dhash: string | null };

/**
 * Which other proofs show the same picture as this one: the same file, or a
 * dHash within SAME_PICTURE_DISTANCE bits. `others` excludes nothing; the
 * caller drops the row itself.
 */
export function samePicture(print: ProofPrint, others: ProofPrint[]) {
  if (!print.sha256 && !print.dhash) return [];
  return others.filter(
    (o) =>
      o.proof_url !== print.proof_url &&
      ((print.sha256 && o.sha256 === print.sha256) ||
        (print.dhash && o.dhash && hammingHex(print.dhash, o.dhash) <= SAME_PICTURE_DISTANCE)),
  );
}

/** Fingerprints one image file. Uses sharp, which ships with Next.js, to decode it. */
export async function fingerprint(bytes: Uint8Array) {
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // The exact-file fingerprint is kept even if the picture cannot be decoded.
  try {
    const sharp = (await import("sharp")).default;
    const { data } = await sharp(bytes)
      .grayscale()
      .resize(DHASH_SIZE + 1, DHASH_SIZE, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { sha256, dhash: dhashFromGrey(data), bytes: bytes.byteLength };
  } catch (e: any) {
    return { sha256, dhash: null, bytes: bytes.byteLength, error: "Picture not decoded: " + String(e?.message || e).slice(0, 80) };
  }
}
