/**
 * Discover's broad samples, taken once for everyone.
 *
 * Every visitor used to read the newest articles, events and videos from
 * each fast relay (measured 2026-09-30: 981 KB, 118 KB and 132 KB) and then
 * ask this server which of the authors are trusted. The server holds the
 * trusted list, so it takes each sample, keeps the events by trusted people
 * and hands those over (shared/discover-samples.ts). Each sample asks the
 * relays exactly what the app's own read asks.
 *
 * One read serves everyone for FRESH_MS and nobody waits on a refresh
 * (shared-read.ts). A trusted list or relays we couldn't read are
 * `reached: false`, never "nothing was posted". Events are handed over
 * signed; the app checks the signatures.
 */
import { queryRelay, type RelayQuery } from "./score-cards";
import { createSharedRead } from "./shared-read";
import { FEED_SAMPLE_RELAYS } from "@shared/feed-sample";
import { DISCOVER_SAMPLES, trustedSample, type DiscoverSampleName, type SignedEvent } from "@shared/discover-samples";

/** Articles, events and videos move slowly: a sample is reused for five minutes. */
export const FRESH_MS = 5 * 60 * 1000;
/** Past this the app takes its own sample rather than show an old one as newest. */
export const KEEP_MS = 60 * 60 * 1000;
export const RETRY_MS = 30 * 1000;
/** The app's own read gives the relays 11 s; most answer in 1-2 s. */
const READ_MS = 11_000;

export interface SampleAnswer {
  reached: boolean;
  events: SignedEvent[];
}

/**
 * One relay read, cut down to trusted people, shared by everyone.
 * `filter` is what each relay is asked; `pick` is what's kept of the answers.
 */
export function createTrustedRead<T>(opts: {
  relays: readonly string[];
  filter: (nowSecs: number) => Record<string, unknown>;
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
      const filter = opts.filter(Math.floor(now() / 1000));
      const answers = await Promise.all(
        opts.relays.map((r) =>
          Promise.resolve()
            .then(() => query(r, filter, opts.readMs))
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
  relays?: readonly string[];
  query?: RelayQuery;
  now?: () => number;
}) {
  const names = Object.keys(DISCOVER_SAMPLES) as DiscoverSampleName[];
  const reads = new Map(names.map((name) => {
    const def = DISCOVER_SAMPLES[name];
    return [name, createTrustedRead<SignedEvent>({
      relays: opts.relays ?? FEED_SAMPLE_RELAYS,
      filter: () => ({ kinds: [...def.kinds], limit: def.limit }),
      pick: (events, trusted) => trustedSample(events, trusted, def),
      trusted: opts.trusted,
      freshMs: FRESH_MS,
      keepMs: KEEP_MS,
      retryMs: RETRY_MS,
      readMs: READ_MS,
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
