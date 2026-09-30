/**
 * The Feed tile's recent sample.
 *
 * Discover's Feed tile shows three posts by highly trusted people. One of its
 * sources is a wide sample: the newest notes from anyone on the fast relays,
 * checked against the whole trusted list. Every visitor took that sample
 * themselves: 300 notes per relay (measured 2026-09-30: 0.6 MB on snort, 3 MB
 * on primal), about 40 of them by trusted people, plus 3-7 score lookups to
 * find out which. With Primal's trending down, those ~40 were the only source
 * of the tile's posts, so the sample can't simply be made smaller.
 *
 * The server takes the sample once for everyone and keeps the trusted part
 * (server/feed-sample.ts). The app takes it itself only when the server can't
 * answer, or when the viewer's own trust map decides who's trusted.
 */
import { isSignedEvent, SAMPLE_RELAYS, type SignedEvent, type TopLookup } from "./discover-samples";

/** The app's FAST_RELAYS without damus (a test keeps the two in step). */
export const FEED_SAMPLE_RELAYS = SAMPLE_RELAYS;
export const FEED_SAMPLE_WINDOW_SECS = 6 * 3600;
/** How many notes one relay is asked for. */
export const FEED_SAMPLE_LIMIT = 300;
/**
 * The most trusted people's last day, which the Feed tile also asked the
 * relays for; the server asks once and it rides along with the sample
 * (see `SampleDef.top` in discover-samples.ts).
 */
export const FEED_SAMPLE_TOP: TopLookup = { authors: 300, limit: 150, windowSecs: 24 * 3600 };
/**
 * The most the server hands over (measured: ~100 trusted notes in a sample,
 * plus a dozen from the most trusted people's last day). Roomy on purpose:
 * the tile ranks by engagement, so an older note must not be cut for age.
 */
export const FEED_SAMPLE_MAX_NOTES = 300;

export type SampleNote = SignedEvent;

/** A well-formed signed kind-1 note (the signature itself is checked by whoever shows it). */
export function isNote(x: unknown): x is SampleNote {
  return isSignedEvent(x, [1]);
}

/** The sample's notes by trusted people: one copy each, newest first. */
export function trustedNotes(events: readonly unknown[], trusted: ReadonlySet<string>): SampleNote[] {
  const byId = new Map<string, SampleNote>();
  for (const e of events) {
    if (!isNote(e) || !trusted.has(e.pubkey) || byId.has(e.id)) continue;
    byId.set(e.id, { id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig });
  }
  return [...byId.values()].sort((a, b) => b.created_at - a.created_at).slice(0, FEED_SAMPLE_MAX_NOTES);
}
