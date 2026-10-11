// A WhatsApp group invite, found in whatever was pasted.
//
// A phone copies more than the link: WhatsApp's "Share link" adds a sentence
// around it, "Copy link" adds "?mode=…" at the end, and pasting into a
// right-to-left (Arabic) page can slip invisible direction marks into the
// text. The invite code is found wherever it sits and the clean link is
// rebuilt from it.

/** Direction marks and zero-width characters a paste can carry. */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿ ]/g;

/**
 * The clean invite link ("https://chat.whatsapp.com/<code>") found in the
 * text, or a wa.me link, or null when there is neither.
 */
export function whatsappInvite(text: unknown): string | null {
  const plain = String(text ?? "").replace(INVISIBLE, "").trim();
  const group = plain.match(/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,64})/i);
  if (group) return "https://chat.whatsapp.com/" + group[1];
  const direct = plain.match(/wa\.me\/([0-9]{6,15})/i);
  if (direct) return "https://wa.me/" + direct[1];
  return null;
}
