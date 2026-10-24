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
  return {
    starterCommunities: server?.starterCommunities?.length ? server.starterCommunities : fallback.starterCommunities,
    suggestedFeeds: server?.suggestedFeeds?.length ? server.suggestedFeeds : fallback.suggestedFeeds,
  };
}

/** The curated lists for a screen: the built-in ones at once, the server's when they arrive. */
export function useCuratedLists(): CuratedLists {
  const { data } = useQuery({
    queryKey: ["curated-lists"],
    queryFn: () => fetchCuratedLists(),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  return pickCurated(data ?? null);
}
