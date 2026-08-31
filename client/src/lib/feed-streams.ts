/**
 * Feed stream posts — plain kind-1 notes carrying a raw HLS (.m3u8) URL,
 * the way IPTV-style channels actually broadcast on Nostr (no kind-30311,
 * so the Live section's NIP-53 index never sees them).
 *
 * This module is the DECIDABLE half: find the URL, dedupe reposts, derive a
 * card title. Whether a stream is actually watchable is the server health
 * probe's call (hooks/use-stream-liveness), applied by the lane — a card is
 * shown only on a positive verified-live answer, never inferred from the
 * URL's shape (the old feed LIVE chip lied exactly that way).
 */
import type { Event } from "nostr-tools";
import type { LiveEventData } from "@/lib/live-events";

export interface FeedStreamPost {
  /** The note's event id (also the dedupe fallback + nevent payload). */
  id: string;
  pubkey: string;
  createdAt: number;
  /** The playable manifest URL — always https. */
  url: string;
  /** Card title from the post's words (never the URL). */
  title: string;
  event: Event;
}

/**
 * The first https .m3u8 URL in a post's text. Plain-http manifests are
 * refused on purpose: browsers block them as mixed content and the stream
 * proxy refuses them, so surfacing one claims a stream nobody can watch.
 */
export function extractStreamUrl(content: string): string | undefined {
  const m = content.match(/https:\/\/[^\s<>"']+\.m3u8(?:\?[^\s<>"']*)?/i);
  return m ? m[0] : undefined;
}

/** First line of the post that isn't a URL, else an honest generic. */
function titleOf(content: string): string {
  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/https?:\/\/[^\s<>"']+/gi, "").trim();
    if (line) return line;
  }
  return "Live stream";
}

/**
 * Assemble the "from your feed" lane from raw notes: kind-1 only, one entry
 * per stream URL (a channel reposting the same stream keeps only the newest
 * note), newest first.
 */
/** dTag prefix that marks a synthesized feed-stream entry (see below). */
const FEED_STREAM_DTAG_PREFIX = "feedpost:";

/**
 * Dress a feed stream post as LiveEventData so the Live section's existing
 * card grid, liveness pipeline, and sorting handle it unchanged. The dTag
 * carries a recognizable prefix so SELECTION can route to the post detail
 * (/live/post/<nevent>) — encoding this coordinate as a real naddr would
 * mint a shareable URL to a kind-30311 that does not exist. Chat stays off:
 * there is no NIP-53 coordinate to chat against.
 */
export function toLiveEventData(post: FeedStreamPost): LiveEventData {
  return {
    id: post.id,
    pubkey: post.pubkey,
    dTag: `${FEED_STREAM_DTAG_PREFIX}${post.id}`,
    title: post.title,
    summary: "",
    streamUrl: post.url,
    hlsUrl: post.url,
    status: "live",
    hashtags: [],
    participants: [],
    relays: [],
    chatEnabled: false,
    isZapStream: false,
    event: post.event,
  };
}

/** Is this Live-section entry a synthesized feed stream post? */
export function isFeedStreamEntry(stream: Pick<LiveEventData, "dTag">): boolean {
  return stream.dTag.startsWith(FEED_STREAM_DTAG_PREFIX);
}

export function pickFeedStreams(events: readonly Event[]): FeedStreamPost[] {
  const byUrl = new Map<string, FeedStreamPost>();
  for (const e of events) {
    if (e.kind !== 1) continue;
    const url = extractStreamUrl(e.content ?? "");
    if (!url) continue;
    const prior = byUrl.get(url);
    if (prior && prior.createdAt >= e.created_at) continue;
    byUrl.set(url, {
      id: e.id,
      pubkey: e.pubkey,
      createdAt: e.created_at,
      url,
      title: titleOf(e.content ?? ""),
      event: e,
    });
  }
  return [...byUrl.values()].sort((a, b) => b.createdAt - a.createdAt);
}
