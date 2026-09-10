import type { Event } from "nostr-tools";

/**
 * Which store arrivals may bump a post's shown counts while it is on screen.
 *
 * The shown numbers start from a server count (Primal, or a relay count),
 * which already includes every interaction that existed when it was taken.
 * fetchInteractions then pulls that same history into the local store, and
 * the viewer's own like/repost/reply is counted by the action that made it —
 * so adding either again double-counts (reported: "like goes up by 2"). Only
 * a genuinely NEW interaction from someone else counts live.
 */
export type LiveStatsField = "replies" | "reposts" | "likes";

/** NIP-10: a marked "reply" e-tag points at the parent; unmarked, the last e-tag. */
export function isDirectReply(event: Pick<Event, "tags">, targetId: string): boolean {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) return false;
  const hasMarkers = eTags.some((t) => t[3] === "reply" || t[3] === "root" || t[3] === "mention");
  if (hasMarkers) return eTags.some((t) => t[1] === targetId && t[3] === "reply");
  return eTags[eTags.length - 1][1] === targetId;
}

export function liveStatsField(
  event: Event,
  targetId: string,
  viewerPubkey: string | null | undefined,
  onScreenSince: number,
): LiveStatsField | null {
  if (viewerPubkey && event.pubkey === viewerPubkey) return null;
  if (event.created_at < onScreenSince) return null;
  if (event.kind === 1) return isDirectReply(event, targetId) ? "replies" : null;
  if (event.kind === 6) return event.tags.some((t) => t[0] === "e" && t[1] === targetId) ? "reposts" : null;
  if (event.kind === 7) {
    const eTags = event.tags.filter((t) => t[0] === "e");
    return eTags[eTags.length - 1]?.[1] === targetId ? "likes" : null;
  }
  return null;
}
