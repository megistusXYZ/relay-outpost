/**
 * Sensitive-content (NIP-36 `content-warning`) helpers, shared by the media
 * renderer and the feed post card so both gate the same way off the same
 * per-session reveal ledger.
 *
 * Policy: a `content-warning`-tagged event is blurred when the user's
 * "sensitiveContent" setting is anything but "show" (default = hide). Reveal is
 * per-session (in-memory set, keyed by a caller-chosen id) — nothing is removed,
 * only gated behind one tap.
 */
import type { Event } from "nostr-tools";

/** The content-warning reason for an event, or null when it carries no tag. */
export function getContentWarning(event: Event): string | null {
  const tag = event.tags.find((t) => t[0] === "content-warning");
  if (!tag) return null;
  return tag[1] || "Sensitive Content";
}

/** true = blur sensitive content (default); false = the user chose "show". */
export function getSensitiveContentSetting(): boolean {
  try {
    return localStorage.getItem("sensitiveContent") !== "show";
  } catch {
    return true;
  }
}

const cwRevealedSet = new Set<string>();

/** Has the given key been revealed this session? */
export function isCwRevealed(key: string): boolean {
  return cwRevealedSet.has(key);
}

/** Mark a key revealed for the rest of this session. */
export function markCwRevealed(key: string): void {
  cwRevealedSet.add(key);
}
