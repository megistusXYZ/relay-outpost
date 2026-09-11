/**
 * What the Listen lane shows (News redesign, part 4). With shows you follow,
 * their new episodes. With none, what's trending in podcasting from Podcast
 * Index (never our own picks), or one plain line when Podcast Index can't
 * answer. See listen-view.test.ts.
 */
export type ListenView = "episodes" | "trending" | "loading" | "unavailable";

export interface ListenState {
  /** Shows in your library's Listen lane. */
  followedShows: number;
  /** Playable episodes gathered so far from those shows. */
  episodeCount: number;
  /** Some of those shows haven't answered yet. */
  episodesLoading: boolean;
  /** Whether the server has Podcast Index keys; null until it says. */
  podcastIndexConfigured: boolean | null;
  trendingLoading: boolean;
  trendingCount: number;
  trendingError: boolean;
}

export function listenView(state: ListenState): ListenView {
  if (state.followedShows > 0) {
    if (state.episodeCount > 0) return "episodes";
    return state.episodesLoading ? "loading" : "episodes";
  }
  // No shows followed: suggest from Podcast Index's trending list.
  if (state.podcastIndexConfigured === null) return "loading";
  if (!state.podcastIndexConfigured || state.trendingError) return "unavailable";
  if (state.trendingLoading) return "loading";
  return state.trendingCount > 0 ? "trending" : "unavailable";
}
