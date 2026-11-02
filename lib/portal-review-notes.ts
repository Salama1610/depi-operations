import { all, stmt, uid } from "@/lib/server";

// The quality team's thread on each portal gig (portal_gig_review_notes):
// every decision with its comment, every comment added on its own, and each
// new proof the student uploads, oldest first, so earlier comments are read
// next to new ones. Kept under the review's proof key (lib/domain/portal-review).

export type NoteKind = "decision" | "comment" | "new_proof";
export type ReviewNote = {
  kind: NoteKind;
  status: string | null;
  comment: string | null;
  created_at: string;
  author_name?: string | null;
};

// Entries written in the same millisecond keep the order they were written in:
// the id leads with the time and a running count, and the thread is read by
// time, then id.
let written = 0;
const noteId = () => `PGN-${String(Date.now()).padStart(14, "0")}-${String(++written % 1e6).padStart(6, "0")}-${uid().slice(-8)}`;

/** A statement adding one entry to a proof's thread. */
export function noteStmt(proofKey: string, portalGigId: string | null, kind: NoteKind, status: string | null, comment: string | null, author: string | null, at: string) {
  return stmt(
    "INSERT INTO portal_gig_review_notes(id,proof_key,portal_gig_id,kind,status,comment,author,created_at) VALUES(?,?,?,?,?,?,?,?)",
    noteId(), proofKey, portalGigId, kind, status, comment, author, at,
  );
}

/** The threads of these proofs, oldest entry first; the author's name only when asked for. */
export async function reviewNotes(keys: string[], withAuthors = true) {
  const out = new Map<string, ReviewNote[]>();
  const unique = [...new Set(keys.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    const rows = await all(
      `SELECT n.proof_key,n.kind,n.status,n.comment,n.created_at,u.name author_name
       FROM portal_gig_review_notes n LEFT JOIN users u ON u.id=n.author
       WHERE n.proof_key IN (${slice.map(() => "?").join(",")}) ORDER BY n.created_at,n.id`,
      ...slice,
    );
    for (const r of rows as any[]) {
      const note: ReviewNote = { kind: r.kind, status: r.status ?? null, comment: r.comment ?? null, created_at: r.created_at };
      if (withAuthors) note.author_name = r.author_name ?? null;
      out.set(r.proof_key, [...(out.get(r.proof_key) || []), note]);
    }
  }
  return out;
}
