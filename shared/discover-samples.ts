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
export interface SampleDef {
  kinds: readonly number[];
  /** How many events one relay is asked for. The app's own read asks the same. */
  limit: number;
  /** The most the server hands over (the newest). */
  max: number;
}

export const DISCOVER_SAMPLES = {
  // Long-form bodies are large (up to 33 KB each, measured), so the cap
  // matters here: 36 trusted articles were 145 KB compressed.
  articles: { kinds: [30023], limit: 40, max: 40 },
  events: { kinds: [31922, 31923], limit: 60, max: 120 },
  videos: { kinds: [21, 22, 34235, 34236], limit: 20, max: 40 },
} as const satisfies Record<string, SampleDef>;

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
