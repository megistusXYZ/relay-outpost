import type { Event } from "nostr-tools";
import { registerProfileInAllCaches, isProfileCached } from "./nostr";

export interface BrainstormHit {
  id: string;
  pubkey: string;
  npub: string;
  name: string;
  display_name: string;
  displayName: string;
  username: string;
  nip05: string;
  about: string;
  picture: string;
  banner: string;
  lud16: string;
  lud06: string;
  website: string;
  created_at: number;
  wot_rank: number | undefined;
  wot_followers: number | undefined;
}

interface BrainstormResponse {
  hits: BrainstormHit[];
  estimatedTotalHits: number;
  processingTimeMs: number;
  error?: string;
}

function brainstormHitToKind0Event(hit: BrainstormHit): Event {
  const content = JSON.stringify({
    name: hit.name || "",
    display_name: hit.display_name || hit.displayName || "",
    about: hit.about || "",
    picture: hit.picture || "",
    banner: hit.banner || "",
    nip05: hit.nip05 || "",
    lud16: hit.lud16 || "",
    lud06: hit.lud06 || "",
    website: hit.website || "",
  });

  return {
    id: hit.id || hit.pubkey,
    pubkey: hit.pubkey,
    kind: 0,
    content,
    tags: [],
    created_at: hit.created_at || Math.floor(Date.now() / 1000),
    sig: "",
  } as Event;
}

export function brainstormWotToInfluence(wotRank: number | undefined): number | null {
  if (wotRank === undefined || wotRank === null) return null;
  return wotRank / 100;
}

