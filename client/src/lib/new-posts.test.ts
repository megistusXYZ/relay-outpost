import { describe, it, expect } from "vitest";
import {
  NEW_POSTS_DISPLAY_CAP,
  formatNewPostsLabel,
  isLiveFeedMode,
  orderRevealedFirst,
} from "./new-posts";

describe("formatNewPostsLabel", () => {
  it("singular for exactly one", () => {
    expect(formatNewPostsLabel(1)).toBe("1 new post");
  });

  it("plural with a true count below the cap", () => {
    expect(formatNewPostsLabel(2)).toBe("2 new posts");
    expect(formatNewPostsLabel(30)).toBe("30 new posts");
    expect(formatNewPostsLabel(47)).toBe("47 new posts");
  });

  it("shows the exact cap without a plus", () => {
    expect(formatNewPostsLabel(NEW_POSTS_DISPLAY_CAP)).toBe("99 new posts");
  });

  it("caps display at 99+ beyond the cap", () => {
    expect(formatNewPostsLabel(100)).toBe("99+ new posts");
    expect(formatNewPostsLabel(5000)).toBe("99+ new posts");
  });
});

describe("isLiveFeedMode", () => {
  it("For You and Following are live", () => {
    expect(isLiveFeedMode("raw_signal")).toBe(true);
    expect(isLiveFeedMode("open_comms")).toBe(true);
  });

  it("saved custom feeds are live (firehose filtered to the feed)", () => {
    expect(isLiveFeedMode("custom_abc123")).toBe(true);
  });

  it("Trending/archives (deep_scan) is static", () => {
    expect(isLiveFeedMode("deep_scan")).toBe(false);
  });

  it("macro media feeds and the empty placeholder are not this pipeline", () => {
    expect(isLiveFeedMode("custom_all")).toBe(false);
    expect(isLiveFeedMode("custom_empty")).toBe(false);
  });

  it("fails closed on unknown modes", () => {
    expect(isLiveFeedMode("")).toBe(false);
    expect(isLiveFeedMode("saved")).toBe(false);
    expect(isLiveFeedMode("whatever")).toBe(false);
  });
});

describe("orderRevealedFirst", () => {
  const ev = (id: string, created_at: number) => ({ id, created_at });

  it("returns the input array identity when nothing is revealed", () => {
    const list = [ev("a", 3), ev("b", 2)];
    expect(orderRevealedFirst(list, new Set())).toBe(list);
    expect(orderRevealedFirst(list, new Set(["zzz"]))).toBe(list);
  });

  it("moves revealed posts to the front, newest-first, keeping the rest in order", () => {
    // Ranked feed order: engagement winners first, fresh posts buried.
    const list = [ev("hot1", 100), ev("hot2", 90), ev("fresh-old", 500), ev("fresh-new", 600), ev("hot3", 80)];
    const out = orderRevealedFirst(list, new Set(["fresh-new", "fresh-old"]));
    expect(out.map((e) => e.id)).toEqual(["fresh-new", "fresh-old", "hot1", "hot2", "hot3"]);
  });

  it("ignores revealed ids not present in the list", () => {
    const list = [ev("a", 3), ev("b", 2), ev("c", 1)];
    const out = orderRevealedFirst(list, new Set(["b", "gone"]));
    expect(out.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("is a stable no-op shape on an already-chronological feed", () => {
    const list = [ev("new2", 600), ev("new1", 500), ev("old", 100)];
    const out = orderRevealedFirst(list, new Set(["new1", "new2"]));
    expect(out.map((e) => e.id)).toEqual(["new2", "new1", "old"]);
  });
});
