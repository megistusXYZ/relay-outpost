/**
 * Games (webxdc apps) in group chats, as Armada attaches them: a `.xdc` file
 * whose imeta carries a display name (`summary`), the shared session id
 * (`webxdc`) and, for a published game, a plain icon link (`thumb`). Relay
 * Outpost can't run them yet, so they show as a card that says so, rather than
 * a bare link and a download. Pure.
 */
import { isEncrypted, type ConcordMedia } from "./concord-media";

/** What a game's card shows: its name, and an icon only when it's safe to load. */
export function gameCard(m: ConcordMedia): { name: string; icon: string | undefined } {
  const name = m.summary?.trim() || m.name?.replace(/\.xdc$/i, "").trim() || "Game";
  // An encrypted attachment's thumb is ciphertext (Armada skips it too), and
  // only an https link is loaded: nothing that could run, nothing mixed.
  let icon: string | undefined;
  if (m.thumb && !isEncrypted(m)) {
    try { if (new URL(m.thumb).protocol === "https:") icon = m.thumb; } catch { /* not a link */ }
  }
  return { name, icon };
}

export const WEBXDC_MIME = "application/vnd.webxdc+zip";

/** A game attachment: the webxdc type, or a .xdc name when the sender used a generic type. */
export function isGame(m: ConcordMedia): boolean {
  return m.mime === WEBXDC_MIME || /\.xdc$/i.test(m.name ?? "");
}

/**
 * A message's text without the link that only repeats an attached game's own
 * link (Armada puts the .xdc URL in the text too), so the card isn't shadowed
 * by a raw link. Only an exact, standalone match goes; other links stay.
 */
export function withoutGameLinks(content: string, media: ConcordMedia[] | undefined): string {
  const links = (media ?? []).filter(isGame).map((m) => m.url).filter(Boolean);
  if (links.length === 0) return content;
  let out = content;
  for (const link of links) {
    const escaped = link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"), "$1");
  }
  return out.split("\n").map((line) => line.replace(/[ \t]+$/, "")).join("\n").replace(/[ \t]{2,}/g, " ").trim();
}
