/**
 * People search through NosFabrica's NIP-50 relay (search.brainstorm.world).
 *
 * The relay ranks kind-0 profiles through an observer's web of trust: the
 * signed-in viewer's own (first use queues a GrapeRank run for them on
 * NosFabrica's side, and the relay falls back to its default observer
 * meanwhile), and DEFAULT_LENS for anyone signed out.
 * It replaced the Meili HTTP API on brainstorm.world, which on 2026-09-28
 * began answering with its web app's HTML.
 *
 * Reach-honest: a relay we couldn't connect to returns `reached: false`, so
 * callers never tell someone "no people found" when nobody was asked.
 */
import type { Event, Filter } from "nostr-tools";
import type { Reached } from "./relay-reach";

export const PEOPLE_SEARCH_RELAY = "wss://search.brainstorm.world";

const HEX64 = /^[0-9a-f]{64}$/;

// Whose web of trust ranks for anyone signed out (shared with the server's
// score cards; owner call, 2026-09-28).
import { DEFAULT_LENS } from "@shared/default-lens";
export { DEFAULT_LENS };
const MAX_LIMIT = 100;

/** Who is signed in, so searches rank through their own web of trust. */
let viewer: string | null = null;
export function setPeopleSearchViewer(pubkey: string | null): void {
  viewer = pubkey;
}

/**
 * What we send. Tokens the relay treats as instructions (`observer:`,
 * `include:`, `sort:`, `filter:`) are stripped from typed text: whose trust
 * ranks a search is ours to say, not something a query string can override.
 */
export function peopleSearchFilter(query: string, observer: string | null, limit: number): Filter | null {
  const words = query
    .split(/\s+/)
    .filter((w) => w && !/^(observer|include|sort|filter):/i.test(w))
    .join(" ");
  if (!words) return null;
  const lens = observer && HEX64.test(observer) ? observer : DEFAULT_LENS;
  const search = `${words} observer:${lens}`;
  return { kinds: [0], search, limit: Math.max(1, Math.min(MAX_LIMIT, limit)) };
}

export interface PeopleSearchDeps {
  reach: (relay: string) => Promise<boolean>;
  query: (relay: string, filter: Filter) => Promise<Event[]>;
}

async function defaultDeps(): Promise<PeopleSearchDeps> {
  const [{ canReachRelay }, { pool }] = await Promise.all([import("./relay-reach"), import("./nostr")]);
  return {
    reach: (relay) => canReachRelay(relay, 4_000),
    query: (relay, filter) => pool.querySync([relay], filter, { maxWait: 5_000 }),
  };
}

export async function searchPeopleRanked(
  query: string,
  limit: number,
  observer: string | null = viewer,
  deps?: PeopleSearchDeps,
): Promise<Reached<Event[]>> {
  const filter = peopleSearchFilter(query, observer, limit);
  if (!filter) return { data: [], reached: true };
  const d = deps ?? (await defaultDeps());
  if (!(await d.reach(PEOPLE_SEARCH_RELAY))) return { data: [], reached: false };
  const events = await d.query(PEOPLE_SEARCH_RELAY, filter);
  // The relay's order IS the ranking; keep it, one result per person.
  const seen = new Set<string>();
  const data = events.filter((e) => e.kind === 0 && !seen.has(e.pubkey) && (seen.add(e.pubkey), true));
  return { data, reached: true };
}
