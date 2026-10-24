/**
 * Where the app's curated lists come from: the server's copy (/api/curated,
 * server/curated-route.ts) when it answered with entries, the built-in copy
 * (shared/curated-lists.ts) otherwise, list by list. Never an empty list
 * because the server couldn't be reached.
 */
import { useQuery } from "@tanstack/react-query";
import { CURATED_LISTS, parseCuratedLists, type CuratedLists } from "@shared/curated-lists";

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const SERVER_WAIT_MS = 5_000;

/** The server's lists, every entry checked; null when it didn't answer properly. */
export async function fetchCuratedLists(fetchImpl: FetchLike = fetch): Promise<Partial<CuratedLists> | null> {
  try {
    const res = await fetchImpl("/api/curated", { signal: AbortSignal.timeout(SERVER_WAIT_MS) });
    if (!res.ok) return null;
    return parseCuratedLists(await res.json());
  } catch {
    return null;
  }
}

/** List by list: the server's when it has entries, the built-in one when not. */
export function pickCurated(server: Partial<CuratedLists> | null, fallback: CuratedLists = CURATED_LISTS): CuratedLists {
  const list = <K extends keyof CuratedLists>(k: K): CuratedLists[K] => {
    const v = server?.[k];
    const has = Array.isArray(v) ? v.length > 0 : !!v && Object.keys(v).length > 0;
    return (has ? v : fallback[k]) as CuratedLists[K];
  };
  return {
    starterCommunities: list("starterCommunities"),
    suggestedFeeds: list("suggestedFeeds"),
    suggestedPeople: list("suggestedPeople"),
    channelSeedPosters: list("channelSeedPosters"),
    mutedSellers: list("mutedSellers"),
    podcastPills: list("podcastPills"),
    podcastShows: list("podcastShows"),
  };
}

/**
 * For code that isn't a screen (scoring, Discover's data): the latest lists
 * known, built-in until the server's arrive. A later failed fetch keeps them.
 */
let latest: CuratedLists = CURATED_LISTS;
export function rememberCurated(server: Partial<CuratedLists> | null): void {
  if (server) latest = pickCurated(server, latest);
}
export function curatedNow(): CuratedLists {
  return latest;
}

/** The curated lists for a screen: the built-in ones at once, the server's when they arrive. */
export function useCuratedLists(): CuratedLists {
  const { data } = useQuery({
    queryKey: ["curated-lists"],
    queryFn: async () => {
      const server = await fetchCuratedLists();
      rememberCurated(server);
      return server;
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  return pickCurated(data ?? null);
}
