/**
 * An episode as the player plays it (News redesign, part 4: the Listen lane).
 *
 * The same "episode → player track" object was built by hand in the reader,
 * the single-feed playlist and the add dialog. One builder keeps them in
 * step, and above all keeps the track id that "resume where you left off" is
 * saved under: change it and every half-heard episode starts from zero.
 */
import { describe, expect, it } from "vitest";
import { episodeTrack, podcastFeedToSaved } from "./podcast-episode";
import { laneOf } from "./news-library";

describe("episodeTrack — an episode as the player plays it", () => {
  it("keeps the id resume positions are saved under, and falls back to the show's art and name", () => {
    const audioUrl = "https://cdn.example/ep 12.mp3";
    const track = episodeTrack(
      { title: "Episode 12", audioUrl, pubDate: "2026-09-10T08:00:00Z", duration: 1800 },
      { title: "A Show", author: "", image: "https://cdn.example/show.jpg" },
    );
    expect(track?.id).toBe(`rss-${encodeURIComponent(audioUrl)}`);
    expect(track?.coverUrl).toBe("https://cdn.example/show.jpg");
    expect(track?.artist).toBe("A Show");
    expect(track?.albumTitle).toBe("A Show");
    expect(track?.duration).toBe(1800);
    expect(track?.source).toBe("podcast");
    expect(track?.createdAt).toBe(Date.parse("2026-09-10T08:00:00Z") / 1000);
  });

  it("is nothing for an item with no audio", () => {
    expect(episodeTrack({ title: "An article" }, { title: "A Show" })).toBeNull();
  });
});

/**
 * Following a show from Podcast Index (the add dialog, and the Listen lane's
 * trending suggestions) saves the same source either way, and it lands in the
 * Listen lane, never in News.
 */
describe("podcastFeedToSaved — following a show", () => {
  it("saves the show with its art and author, in your Listen lane", () => {
    const saved = podcastFeedToSaved({
      id: 1,
      title: "A Show",
      author: "The Host",
      description: "",
      image: "https://cdn.example/art.jpg",
      url: "https://cdn.example/feed.xml",
      episodeCount: 10,
      language: "en",
      value: null,
    });
    expect(saved).toEqual({
      name: "A Show",
      url: "https://cdn.example/feed.xml",
      category: "Podcast",
      feedImage: "https://cdn.example/art.jpg",
      author: "The Host",
    });
    expect(laneOf(saved)).toBe("listen");
  });
});
