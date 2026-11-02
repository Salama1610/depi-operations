"use client";

// Our quality team's thread on a portal gig: each decision with its comment,
// each comment added on its own and each new proof the student uploaded,
// oldest first, so the earlier comments are read next to the new ones.

import { useLocale, useT } from "@/lib/i18n/context";

type Note = { kind: string; status?: string | null; comment?: string | null; created_at: string; author_name?: string | null };

export function QcThread({ notes, className = "" }: { notes?: Note[] | null; className?: string }) {
  const t = useT();
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  if (!notes?.length) return null;
  const label = (n: Note) =>
    n.kind === "new_proof"
      ? t("New proof uploaded")
      : n.kind === "comment"
        ? t("Comment")
        : n.status === "Pending"
          ? t("Back to waiting for review")
          : t(n.status || "Comment");
  const tone = (n: Note) =>
    n.kind === "decision" && n.status === "Approved" ? "is-ok" : n.kind === "decision" && n.status === "Rejected" ? "is-bad" : "is-info";
  return (
    <ol className={"qc-thread " + className} aria-label={t("Quality comments")}>
      {notes.map((n, i) => (
        <li key={i} className={"qc-note " + tone(n)}>
          <small className="qc-note-head">
            <strong>{label(n)}</strong>
            {" · "}
            {new Date(n.created_at).toLocaleString(tag, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}
            {n.author_name ? " · " + n.author_name : ""}
          </small>
          {n.comment && <p className="wrap-text">{n.comment}</p>}
        </li>
      ))}
    </ol>
  );
}
