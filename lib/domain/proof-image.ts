// A proof's fingerprint, so the same picture is recognised even when it is
// uploaded again under another link.
//
// Proofs on the portal are screenshots, or PDFs holding several screenshots.
// For each proof two things are kept:
// - sha256 of the file itself: the very same file, byte for byte;
// - for every picture in it (the image itself, or each JPEG inside a PDF), a
//   256-bit difference hash (dHash) of the picture shrunk to 17×16 grey
//   pixels, each bit saying whether a pixel is brighter than its right-hand
//   neighbour. A screenshot saved again, recompressed or resized keeps nearly
//   the same bits, so a small Hamming distance means the same picture.

export const DHASH_SIZE = 16;
/** Bits out of 256 that may differ for two pictures still to count as the same. */
export const SAME_PICTURE_DISTANCE = 16;
/** A picture in the proofs of this many different students is a template (a logo, a header), not proof. */
export const TEMPLATE_STUDENTS = 5;
/** Pictures smaller than this inside a PDF are icons and logos, not screenshots. */
const MIN_PDF_PICTURE = 200;
const MAX_PICTURES = 20;

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

/** The pictures' hashes of one proof, as stored (space separated). */
export function picturesOf(dhash: string | null | undefined) {
  return String(dhash || "").split(/\s+/).filter((h) => /^[0-9a-f]{64}$/.test(h));
}

export type ProofPrint = { portal_gig_id?: string; student?: string; proof_url: string; sha256: string | null; dhash: string | null };

/**
 * The gigs whose proofs share a picture with this one: the same file, or a
 * picture within SAME_PICTURE_DISTANCE bits. A picture that turns up in the
 * proofs of TEMPLATE_STUDENTS or more different students is a template and
 * does not count. Returns the matching prints, without the gig itself.
 */
export function samePicture(print: ProofPrint, others: ProofPrint[]) {
  const mine = picturesOf(print.dhash);
  const found = new Set<ProofPrint>();
  for (const o of others) if (o !== print && o.proof_url !== print.proof_url && print.sha256 && o.sha256 === print.sha256) found.add(o);
  for (const h of mine) {
    const hits = others.filter((o) => o !== print && o.proof_url !== print.proof_url && picturesOf(o.dhash).some((x) => hammingHex(h, x) <= SAME_PICTURE_DISTANCE));
    const students = new Set([print.student, ...hits.map((o) => o.student)].filter(Boolean));
    if (students.size >= TEMPLATE_STUDENTS) continue;
    for (const o of hits) found.add(o);
  }
  return [...found];
}

const asText = (bytes: Uint8Array, from: number, length: number) => {
  let s = "";
  for (let i = from; i < Math.min(bytes.length, from + length); i++) s += String.fromCharCode(bytes[i]);
  return s;
};

function indexOf(bytes: Uint8Array, needle: string, from: number) {
  const first = needle.charCodeAt(0);
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    if (bytes[i] !== first) continue;
    for (let k = 1; k < needle.length; k++) if (bytes[i + k] !== needle.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

export const isPdf = (bytes: Uint8Array) => asText(bytes, 0, 5) === "%PDF-";

/** The JPEG pictures stored inside a PDF, as their raw files. */
export function pdfJpegs(bytes: Uint8Array) {
  const out: Uint8Array[] = [];
  let at = 0;
  while (out.length < MAX_PICTURES * 2) {
    const tag = indexOf(bytes, "/DCTDecode", at);
    if (tag < 0) break;
    let start = indexOf(bytes, "stream", tag);
    if (start < 0) break;
    start += 6;
    while (bytes[start] === 13 || bytes[start] === 10) start++;
    const end = indexOf(bytes, "endstream", start);
    if (end < 0) break;
    // A JPEG starts FF D8; anything else (another filter on top) is skipped.
    if (bytes[start] === 0xff && bytes[start + 1] === 0xd8) out.push(bytes.subarray(start, end));
    at = end;
  }
  return out;
}

/** Fingerprints one proof file: a picture, or a PDF of pictures. Uses sharp, which ships with Next.js. */
export async function fingerprint(bytes: Uint8Array) {
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pdf = isPdf(bytes);
  const parts = pdf ? pdfJpegs(bytes) : [bytes];
  // The exact-file fingerprint is kept even if no picture can be decoded.
  try {
    const sharp = (await import("sharp")).default;
    const hashes: string[] = [];
    for (const part of parts) {
      if (hashes.length >= MAX_PICTURES) break;
      try {
        const img = sharp(part);
        const meta = await img.metadata();
        if (pdf && Math.min(meta.width || 0, meta.height || 0) < MIN_PDF_PICTURE) continue;
        const { data } = await img
          .grayscale()
          .resize(DHASH_SIZE + 1, DHASH_SIZE, { fit: "fill", kernel: "lanczos3" })
          .raw()
          .toBuffer({ resolveWithObject: true });
        hashes.push(dhashFromGrey(data));
      } catch {
        // One unreadable picture does not spoil the others.
      }
    }
    return { sha256, dhash: hashes.length ? [...new Set(hashes)].join(" ") : null, bytes: bytes.byteLength, ...(hashes.length ? {} : { error: pdf ? "No screenshot found in the PDF" : "Picture not decoded" }) };
  } catch (e: any) {
    return { sha256, dhash: null, bytes: bytes.byteLength, error: "Picture not decoded: " + String(e?.message || e).slice(0, 80) };
  }
}
