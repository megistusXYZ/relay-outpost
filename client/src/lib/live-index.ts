/**
 * Who is live, indexed by the pubkeys a reader would ask about.
 *
 * Two bugs lived in the inline version of this, and both made the answer "no"
 * for the common case.
 *
 * ONE — IT ASKED THE WRONG PERSON. The index was keyed on `event.pubkey`, the
 * AUTHOR of the kind-30311. But `live-events.ts` says plainly, in its own
 * docstring, that the author is often a publishing platform (zap.stream,
 * streamstr.net) and the human streamer is the participant tagged
 * `["p", <pubkey>, <relay?>, "host"]`. So the only profile that could ever light
 * up was the PLATFORM's, and every person who streams through one — which is
 * most of them — appeared offline on their own page while visibly broadcasting.
 *
 * TWO — IT KEPT ONE STREAM PER AUTHOR. Kind 30311 is ADDRESSABLE: its identity
 * is author + `d`, not author. Deduping by author alone meant a platform
 * account hosting forty concurrent streams collapsed to whichever arrived last,
 * silently discarding thirty-nine live broadcasts. Those are exactly the streams
 * the fix above needs, so the two bugs hid each other: fixing host indexing
 * without this would still surface one streamer per platform.
 *
 * Pure and node-testable on purpose. Liveness is decided by tag semantics, and
 * tag semantics can be checked without a relay.
 */
import type { LiveEventData } from "@/lib/live-events";
import { getStreamHosts } from "@/lib/live-events";

/** The addressable identity of a kind-30311: author + `d`. Never author alone. */
export function streamKey(stream: Pick<LiveEventData, "pubkey" | "dTag">): string {
  return `${stream.pubkey}:${stream.dTag}`;
}

/**
 * Newest event per ADDRESS, so concurrent streams from one platform all survive.
 *
 * A later `created_at` for the same address is an update to that stream (title
 * change, viewer count, going offline), not a different one.
 */
export function dedupeByAddress(streams: LiveEventData[]): LiveEventData[] {
  const best = new Map<string, LiveEventData>();
  for (const s of streams) {
    const k = streamKey(s);
    const prior = best.get(k);
    if (!prior || s.event.created_at > prior.event.created_at) best.set(k, s);
  }
  return [...best.values()];
}

/**
 * Every pubkey for whom this stream should read as "they are live".
 *
 * The hosts, and the author. The author is included because a platform account
 * genuinely is broadcasting, and because a self-hosted stream — the case where
 * author and host are the same person — must keep working when no `host`
 * participant is tagged at all. `getStreamHosts` already falls back to the
 * author in that case; the Set makes the overlap harmless.
 */
export function claimantsOf(stream: LiveEventData): string[] {
  return [...new Set([stream.pubkey, ...getStreamHosts(stream)])].filter(Boolean);
}

/**
 * Build the lookup a profile asks: pubkey → the stream to show.
 *
 * When one person fronts several live streams at once, the newest wins the slot
 * — a profile shows one "live now", and the most recently started is the one
 * they are most likely on.
 */
export function indexLiveByPubkey(streams: LiveEventData[]): Map<string, LiveEventData> {
  const byPubkey = new Map<string, LiveEventData>();
  for (const stream of dedupeByAddress(streams)) {
    for (const who of claimantsOf(stream)) {
      const prior = byPubkey.get(who);
      if (!prior || stream.event.created_at > prior.event.created_at) byPubkey.set(who, stream);
    }
  }
  return byPubkey;
}
