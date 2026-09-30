/**
 * The Feed tile's recent sample, taken once for everyone.
 *
 * Every visitor used to read the newest 300 notes from each fast relay
 * (measured 2026-09-30: 0.6 MB on snort, 3 MB on primal) and then ask our
 * server, in 3-7 requests, which of the authors are trusted: about 40 notes'
 * worth. The server already holds the trusted list (score-cards.ts), so it
 * takes the sample, keeps the notes by trusted people and hands those over
 * (shared/feed-sample.ts). The sample is as wide as it was; with Primal's
 * trending down it is the only source of the tile's posts.
 *
 * One sample serves everyone for FRESH_MS and nobody waits on a refresh
 * (shared-read.ts). A trusted list or relays we couldn't read are
 * `reached: false`, never "nobody posted". The notes are handed over signed;
 * the app checks the signatures, so nothing here has to be taken on trust.
 */
import type { RelayQuery } from "./score-cards";
import { createTrustedRead, RELAY_ANSWER_MS } from "./trusted-sample";
import { trustedNotes, FEED_SAMPLE_RELAYS, FEED_SAMPLE_WINDOW_SECS, FEED_SAMPLE_LIMIT, FEED_SAMPLE_TOP, type SampleNote } from "@shared/feed-sample";
import { TOP_LOOKUP_RELAYS } from "@shared/discover-samples";

/** Notes are "recent": a sample is reused for two minutes. */
export const FRESH_MS = 2 * 60 * 1000;
/** Past this a sample isn't recent any more; the app takes its own. */
export const KEEP_MS = 15 * 60 * 1000;
export const RETRY_MS = 30 * 1000;

export interface FeedSampleAnswer {
  reached: boolean;
  notes: SampleNote[];
}

export function createFeedSampleReader(opts: {
  /** Everyone the default lens trusts enough for Discover. */
  trusted: () => Promise<{ authors: string[]; reached: boolean }>;
  relays?: readonly string[];
  /** Where the most trusted people's last day is asked for. */
  topRelays?: readonly string[];
  query?: RelayQuery;
  now?: () => number;
}) {
  const shared = createTrustedRead<SampleNote>({
    requests: (nowSecs, trustedAuthors) => {
      const top = trustedAuthors.slice(0, FEED_SAMPLE_TOP.authors);
      return [
        { relays: opts.relays ?? FEED_SAMPLE_RELAYS, filter: { kinds: [1], since: nowSecs - FEED_SAMPLE_WINDOW_SECS, limit: FEED_SAMPLE_LIMIT } },
        // The most trusted people's last day, which the Feed tile also asked
        // the relays for: asked once here and handed over with the sample.
        ...(top.length > 0
          ? [{ relays: opts.topRelays ?? TOP_LOOKUP_RELAYS, filter: { kinds: [1], authors: top, since: nowSecs - (FEED_SAMPLE_TOP.windowSecs ?? 0), limit: FEED_SAMPLE_TOP.limit } }]
          : []),
      ];
    },
    pick: trustedNotes,
    trusted: opts.trusted,
    freshMs: FRESH_MS,
    keepMs: KEEP_MS,
    retryMs: RETRY_MS,
    readMs: RELAY_ANSWER_MS,
    query: opts.query,
    now: opts.now,
  });

  async function read(): Promise<FeedSampleAnswer> {
    const { reached, items } = await shared.read();
    return { reached, notes: items };
  }

  return { read };
}
