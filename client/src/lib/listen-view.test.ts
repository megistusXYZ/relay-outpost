/**
 * What the Listen lane shows (News redesign, part 4). With shows you follow,
 * it's their new episodes. With none, it suggests what's trending in
 * podcasting from Podcast Index, never a list of our own picks; when Podcast
 * Index can't answer, it says so in one line.
 */
import { describe, expect, it } from "vitest";
import { listenView, type ListenState } from "./listen-view";

const nothingYet: ListenState = {
  followedShows: 0,
  episodeCount: 0,
  episodesLoading: false,
  podcastIndexConfigured: null,
  trendingLoading: false,
  trendingCount: 0,
  trendingError: false,
};

describe("listenView — what the Listen lane shows", () => {
  it("shows the episodes of the shows you follow, loading only until the first ones arrive", () => {
    const following = { ...nothingYet, followedShows: 2 };
    expect(listenView({ ...following, episodesLoading: true })).toBe("loading");
    expect(listenView({ ...following, episodesLoading: true, episodeCount: 5 })).toBe("episodes");
    expect(listenView({ ...following, episodeCount: 5 })).toBe("episodes");
  });

  it("suggests what's trending in podcasting when you follow no shows, loading while it asks", () => {
    // Still waiting to hear whether Podcast Index is set up on this server.
    expect(listenView(nothingYet)).toBe("loading");
    expect(listenView({ ...nothingYet, podcastIndexConfigured: true, trendingLoading: true })).toBe("loading");
    expect(listenView({ ...nothingYet, podcastIndexConfigured: true, trendingCount: 20 })).toBe("trending");
  });

  it("says so plainly when Podcast Index can't answer, and never falls back to a list of our own picks", () => {
    expect(listenView({ ...nothingYet, podcastIndexConfigured: false })).toBe("unavailable");
    expect(listenView({ ...nothingYet, podcastIndexConfigured: true, trendingError: true })).toBe("unavailable");
    // Answered, but with nothing to suggest.
    expect(listenView({ ...nothingYet, podcastIndexConfigured: true })).toBe("unavailable");
  });
});
