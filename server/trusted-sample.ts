/**
 * Discover's broad samples, taken once for everyone.
 *
 * Every visitor used to read the newest articles, events and videos from
 * each fast relay (measured 2026-09-30: 981 KB, 118 KB and 132 KB) and then
 * ask this server which of the authors are trusted. The server holds the
 * trusted list, so it takes each sample, keeps the events by trusted people
 * and hands those over (shared/discover-samples.ts). With each sample go the
 * most trusted people's own posts of that kind, which every tile also asked
 * the relays for (256 KB of keys uploaded per visitor for 41 KB of answers,
 * measured). Each sample asks the relays exactly what the app's own reads ask.
 *
 * One read serves everyone for FRESH_MS and nobody waits on a refresh
 * (shared-read.ts). A trusted list or relays we couldn't read are
 * `reached: false`, never "nothing was posted". Events are handed over
 * signed; the app checks the signatures.
 */
import { queryRelay, type RelayQuery } from "./score-cards";
import { createSharedRead } from "./shared-read";
import { DISCOVER_SAMPLES, SAMPLE_RELAYS, TOP_LOOKUP_RELAYS, sampleRequests, trustedSample, type DiscoverSampleName, type SampleDef, type SignedEvent } from "@shared/discover-samples";

/** Articles, events and videos move slowly: a sample is reused for five minutes. */
export const FRESH_MS = 5 * 60 * 1000;
/** Past this the app takes its own sample rather than show an old one as newest. */
export const KEEP_MS = 60 * 60 * 1000;
export const RETRY_MS = 30 * 1000;
/**
 * How long one relay gets to answer. The read waits for every relay, so this
 * is how long a silent one can hold it. Measured 2026-09-30: relays that
 * answer do so in 0.6-2.7 s; damus accepted the connection and never
 * answered, and with the 11 s the app's own read allows, the first read
 * outlasted ROUTE_WAIT_MS and every visitor got a 503.
 */
export const RELAY_ANSWER_MS = 4_000;
/** How long a sample route holds a visitor for a first read before saying it can't answer. */
export const ROUTE_WAIT_MS = 6_000;

export interface SampleAnswer {
  reached: boolean;
  events: SignedEvent[];
}

/**
 * One set of relay reads, cut down to trusted people, shared by everyone.
 * `requests` is what the relays are asked (given the trusted list, highest
 * first, so a read can ask for the most trusted people's own posts); `pick`
 * is what's kept of the answers.
 */
export function createTrustedRead<T>(opts: {
  requests: (nowSecs: number, trustedAuthors: readonly string[]) => { relays: readonly string[]; filter: Record<string, unknown> }[];
  pick: (events: unknown[], trusted: ReadonlySet<string>) => T[];
  /** Everyone the default lens trusts enough for Discover. */
  trusted: () => Promise<{ authors: string[]; reached: boolean }>;
  freshMs: number;
  keepMs: number;
  retryMs: number;
  readMs: number;
  query?: RelayQuery;
  now?: () => number;
}) {
  const query = opts.query ?? queryRelay;
  const now = opts.now ?? Date.now;
  return createSharedRead<T>({
    freshMs: opts.freshMs,
    keepMs: opts.keepMs,
    retryMs: opts.retryMs,
    now,
    read: async () => {
      const list = await opts.trusted();
      if (!list.reached) return { reached: false, items: [] };
      const asks = opts.requests(Math.floor(now() / 1000), list.authors)
        .flatMap(({ relays, filter }) => relays.map((relay) => ({ relay, filter })));
      const answers = await Promise.all(
        asks.map(({ relay, filter }) =>
          Promise.resolve()
            .then(() => query(relay, filter, opts.readMs))
            .catch(() => ({ reached: false, answered: false, events: [] as any[] })),
        ),
      );
      const events = answers.flatMap((a) => a.events);
      // A relay cut off mid-answer still sent real events.
      const reached = events.length > 0 || answers.some((a) => a.answered);
      return { reached, items: opts.pick(events, new Set(list.authors)) };
    },
  });
}

export function createDiscoverSampleReader(opts: {
  trusted: () => Promise<{ authors: string[]; reached: boolean }>;
  /** Where the broad reads go. */
  relays?: readonly string[];
  /** Where the most trusted people's own posts are asked for. */
  topRelays?: readonly string[];
  query?: RelayQuery;
  now?: () => number;
}) {
  const relays = { broad: opts.relays ?? SAMPLE_RELAYS, top: opts.topRelays ?? TOP_LOOKUP_RELAYS };
  const names = Object.keys(DISCOVER_SAMPLES) as DiscoverSampleName[];
  const reads = new Map(names.map((name) => {
    const def: SampleDef = DISCOVER_SAMPLES[name];
    return [name, createTrustedRead<SignedEvent>({
      requests: (nowSecs, trustedAuthors) => sampleRequests(def, nowSecs, trustedAuthors, relays),
      pick: (events, trusted) => trustedSample(events, trusted, def),
      trusted: opts.trusted,
      freshMs: FRESH_MS,
      keepMs: KEEP_MS,
      retryMs: RETRY_MS,
      readMs: RELAY_ANSWER_MS,
      query: opts.query,
      now: opts.now,
    })] as const;
  }));

  async function read(name: DiscoverSampleName): Promise<SampleAnswer> {
    const { reached, items } = await reads.get(name)!.read();
    return { reached, events: items };
  }

  return { read };
}
