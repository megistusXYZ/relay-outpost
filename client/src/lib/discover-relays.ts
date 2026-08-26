/**
 * Discover relay pool — the set of relays the Discover feed samples from, so
 * content comes from across nostr rather than a single provider's cache.
 *
 * NIP-66 monitor events (kind 30166) describe relay *capabilities*, not a clean
 * activity count, so we start from a curated SEED of known free, native-nostr
 * relays (immediately available, no fetch) and asynchronously AUGMENT it with
 * relays discovered from the monitors — everything passing through
 * `rankCuratedRelays` (excludes bridges/mirrors + paid + wrong-language). The
 * seed guarantees a good pool on first paint; the augmentation broadens it.
 */
import { throttledPoolSubscribe } from "./nostr";
import { rankCuratedRelays, parseNip66Event, normalizeRelayUrl, type RelayCandidate } from "./relay-discovery";

const MONITOR_RELAYS = ["wss://relaypag.es", "wss://monitorlizard.nostr1.com"];
const CACHE_KEY = "ro_discover_relays_v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
// The NIP-66 warm fetch discovers HUNDREDS of healthy relays; keeping a large
// ranked pool (rather than re-clamping to a dozen) is what makes For You feel
// alive. The per-subscription cap (preset-driven, see discover-quality.ts) is
// what actually bounds how many we open at once, so a big pool here is cheap.
export const DISCOVER_POOL_SIZE = 40;

// Curated free, native-nostr relays with broad, diverse coverage. Activity here
// is a stable ordering weight (descending), not a live count. Kept free-only.
const SEED: RelayCandidate[] = [
  { url: "wss://relay.damus.io", activity: 100, free: true },
  { url: "wss://nos.lol", activity: 95, free: true },
  { url: "wss://relay.primal.net", activity: 92, free: true },
  { url: "wss://relay.nostr.band", activity: 88, free: true },
  { url: "wss://relay.snort.social", activity: 80, free: true },
  { url: "wss://nostr.land", activity: 70, free: true },
  { url: "wss://offchain.pub", activity: 66, free: true },
  { url: "wss://nostr.mom", activity: 60, free: true },
  { url: "wss://nostr.oxtr.dev", activity: 55, free: true },
  { url: "wss://relayable.org", activity: 52, free: true },
  { url: "wss://nostr.data.haus", activity: 48, free: true },
  { url: "wss://nostr.bitcoiner.social", activity: 44, free: true },
  { url: "wss://relay.nostrplebs.com", activity: 40, free: true },
  { url: "wss://purplerelay.com", activity: 36, free: true },
];

let cached: { urls: string[]; ts: number } | null = null;
let inflight: Promise<string[]> | null = null;

function readCache(): string[] | null {
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.urls;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.urls) && Date.now() - parsed.ts < CACHE_TTL_MS) {
        cached = parsed;
        return parsed.urls;
      }
    }
  } catch {}
  return null;
}

/** Synchronous pool: cached augmented set if fresh, else the curated seed. */
export function getDiscoverRelayPool(langs: string[]): string[] {
  const c = readCache();
  if (c && c.length) return c;
  return rankCuratedRelays(SEED, { langs, limit: DISCOVER_POOL_SIZE }).map((r) => r.url);
}

/**
 * Background: fetch NIP-66 monitor events, merge discovered native/free relays
 * with the seed, rank, and cache. Safe to call repeatedly (deduped + TTL-gated).
 */
export function warmDiscoverRelays(langs: string[]): Promise<string[]> {
  const fresh = readCache();
  if (fresh && fresh.length) return Promise.resolve(fresh);
  if (inflight) return inflight;

  inflight = new Promise<string[]>((resolve) => {
    const byUrl = new Map<string, RelayCandidate>();
    // Seed first so discovered duplicates don't override the curated ordering.
    for (const s of SEED) byUrl.set(normalizeRelayUrl(s.url), s);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { (sub as any)?.close?.(); } catch {}
      const ranked = rankCuratedRelays(Array.from(byUrl.values()), { langs, limit: DISCOVER_POOL_SIZE });
      const urls = ranked.map((r) => r.url).filter((u) => /^wss?:\/\//i.test(u));
      cached = { urls, ts: Date.now() };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cached)); } catch {}
      inflight = null;
      resolve(urls);
    };

    const sub = throttledPoolSubscribe(MONITOR_RELAYS, { kinds: [30166], limit: 600 }, {
      onevent(ev: any) {
        const parsed = parseNip66Event(ev);
        if (!parsed) return;
        const key = normalizeRelayUrl(parsed.url);
        if (byUrl.has(key)) return; // seed / earlier discovery wins
        // Discovered relays get a modest activity weight below the seed, biased
        // by how many NIPs they support (a rough capability signal).
        byUrl.set(key, {
          url: parsed.url,
          activity: 10 + (parsed.supportedNips?.length ?? 0),
          free: parsed.free,
          software: parsed.software,
          supportedNips: parsed.supportedNips,
        });
      },
      oneose() { finish(); },
    });

    setTimeout(finish, 8000);
  });

  return inflight;
}

export interface DiscoverBlendInput {
  /** FAST base feed relays (always first — the reliable spine). */
  base: string[];
  /** A capped slice of follows' outbox (write) relays. Folded when foldOutbox. */
  outbox?: string[];
  /** Joined-community (outpost) + curated group relays. Folded when foldCommunity. */
  community?: string[];
  /** Curated + NIP-66-discovered, language-ranked pool. */
  discover: string[];
  cap: number;
  foldOutbox: boolean;
  foldCommunity: boolean;
}

/**
 * Pure relay blend: FAST base → follows' outbox → community → curated-discover,
 * deduped by normalized URL, then capped. Higher-quality-by-default sources
 * (your follows' own relays, communities you joined) come before the broad
 * discover pool so they aren't crowded out of the cap. Breadth scales with the
 * preset via which sources are folded and how large the cap is. Exported pure
 * for tests.
 */
export function blendDiscoverRelays(input: DiscoverBlendInput): string[] {
  const { base, outbox = [], community = [], discover, cap, foldOutbox, foldCommunity } = input;
  const ordered = [
    ...base,
    ...(foldOutbox ? outbox : []),
    ...(foldCommunity ? community : []),
    ...discover,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of ordered) {
    if (!url) continue;
    const key = normalizeRelayUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * The relay set a Discover subscription should use: base feed relays broadened
 * with the curated pool (and, when `opts` folds them, follows' outbox +
 * community relays), deduped and capped. When Discover is off, returns base.
 */
export function getDiscoverFeedRelays(
  baseRelays: string[],
  enabled: boolean,
  langs: string[],
  cap = 10,
  opts?: { outbox?: string[]; community?: string[]; foldOutbox?: boolean; foldCommunity?: boolean },
): string[] {
  if (!enabled) return baseRelays;
  return blendDiscoverRelays({
    base: baseRelays,
    outbox: opts?.outbox,
    community: opts?.community,
    discover: getDiscoverRelayPool(langs),
    cap,
    foldOutbox: opts?.foldOutbox ?? false,
    foldCommunity: opts?.foldCommunity ?? false,
  });
}
