import { describe, it, expect } from "vitest";
import {
  computeRssUnread,
  computePriorityNewsUnread,
  placePreviewCard,
  rssItemKey,
} from "./orbit-stories";

describe("rssItemKey", () => {
  it("prefers guid, then id, then link — matching the News page ledger", () => {
    expect(rssItemKey({ guid: "g", id: "i", link: "l" })).toBe("g");
    expect(rssItemKey({ id: "i", link: "l" })).toBe("i");
    expect(rssItemKey({ link: " l " })).toBe("l");
    expect(rssItemKey({})).toBe("");
  });
});

describe("computeRssUnread", () => {
  const feed = (items: any[]) => ({ items });

  it("counts only unread, deduped across feeds", () => {
    const read = new Set(["a"]);
    const out = computeRssUnread(
      [
        feed([{ guid: "a", title: "Read one" }, { guid: "b", title: "B" }]),
        feed([{ guid: "b", title: "B again" }, { guid: "c", title: "C" }]),
      ],
      read,
    );
    expect(out.count).toBe(2); // b (once) + c
  });

  it("picks the newest unread headline by pubDate", () => {
    const out = computeRssUnread(
      [
        feed([
          { guid: "old", title: "Old", pubDate: "2026-07-01T00:00:00Z" },
          { guid: "new", title: "Newest", pubDate: "2026-07-16T00:00:00Z" },
          { guid: "mid", title: "Mid", pubDate: "2026-07-10T00:00:00Z" },
        ]),
      ],
      new Set(),
    );
    expect(out.topTitle).toBe("Newest");
  });

  it("skips unkeyed items so the ring cannot get stuck", () => {
    const out = computeRssUnread([feed([{ title: "no ids" }])], new Set());
    expect(out.count).toBe(0);
    expect(out.topTitle).toBeNull();
  });

  it("is quiet when nothing is cached", () => {
    expect(computeRssUnread([], new Set())).toEqual({ count: 0, topTitle: null });
    expect(computeRssUnread([undefined, feed([])], new Set()).count).toBe(0);
  });
});

describe("computePriorityNewsUnread", () => {
  const NOW = Date.parse("2026-07-17T12:00:00Z");
  const H = 3_600_000;
  // A followed-creator podcast feed: presetCategory(30) + followedCreator(25)
  // + creatorLed(15) = 70 → tier "alert" (counts). A plain saved category
  // scores 30 → tier "low" (never counts).
  const podcastFeed = { url: "https://pod.example/rss", name: "My Show", category: "Podcast" };
  const worldFeed = { url: "https://news.example/rss", name: "Example Wire", category: "World" };
  const item = (guid: string, ageH: number) => ({
    guid,
    title: `Episode ${guid}`,
    description: "A real description so the thin-content penalty never fires.",
    pubDate: new Date(NOW - ageH * H).toISOString(),
  });

  it("counts only fresh, unread, tier-1–2 items and teases the newest", () => {
    const out = computePriorityNewsUnread(
      [
        { url: podcastFeed.url, items: [item("fresh", 2), item("fresher", 1), item("stale", 100), item("read", 3)] },
        { url: worldFeed.url, items: [item("lowtier", 1)] },
      ],
      [podcastFeed, worldFeed],
      new Set(["read"]),
      NOW,
    );
    expect(out.count).toBe(2); // fresh + fresher; stale out of window, read excluded, lowtier below the bar
    expect(out.topTitle).toBe("Episode fresher");
  });

  it("mutes win — a muted source never counts", () => {
    const out = computePriorityNewsUnread(
      [{ url: podcastFeed.url, items: [item("a", 1)] }],
      [podcastFeed],
      new Set(),
      NOW,
      { mutedSources: [podcastFeed.url] },
    );
    expect(out.count).toBe(0);
  });

  it("is quiet with nothing cached", () => {
    expect(computePriorityNewsUnread([], [podcastFeed], new Set(), NOW).count).toBe(0);
    expect(computePriorityNewsUnread([undefined, { url: "x", items: [] }], [], new Set(), NOW).count).toBe(0);
  });
});

describe("placePreviewCard", () => {
  const base = { nodeSize: 60, cardWidth: 220, cardHeight: 90, viewportWidth: 375 };

  it("centers above the node when there is room", () => {
    const p = placePreviewCard({ ...base, nodeX: 187, nodeY: 400 });
    expect(p.below).toBe(false);
    expect(p.top).toBe(400 - 30 - 10 - 90);
    expect(Math.round(p.left + base.cardWidth / 2)).toBe(187);
  });

  it("clamps to the horizontal margins for edge nodes", () => {
    const left = placePreviewCard({ ...base, nodeX: 44, nodeY: 400 });
    expect(left.left).toBe(12);
    const right = placePreviewCard({ ...base, nodeX: 331, nodeY: 400 });
    expect(right.left + base.cardWidth).toBeLessThanOrEqual(375 - 12);
  });

  it("flips below the node when too close to the top band", () => {
    const p = placePreviewCard({ ...base, nodeX: 187, nodeY: 140 });
    expect(p.below).toBe(true);
    expect(p.top).toBe(140 + 30 + 26);
  });
});
