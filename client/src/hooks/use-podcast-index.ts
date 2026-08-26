// React-query hooks over the server-side Podcast Index proxy (+ the generic RSS
// proxy for episode previews). Every request stays in-app; the server holds the
// SHA-1 API auth. Hooks expose typed data + loading/error state.
import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  buildResolveUrl,
  buildSearchUrl,
  buildTrendingUrl,
  buildTrendSuggestionsUrl,
  clampMax,
  matchPresetShow,
  mergeDedupeById,
  PODCAST_CATEGORIES,
  PRESET_SHOWS,
  type PodcastCategory,
  type PodcastEpisode,
  type PodcastFeed,
  type TrendSuggestionItem,
} from "@/lib/podcast-index";

interface FeedsResponse {
  feeds: PodcastFeed[];
  count: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Whether the Podcast Index API keys are configured server-side. */
export function usePodcastStatus() {
  const q = useQuery({
    queryKey: ["/api/podcastindex/status"],
    queryFn: () => fetchJson<{ configured: boolean }>("/api/podcastindex/status"),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  return { configured: q.data?.configured ?? null, isLoading: q.isLoading };
}

/**
 * Trending feeds for a category (or Top when `cat` is null). `max` drives the
 * in-dialog "Load more" — raising it re-fetches a longer list and the caller
 * de-dupes by id.
 */
export function usePodcastTrending(cat: string | null, max: number, enabled = true) {
  const safeMax = clampMax(max, 10, 50);
  const q = useQuery({
    queryKey: ["/api/podcastindex/trending", cat ?? "top", safeMax],
    queryFn: () => fetchJson<FeedsResponse>(buildTrendingUrl(cat, safeMax)),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    // Keep the current page visible while "Load more" raises max (no flash).
    placeholderData: (prev) => prev,
  });
  return {
    feeds: q.data?.feeds ?? [],
    count: q.data?.count ?? 0,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
  };
}

/**
 * Resolve a preset pill's curated show list against the LIVE index. Each show's
 * `searchTerm` goes through the long-TTL server resolve proxy (one query per
 * show, cached for the session via staleTime: Infinity) and the pure
 * {@link matchPresetShow} matcher picks the real feed — ids, artwork and URLs
 * are never hardcoded. Shows the index doesn't return are silently dropped
 * (never a dead card).
 */
export function usePresetShows(pillKey: string | null, enabled = true) {
  const shows = (pillKey && PRESET_SHOWS[pillKey]) || [];
  const results = useQueries({
    queries: shows.map((s) => ({
      queryKey: ["/api/podcastindex/resolve", s.searchTerm.toLowerCase()],
      queryFn: () => fetchJson<FeedsResponse>(buildResolveUrl(s.searchTerm)),
      enabled,
      // Session-stable: preset resolutions don't churn while the app is open.
      staleTime: Infinity,
      retry: 1,
    })),
  });
  const isLoading = enabled && shows.length > 0 && results.some((r) => r.isLoading);
  // Cheap enough to recompute per render (≤7 shows × ≤10 results) — a useMemo
  // would need a variable-length deps array, which React warns about.
  const matched: PodcastFeed[] = [];
  shows.forEach((show, i) => {
    const data = results[i]?.data;
    if (!data?.feeds?.length) return;
    const feed = matchPresetShow(show, data.feeds);
    if (feed) matched.push(feed);
  });
  return { feeds: mergeDedupeById([], matched), isLoading };
}

/**
 * "Rising now" trend suggestions for a category (null/"" = global). Errors and
 * empty histories surface as an empty list so callers can skip the row
 * silently (also when Podcast Index isn't configured — the endpoint 503s and
 * we swallow it via the empty default).
 */
export function useTrendSuggestions(cat: string | null, limit: number, enabled = true) {
  const q = useQuery({
    queryKey: ["/api/podcastindex/trend-suggestions", cat ?? "top", limit],
    queryFn: () => fetchJson<{ suggestions: TrendSuggestionItem[] }>(buildTrendSuggestionsUrl(cat, limit)),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 0,
  });
  // Only suggestions with hydrated feed metadata render as cards.
  const suggestions = useMemo(
    () => (q.data?.suggestions ?? []).filter((s): s is TrendSuggestionItem & { feed: PodcastFeed } => !!s.feed),
    [q.data],
  );
  return { suggestions, isLoading: q.isLoading };
}

/** Podcast search by term. Disabled until the query is ≥ 2 chars. */
export function usePodcastSearch(query: string, max: number, enabled = true) {
  const q = query.trim();
  const safeMax = clampMax(max, 20, 40);
  const result = useQuery({
    queryKey: ["/api/podcastindex/search", q.toLowerCase(), safeMax],
    queryFn: () => fetchJson<FeedsResponse>(buildSearchUrl(q, safeMax)),
    enabled: enabled && q.length >= 2,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    placeholderData: (prev) => prev,
  });
  return {
    feeds: result.data?.feeds ?? [],
    count: result.data?.count ?? 0,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    isError: result.isError,
    searched: result.isFetched,
  };
}

/**
 * Full category catalog. Seeds from the static list for instant UX and refreshes
 * from the server; falls back to the static list on any error.
 */
export function usePodcastCategories(enabled = true) {
  const q = useQuery({
    queryKey: ["/api/podcastindex/categories"],
    queryFn: () => fetchJson<{ categories: PodcastCategory[]; count: number }>("/api/podcastindex/categories"),
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });
  const categories = q.data?.categories?.length ? q.data.categories : PODCAST_CATEGORIES;
  return { categories, isLoading: q.isLoading, isError: q.isError };
}

// The generic RSS proxy item shape (only the fields the preview needs).
interface RssProxyItem {
  title?: string;
  link?: string;
  guid?: string;
  description?: string;
  pubDate?: string;
  author?: string;
  thumbnail?: string;
  audioUrl?: string;
  duration?: number;
  transcriptUrl?: string;
  transcriptType?: string;
  chaptersUrl?: string;
}
interface RssProxyResponse {
  title?: string;
  image?: string;
  items?: RssProxyItem[];
}

/**
 * Episodes for a feed's preview, via the shared `/api/rss` proxy (which already
 * parses durations). Returns typed {@link PodcastEpisode}s.
 */
export function usePodcastPreview(feed: PodcastFeed | null, limit = 8) {
  const url = feed?.url ?? "";
  const q = useQuery({
    queryKey: ["/api/rss", url],
    queryFn: () => fetchJson<RssProxyResponse>(`/api/rss?url=${encodeURIComponent(url)}`),
    enabled: !!url,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const episodes: PodcastEpisode[] = (q.data?.items ?? []).slice(0, limit).map((it, i) => ({
    id: it.guid || it.link || `${url}-${i}`,
    title: it.title || "Untitled Episode",
    audioUrl: it.audioUrl,
    pubDate: it.pubDate,
    duration: it.duration,
    description: it.description,
    thumbnail: it.thumbnail,
    link: it.link,
    transcriptUrl: it.transcriptUrl || undefined,
    transcriptType: it.transcriptType || undefined,
    chaptersUrl: it.chaptersUrl || undefined,
  }));
  return {
    episodes,
    feedTitle: q.data?.title ?? feed?.title ?? "",
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
