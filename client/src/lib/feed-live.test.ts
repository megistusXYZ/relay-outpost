import { describe, it, expect } from "vitest";
import {
  feedHasLive,
  relevantLivePubkeys,
  liveNowCount,
  shouldShowLiveNow,
} from "./feed-live";

const feed = (authorPubkeys: string[], hashtags: string[] = []) => ({
  authorPubkeys,
  hashtags,
});

describe("feedHasLive", () => {
  it("is true when a feed author is in the live set", () => {
    expect(feedHasLive(feed(["a", "b"]), new Set(["b"]))).toBe(true);
  });

  it("is false when no feed author is live", () => {
    expect(feedHasLive(feed(["a", "b"]), new Set(["c"]))).toBe(false);
  });

  it("is false when the live set is empty", () => {
    expect(feedHasLive(feed(["a", "b"]), new Set())).toBe(false);
  });

  it("is false for an author-less feed with no live-hashtag match", () => {
    expect(feedHasLive(feed([], ["bitcoin"]), new Set(["a"]))).toBe(false);
  });

  it("optionally matches a hashtag feed against live-stream hashtags (case-insensitive)", () => {
    expect(
      feedHasLive(feed([], ["Bitcoin"]), new Set(), new Set(["bitcoin"])),
    ).toBe(true);
  });

  it("does not match when the hashtag is absent from live streams", () => {
    expect(
      feedHasLive(feed([], ["nostr"]), new Set(), new Set(["bitcoin"])),
    ).toBe(false);
  });
});

describe("relevantLivePubkeys / liveNowCount", () => {
  const feeds = [feed(["a", "b"]), feed(["b", "c"]), feed(["x"])];

  it("collects the deduped live authors across all feeds", () => {
    const live = new Set(["b", "c", "z"]);
    expect([...relevantLivePubkeys(feeds, live)].sort()).toEqual(["b", "c"]);
    expect(liveNowCount(feeds, live)).toBe(2);
  });

  it("counts zero when nothing relevant is live", () => {
    expect(liveNowCount(feeds, new Set(["z"]))).toBe(0);
    expect(liveNowCount(feeds, new Set())).toBe(0);
  });
});

describe("shouldShowLiveNow", () => {
  const feeds = [feed(["a", "b"])];

  it("shows when a relevant author is live", () => {
    expect(shouldShowLiveNow(feeds, new Set(["a"]))).toBe(true);
  });

  it("hides when none are live", () => {
    expect(shouldShowLiveNow(feeds, new Set(["z"]))).toBe(false);
    expect(shouldShowLiveNow(feeds, new Set())).toBe(false);
  });

  it("hides when there are no feeds", () => {
    expect(shouldShowLiveNow([], new Set(["a"]))).toBe(false);
  });
});
