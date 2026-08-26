import { pool } from "@/lib/nostr";
import { LIVE_STREAM_RELAYS, KIND_LIVE_EVENT } from "@/lib/nostr-helpers";
import { parseLiveEvent } from "@/lib/live-events";
import type { LiveEventData } from "@/lib/live-events";

export interface SubscribedCreator {
  pubkey: string;
  subscribedAt: number;
}

interface CachedCreatorStreams {
  streams: SerializedStream[];
  fetchedAt: number;
  creatorSetHash?: string;
}

interface SerializedStream {
  pubkey: string;
  dTag: string;
  title: string;
  summary: string;
  image?: string;
  starts?: number;
  ends?: number;
  status: string;
  hashtags: string[];
  eventId: string;
  eventCreatedAt: number;
}

const SUBSCRIPTIONS_PREFIX = "relay-outpost-creator-subs";
const CACHE_PREFIX = "relay-outpost-creator-streams-cache";
const CACHE_TTL = 30 * 60 * 1000;

function subscriptionsKey(pubkey: string): string {
  return `${SUBSCRIPTIONS_PREFIX}:${pubkey}`;
}

function cacheKey(pubkey: string): string {
  return `${CACHE_PREFIX}:${pubkey}`;
}

export function getSubscribedCreators(pubkey: string): SubscribedCreator[] {
  try {
    const raw = localStorage.getItem(subscriptionsKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function subscribeCreator(myPubkey: string, creatorPubkey: string): void {
  const current = getSubscribedCreators(myPubkey);
  if (current.some((c) => c.pubkey === creatorPubkey)) return;
  current.push({ pubkey: creatorPubkey, subscribedAt: Date.now() });
  localStorage.setItem(subscriptionsKey(myPubkey), JSON.stringify(current));
}

export function unsubscribeCreator(myPubkey: string, creatorPubkey: string): void {
  const current = getSubscribedCreators(myPubkey);
  const filtered = current.filter((c) => c.pubkey !== creatorPubkey);
  localStorage.setItem(subscriptionsKey(myPubkey), JSON.stringify(filtered));
}

export function isCreatorSubscribed(myPubkey: string, creatorPubkey: string): boolean {
  return getSubscribedCreators(myPubkey).some((c) => c.pubkey === creatorPubkey);
}

function serializeStream(stream: LiveEventData): SerializedStream {
  return {
    pubkey: stream.pubkey,
    dTag: stream.dTag,
    title: stream.title,
    summary: stream.summary,
    image: stream.image,
    starts: stream.starts,
    ends: stream.ends,
    status: stream.status,
    hashtags: stream.hashtags,
    eventId: stream.id,
    eventCreatedAt: stream.event.created_at,
  };
}

export interface CreatorStreamItem {
  pubkey: string;
  dTag: string;
  title: string;
  summary: string;
  image?: string;
  starts?: number;
  ends?: number;
  status: string;
  hashtags: string[];
  eventId: string;
  eventCreatedAt: number;
}

function deserializeStream(s: SerializedStream): CreatorStreamItem {
  return { ...s };
}

interface CacheResult {
  streams: CreatorStreamItem[] | null;
  isStale: boolean;
}

function creatorSetHash(pubkeys: string[]): string {
  return [...pubkeys].sort().join(",");
}

function getCachedStreams(pubkey: string, currentCreatorPubkeys: string[]): CacheResult {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey));
    if (!raw) return { streams: null, isStale: false };
    const parsed: CachedCreatorStreams = JSON.parse(raw);
    const streams = parsed.streams.map(deserializeStream);
    const age = Date.now() - parsed.fetchedAt;
    const setChanged = parsed.creatorSetHash !== creatorSetHash(currentCreatorPubkeys);
    const isStale = age > CACHE_TTL || setChanged;
    return { streams, isStale };
  } catch {
    return { streams: null, isStale: false };
  }
}

function setCachedStreams(pubkey: string, streams: CreatorStreamItem[], creatorPubkeys: string[]): void {
  try {
    const data: CachedCreatorStreams = {
      streams: streams as SerializedStream[],
      fetchedAt: Date.now(),
      creatorSetHash: creatorSetHash(creatorPubkeys),
    };
    localStorage.setItem(cacheKey(pubkey), JSON.stringify(data));
  } catch {}
}

async function fetchStreamsFromNetwork(creatorPubkeys: string[]): Promise<CreatorStreamItem[] | null> {
  if (creatorPubkeys.length === 0) return [];

  const QUERY_TIMEOUT = 8000;

  try {
    const events = await Promise.race([
      pool.querySync(LIVE_STREAM_RELAYS, {
        kinds: [KIND_LIVE_EVENT],
        authors: creatorPubkeys,
        limit: 200,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), QUERY_TIMEOUT)
      ),
    ]);

    const latestByKey = new Map<string, typeof events[0]>();
    for (const event of events) {
      const key = `${event.pubkey}:${event.tags.find((t) => t[0] === "d")?.[1] || event.id}`;
      const existing = latestByKey.get(key);
      if (!existing || event.created_at > existing.created_at) {
        latestByKey.set(key, event);
      }
    }

    const streams: CreatorStreamItem[] = [];
    for (const event of latestByKey.values()) {
      const parsed = parseLiveEvent(event);
      if (!parsed) continue;
      if (parsed.status !== "planned" && parsed.status !== "live") continue;
      streams.push(serializeStream(parsed));
    }

    return streams;
  } catch (err) {
    if ((err as Error).message !== "timeout") {
      console.error("[creator-subs] Failed to fetch streams:", err);
    }
    return null;
  }
}

export async function fetchSubscribedCreatorStreams(
  myPubkey: string,
  forceRefresh?: boolean,
  onBackgroundRefresh?: () => void,
): Promise<CreatorStreamItem[]> {
  const creators = getSubscribedCreators(myPubkey);
  if (creators.length === 0) return [];

  const creatorPubkeys = creators.map((c) => c.pubkey);
  const cache = getCachedStreams(myPubkey, creatorPubkeys);

  if (!forceRefresh && cache.streams && !cache.isStale) {
    return cache.streams.filter((s) => creatorPubkeys.includes(s.pubkey));
  }

  if (!forceRefresh && cache.streams && cache.isStale) {
    fetchStreamsFromNetwork(creatorPubkeys)
      .then((fresh) => {
        if (fresh) {
          setCachedStreams(myPubkey, fresh, creatorPubkeys);
          if (onBackgroundRefresh) onBackgroundRefresh();
        }
      })
      .catch(() => {});
    return cache.streams.filter((s) => creatorPubkeys.includes(s.pubkey));
  }

  const streams = await fetchStreamsFromNetwork(creatorPubkeys);
  if (streams) {
    setCachedStreams(myPubkey, streams, creatorPubkeys);
    return streams;
  }
  return cache.streams?.filter((s) => creatorPubkeys.includes(s.pubkey)) || [];
}