export async function discoverByTopic(topic: string, limit: number = 20): Promise<{ events: Event[]; wotScores: Map<string, number | null> }> {
  const events: Event[] = [];
  const wotScores = new Map<string, number | null>();

  try {
    const res = await fetch(`/api/brainstorm/discover?topic=${encodeURIComponent(topic)}&limit=${limit}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: BrainstormResponse = await res.json();

    if (data.error || !data.hits) return { events, wotScores };

    for (const hit of data.hits) {
      if (!hit.pubkey) continue;
      const event = brainstormHitToKind0Event(hit);
      registerProfileInAllCaches(event);
      events.push(event);
      wotScores.set(hit.pubkey, brainstormWotToInfluence(hit.wot_rank));
    }
  } catch {}

  return { events, wotScores };
}

const _prefetchedPubkeys = new Set<string>();

export function prefetchProfileFromBrainstorm(pubkey: string): void {
  if (!pubkey || _prefetchedPubkeys.has(pubkey)) return;
  _prefetchedPubkeys.add(pubkey);

  fetch(`/api/brainstorm/profile/${pubkey}`, {
    signal: AbortSignal.timeout(4000),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data: { hit?: BrainstormHit } | null) => {
      if (!data?.hit || !data.hit.pubkey) return;
      if (isProfileCached(data.hit.pubkey)) return;
      const event = brainstormHitToKind0Event(data.hit);
      registerProfileInAllCaches(event);
    })
    .catch(() => {
      _prefetchedPubkeys.delete(pubkey);
    });
}

let _bulkInFlight = false;

export function prefetchProfilesBulkFromBrainstorm(pubkeys: string[]): void {
  if (pubkeys.length === 0 || _bulkInFlight) return;
  const uncached = pubkeys.filter(pk => pk && !_prefetchedPubkeys.has(pk));
  if (uncached.length === 0) return;

  const batch = uncached.slice(0, 50);
  _bulkInFlight = true;
  for (const pk of batch) _prefetchedPubkeys.add(pk);

  fetch("/api/brainstorm/profiles-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkeys: batch }),
    signal: AbortSignal.timeout(6000),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data: { profiles?: BrainstormHit[] }) => {
      if (!data?.profiles) return;
      for (const hit of data.profiles) {
        if (!hit.pubkey || isProfileCached(hit.pubkey)) continue;
        const event = brainstormHitToKind0Event(hit);
        registerProfileInAllCaches(event);
      }
    })
    .catch(() => {
      for (const pk of batch) _prefetchedPubkeys.delete(pk);
    })
    .finally(() => {
      _bulkInFlight = false;
    });
}

let _batchCooldownUntil = 0;
let _batchLastSuccessAt = 0;
let _batchLastFailAt = 0;
let _batchLastError = "";

// Per-pubkey in-flight de-dupe so overlapping callers (prewarm + the bulk queue,
// or two threads sharing authors) never re-fetch the same key concurrently.
const _inflightByPubkey = new Map<string, Promise<Map<string, number>>>();
const WOT_CHUNK = 50;        // ≤ server input cap; one upstream batch
const WOT_CHUNK_CONCURRENCY = 4; // chunks in flight at once (bounds load on busy threads)

export type BrainstormBatchEvent =
  | { type: "cooldown"; until: number; at: number; error: string }
  | { type: "success"; at: number };

const _batchListeners = new Set<(e: BrainstormBatchEvent) => void>();

export function onBrainstormBatchEvent(cb: (e: BrainstormBatchEvent) => void): () => void {
  _batchListeners.add(cb);
  return () => { _batchListeners.delete(cb); };
}

function emitBatchEvent(e: BrainstormBatchEvent) {
  _batchListeners.forEach((cb) => { try { cb(e); } catch {} });
}

export function getBrainstormBatchStatus() {
  return {
    cooldownUntil: _batchCooldownUntil,
    lastSuccessAt: _batchLastSuccessAt,
    lastFailAt: _batchLastFailAt,
    lastError: _batchLastError,
  };
}

export function clearBrainstormBatchCooldown() {
  _batchCooldownUntil = 0;
}

// Fetch one chunk (≤ WOT_CHUNK pubkeys) via the server batch proxy.
async function fetchWotChunk(chunk: string[]): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  try {
    const res = await fetch("/api/brainstorm/wot-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkeys: chunk }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { scores: Record<string, number> } = await res.json();
    if (data.scores) {
      for (const [pk, val] of Object.entries(data.scores)) {
        if (typeof val === "number") scores.set(pk, val);
      }
    }
    _batchLastSuccessAt = Date.now();
    emitBatchEvent({ type: "success", at: _batchLastSuccessAt });
  } catch (err: any) {
    // Soft cooldown: a transient failure pauses batching briefly instead of
    // blocking every batch for 30s. Other in-flight chunks are unaffected.
    _batchCooldownUntil = Date.now() + 8000;
    _batchLastFailAt = Date.now();
    _batchLastError = err?.message || "Batch request failed";
    emitBatchEvent({ type: "cooldown", until: _batchCooldownUntil, at: _batchLastFailAt, error: _batchLastError });
  }
  return scores;
}

// Score any number of pubkeys: de-dupe in-flight keys, chunk the rest, run chunks
// with bounded concurrency, and merge. No 30-cap drop, no single-flight that
// strands later authors on the slow per-author path.
export async function fetchBrainstormWotBatch(pubkeys: string[]): Promise<Map<string, number>> {
  if (pubkeys.length === 0) return new Map();
  if (Date.now() < _batchCooldownUntil) return new Map();

  const unique = Array.from(new Set(pubkeys));
  const watched = new Set<Promise<Map<string, number>>>();
  const need: string[] = [];
  for (const pk of unique) {
    const existing = _inflightByPubkey.get(pk);
    if (existing) watched.add(existing);
    else need.push(pk);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < need.length; i += WOT_CHUNK) chunks.push(need.slice(i, i + WOT_CHUNK));

  // Concurrency-limited chunk runner. Register each chunk's promise per-pubkey
  // BEFORE awaiting so a concurrent call reuses it instead of double-fetching.
  let next = 0;
  const startNext = (): Promise<void> => {
    if (next >= chunks.length) return Promise.resolve();
    const chunk = chunks[next++];
    const cp = fetchWotChunk(chunk);
    const cleanup = () => { for (const pk of chunk) if (_inflightByPubkey.get(pk) === cp) _inflightByPubkey.delete(pk); };
    cp.then(cleanup, cleanup);
    for (const pk of chunk) _inflightByPubkey.set(pk, cp);
    watched.add(cp);
    return cp.then(() => startNext());
  };
  await Promise.all(
    Array.from({ length: Math.min(WOT_CHUNK_CONCURRENCY, chunks.length) }, () => startNext()),
  );

  const merged = new Map<string, number>();
  for (const m of await Promise.all(Array.from(watched))) {
    m.forEach((v, k) => merged.set(k, v));
  }
  return merged;
}

export async function lookupProfileDirect(pubkey: string): Promise<{ event: Event | null; wotScore: number | null }> {
  try {
    const res = await fetch(`/api/brainstorm/profile/${encodeURIComponent(pubkey)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { event: null, wotScore: null };
    const data: { hit?: BrainstormHit } | null = await res.json();
    if (!data?.hit || !data.hit.pubkey) return { event: null, wotScore: null };
    const event = brainstormHitToKind0Event(data.hit);
    registerProfileInAllCaches(event);
    return { event, wotScore: brainstormWotToInfluence(data.hit.wot_rank) };
  } catch {
    return { event: null, wotScore: null };
  }
}

export async function searchBrainstorm(query: string, limit: number = 20): Promise<{ events: Event[]; wotScores: Map<string, number | null> }> {
  const events: Event[] = [];
  const wotScores = new Map<string, number | null>();

  try {
    const res = await fetch(`/api/brainstorm/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: BrainstormResponse = await res.json();

    if (data.error || !data.hits) return { events, wotScores };

    for (const hit of data.hits) {
      if (!hit.pubkey) continue;
      const event = brainstormHitToKind0Event(hit);
      registerProfileInAllCaches(event);
      events.push(event);
      wotScores.set(hit.pubkey, brainstormWotToInfluence(hit.wot_rank));
    }
  } catch {}

  return { events, wotScores };
}
