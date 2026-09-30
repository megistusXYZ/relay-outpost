/**
 * Discover's broad samples for Articles, Events and Videos.
 *
 * Each tile's pool starts with the newest of its kind from anyone on the
 * fast relays, checked against the trusted list. Every visitor took those
 * samples themselves (measured 2026-09-30: articles 981 KB across three
 * relays, events 118 KB, videos 132 KB) and then asked our server which
 * authors are trusted. The server holds the trusted list, so it takes each
 * sample once for everyone and keeps the trusted part
 * (server/trusted-sample.ts): 145 KB, 26 KB and 11 KB compressed when
 * measured. The Feed tile's sample works the same way (shared/feed-sample.ts).
 *
 * The app takes a sample itself only when the server can't answer, or when
 * the viewer's own trust map decides who's trusted.
 */
/** The fast relays without damus: where the broad reads go (damus budgets reads per IP). */
export const SAMPLE_RELAYS = ["wss://relay.snort.social", "wss://nostr.land", "wss://relay.primal.net"];
/**
 * Every fast relay: where the most trusted people's own posts are asked for.
 * Those answers are small (41 KB across five lookups, measured 2026-09-30),
 * so damus is asked too, as the app's own lookup asks it.
 */
export const TOP_LOOKUP_RELAYS = ["wss://relay.damus.io", ...SAMPLE_RELAYS];

/** The most trusted people's own posts: how many people, how many events, how far back. */
export interface TopLookup {
  authors: number;
  limit: number;
  /** Only events this recent. Absent: their newest, whenever. */
  windowSecs?: number;
}

export interface SampleDef {
  kinds: readonly number[];
  /**
   * The broad read: how many of the newest from anyone one relay is asked
   * for. Absent: the sample is only the top people's (Images).
   */
  limit?: number;
  /**
   * Every tile also asked the relays what the most trusted people posted.
   * That is the same question for every visitor on the default trust list
   * (256 KB of keys uploaded per visitor for 41 KB of answers, measured
   * 2026-09-30, and a wait of at least a second), so the server asks it
   * once and the answer rides along with the sample.
   */
  top: TopLookup;
  /** The most the server hands over (the newest). */
  max: number;
}

/** Each entry asks the relays exactly what the app's own reads ask (a test pins them). */
export const DISCOVER_SAMPLES = {
  // Long-form bodies are large (up to 33 KB each, measured), so the cap
  // matters here: 36 trusted articles were 145 KB compressed.
  articles: { kinds: [30023], limit: 40, top: { authors: 200, limit: 30 }, max: 40 },
  events: { kinds: [31922, 31923], limit: 60, top: { authors: 300, limit: 60 }, max: 120 },
  videos: { kinds: [21, 22, 34235, 34236], limit: 20, top: { authors: 200, limit: 20 }, max: 40 },
  // No broad read: a stranger's photo never reaches the front door.
  images: { kinds: [1, 20], top: { authors: 300, limit: 80, windowSecs: 24 * 3600 }, max: 80 },
} as const satisfies Record<string, SampleDef>;

/** What the relays are asked for one sample: the broad read, and the top people's own. */
export function sampleRequests(
  def: SampleDef,
  nowSecs: number,
  /** The trusted list, highest first. */
  trustedAuthors: readonly string[],
  relays: { broad: readonly string[]; top: readonly string[] } = { broad: SAMPLE_RELAYS, top: TOP_LOOKUP_RELAYS },
): { relays: readonly string[]; filter: Record<string, unknown> }[] {
  const out: { relays: readonly string[]; filter: Record<string, unknown> }[] = [];
  if (def.limit !== undefined) out.push({ relays: relays.broad, filter: { kinds: [...def.kinds], limit: def.limit } });
  const top = trustedAuthors.slice(0, def.top.authors);
  if (top.length > 0) {
    out.push({
      relays: relays.top,
      filter: {
        kinds: [...def.kinds],
        authors: top,
        ...(def.top.windowSecs !== undefined ? { since: nowSecs - def.top.windowSecs } : {}),
        limit: def.top.limit,
      },
    });
  }
  return out;
}

export type DiscoverSampleName = keyof typeof DISCOVER_SAMPLES;

export function isDiscoverSampleName(x: unknown): x is DiscoverSampleName {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(DISCOVER_SAMPLES, x);
}

export interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/** A well-formed signed event of one of `kinds` (the signature itself is checked by whoever shows it). */
export function isSignedEvent(x: unknown, kinds: readonly number[]): x is SignedEvent {
  const e = x as SignedEvent | null;
  return !!e && typeof e === "object"
    && typeof e.kind === "number" && kinds.includes(e.kind)
    && typeof e.id === "string" && HEX64.test(e.id)
    && typeof e.pubkey === "string" && HEX64.test(e.pubkey)
    && typeof e.sig === "string" && HEX128.test(e.sig)
    && typeof e.created_at === "number"
    && typeof e.content === "string"
    && Array.isArray(e.tags) && e.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === "string"));
}

/** Addressable kinds are replaced by a newer event with the same author, kind and `d`. */
function identity(e: SignedEvent): string {
  if (e.kind < 30000 || e.kind >= 40000) return e.id;
  return `${e.kind}:${e.pubkey}:${e.tags.find((t) => t[0] === "d")?.[1] ?? ""}`;
}

/** The sample's events by trusted people: newest version of each, newest first, capped. */
export function trustedSample(events: readonly unknown[], trusted: ReadonlySet<string>, def: SampleDef): SignedEvent[] {
  const newest = new Map<string, SignedEvent>();
  for (const e of events) {
    if (!isSignedEvent(e, def.kinds) || !trusted.has(e.pubkey)) continue;
    const key = identity(e);
    const prev = newest.get(key);
    if (prev && prev.created_at >= e.created_at) continue;
    newest.set(key, { id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig });
  }
  return [...newest.values()].sort((a, b) => b.created_at - a.created_at).slice(0, def.max);
}
