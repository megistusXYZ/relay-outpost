/**
 * Trending pool for the Discover "People to follow" strip — the FALLBACK
 * source (DISCOVER_BENTO_PLAN.md round 2, decision 16). Friends-of-follows
 * ranks first and comes from useFollowsOfFollows; this only fills what's left
 * for sparse accounts and guests.
 *
 * Same recipe as Search's PeopleTab trending list (fetchTrendingFeed → unique
 * authors → prefetch kind-0s), but under its OWN session-cache key: sharing
 * Search's `search_trending_profiles_v1` would couple two modules on a cache
 * shape neither owns, and the failure mode of that coupling is silent (one
 * side changes what it stores, the other keeps reading it). One extra Primal
 * call per session is the cheaper bill.
 */
import { fetchTrendingFeed } from "@/lib/primal-cache";
import { fetchProfilesCached } from "@/lib/nostr";
import { getSessionCache, setSessionCache } from "@/lib/follow-packs";

const CACHE_KEY = "discover_people_trending_v1";

/**
 * Unique author pubkeys from the trending feed, newest-first order preserved
 * (Primal's curation IS the ranking). Kind-0 prefetch is fired, not awaited —
 * the strip resolves profiles with the store-poll pattern and drops whoever
 * never resolves, so there is nothing to wait on here.
 *
 * Works signed-out. Returns [] on failure — the strip is additive content,
 * not a door: starved of candidates it renders nothing, which is why this
 * fetcher deliberately does NOT carry a Reached<> (nothing here ever claims
 * "nothing new"; absence of the strip claims nothing at all).
 */
export async function fetchTrendingAuthors(limit = 24): Promise<string[]> {
  const cached = getSessionCache<string[]>(CACHE_KEY);
  if (cached && cached.length > 0) return cached.slice(0, limit);
  try {
    const posts = await fetchTrendingFeed("trending_4h", undefined, 30);
    const seen = new Set<string>();
    const authors: string[] = [];
    for (const p of posts) {
      if (!seen.has(p.pubkey)) {
        seen.add(p.pubkey);
        authors.push(p.pubkey);
      }
    }
    if (authors.length > 0) {
      setSessionCache(CACHE_KEY, authors);
      try { fetchProfilesCached(authors.slice(0, limit)); } catch { /* resolves via store-poll */ }
    }
    return authors.slice(0, limit);
  } catch {
    return [];
  }
}
