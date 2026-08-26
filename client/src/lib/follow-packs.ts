import type { Event } from "nostr-tools";
import { pool, fetchProfilesCached } from "@/lib/nostr";

export const KIND_FOLLOW_PACK = 39089;

export const DISCOVERY_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://nostr-01.yakihonne.com",
  "wss://purplepag.es",
];

const DISCOVERY_CACHE_TTL = 5 * 60 * 1000;

export interface FollowPackInfo {
  id: string;
  pubkey: string;
  title: string;
  description: string;
  image?: string;
  members: string[];
  createdAt: number;
  event: Event;
}

export function parseFollowPack(event: Event): FollowPackInfo | null {
  const title = event.tags.find(t => t[0] === "title")?.[1];
  if (!title) return null;
  const description = event.tags.find(t => t[0] === "description")?.[1] || "";
  const image = event.tags.find(t => t[0] === "image")?.[1];
  const members = event.tags.filter(t => t[0] === "p" && t[1]).map(t => t[1]);
  if (members.length === 0) return null;
  return { id: event.id, pubkey: event.pubkey, title, description, image, members, createdAt: event.created_at, event };
}

export function queryWithTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export function getSessionCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > DISCOVERY_CACHE_TTL) {
      sessionStorage.removeItem(key);
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

export function setSessionCache<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export async function fetchDiscoveryPacks(): Promise<FollowPackInfo[]> {
  const cached = getSessionCache<FollowPackInfo[]>("search_discovery_packs");
  if (cached && cached.length > 0) return cached;

  const packEvents = await queryWithTimeout(
    pool.querySync(DISCOVERY_RELAYS, { kinds: [KIND_FOLLOW_PACK], limit: 150 }),
    6000,
    [] as Event[],
  );

  const parsed = packEvents.map(parseFollowPack).filter((p): p is FollowPackInfo => p !== null);
  const unique = Array.from(new Map(parsed.map(p => [`${p.pubkey}:${p.title.toLowerCase()}`, p])).values());
  const sorted = unique.sort((a, b) => b.members.length - a.members.length).slice(0, 50);

  setSessionCache("search_discovery_packs", sorted);

  const pks = sorted.flatMap(p => [p.pubkey, ...p.members.slice(0, 3)]);
  if (pks.length > 0) fetchProfilesCached(pks);

  return sorted;
}
