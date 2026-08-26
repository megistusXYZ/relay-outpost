/**
 * The pure halves of the Discover tile data layer. The fetchers themselves are
 * network I/O over primitives tested elsewhere (relay-reach, rss-merge); what
 * earns tests here is the set-building and folding logic where a silent
 * mistake produces a confidently wrong tile.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/nostr", () => ({
  eventStore: { add: () => {}, getEvent: () => null },
  throttledPoolSubscribe: () => ({ close: () => {} }),
  FAST_RELAYS: [],
  getRelaysForPurpose: () => [],
}));
vi.mock("@/lib/primal-cache", () => ({
  fetchGlobalFeed: async () => ({ posts: [], profiles: [], statsLoaded: false }),
  getCachedFollowerCount: () => undefined,
  primalStatsCache: new Map(),
}));
const activitySpy = vi.fn(async () => new Map<string, number>());
vi.mock("@/lib/community-activity", () => ({ fetchCommunityActivity: (...a: unknown[]) => activitySpy(...a) }));
vi.mock("@/lib/relay-reach", () => ({
  canReachAny: async () => true,
  canReachRelay: async () => true,
  relayRefusedUs: () => undefined,
}));

import { discoverNewsFeeds, summarizePulse, fetchCommunityPulse, feedSnippet, survivingArticles } from "./discover-data";
import { NEWS_STARTER_FEEDS, NEWS_FRONT_PAGE_URLS, PODCAST_FEED_URLS } from "./rss-feeds";

describe("discoverNewsFeeds", () => {
  it("draws only from the audited front-page set", () => {
    const feeds = discoverNewsFeeds(new Set());
    expect(feeds.length).toBeGreaterThan(0);
    for (const f of feeds) expect(NEWS_FRONT_PAGE_URLS.has(f.url)).toBe(true);
  });

  it("keeps the fan-out bounded — /api/rss budget is shared with the News page", () => {
    expect(discoverNewsFeeds(new Set()).length).toBeLessThanOrEqual(10);
  });

  it("respects a feed the user hid", () => {
    const all = discoverNewsFeeds(new Set());
    const hidden = new Set([all[0].url]);
    expect(discoverNewsFeeds(hidden).map((f) => f.url)).not.toContain(all[0].url);
  });

  it("never puts a podcast in the hero slot", () => {
    for (const f of discoverNewsFeeds(new Set())) {
      expect(PODCAST_FEED_URLS.has(f.url)).toBe(false);
    }
  });

  it("is a subset of the starter news feeds, so hiding rules stay one system", () => {
    const starterUrls = new Set(NEWS_STARTER_FEEDS.map((f) => f.url));
    for (const f of discoverNewsFeeds(new Set())) expect(starterUrls.has(f.url)).toBe(true);
  });
});

describe("summarizePulse", () => {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const NOW = 1_800_000_000_000;

  it("finds a community's answer despite casing and trailing slash — the map is normalizeUrl-keyed", () => {
    // fetchCommunityActivity keys by normalizeUrl; a raw-URL lookup silently
    // loses the answer and reports a busy community as quiet.
    const activity = new Map([["wss://relay.example.com", NOW - 1000]]);
    const pulse = summarizePulse(["WSS://Relay.Example.Com/"], activity, NOW, WEEK);
    expect(pulse.active).toBe(1);
    expect(pulse.newest?.at).toBe(NOW - 1000);
  });

  it("counts only activity inside the window as active", () => {
    const activity = new Map([
      ["wss://busy.test", NOW - 1000],
      ["wss://dormant.test", NOW - WEEK - 1000],
    ]);
    const pulse = summarizePulse(["wss://busy.test", "wss://dormant.test"], activity, NOW, WEEK);
    expect(pulse.total).toBe(2);
    expect(pulse.active).toBe(1);
    // Dormant still informs "newest" bookkeeping without being called active.
    expect(pulse.newest?.url).toBe("wss://busy.test");
  });

  it("reports a measured-quiet set as zero active, not as no data", () => {
    const pulse = summarizePulse(["wss://a.test"], new Map(), NOW, WEEK);
    expect(pulse).toEqual({ total: 1, active: 0, newest: undefined });
  });
});

describe("the answer memo", () => {
  it("shares an in-flight request — a remount mid-flight does not double-fire", async () => {
    // The bug: the settled-value cache missed the remount it was built for
    // (tab return WHILE the first fetch is still running), so both fired.
    activitySpy.mockClear();
    let release: () => void = () => {};
    activitySpy.mockImplementationOnce(() =>
      new Promise((r) => { release = () => r(new Map<string, number>()); }));
    const urls = ["wss://memo.test"];
    const a = fetchCommunityPulse(urls, 1000);
    const b = fetchCommunityPulse(urls, 1000); // remount before `a` settled
    release();
    await Promise.all([a, b]);
    expect(activitySpy).toHaveBeenCalledTimes(1);
  });
});

describe("feedSnippet", () => {
  it("strips http links AND nostr references so the tile is not a wall of base32", () => {
    const raw = "gm check this https://example.com/x and nostr:npub1abcdef0123456789 plus note1zzzz9999";
    const out = feedSnippet(raw);
    expect(out).not.toMatch(/https?:/);
    expect(out).not.toMatch(/npub1|note1|nostr:/);
    expect(out).toContain("gm check this");
    expect(out).toContain("and");
  });

  it("collapses whitespace and caps length", () => {
    expect(feedSnippet("a".repeat(300))).toHaveLength(140);
    expect(feedSnippet("x    y")).toBe("x y");
  });

  it("leaves a plain post untouched", () => {
    expect(feedSnippet("just a normal thought")).toBe("just a normal thought");
  });
});

describe("survivingArticles", () => {
  const body = "x".repeat(400);
  const art = (createdAt: number, title: string) => ({
    kind: 30023, pubkey: "aa".repeat(32), created_at: createdAt, content: body,
    id: title, sig: "", tags: [["d", title], ["title", title], ["summary", "s"]],
  }) as unknown as Parameters<typeof survivingArticles>[0][number];

  it("drops future-dated articles that would pin the tile forever", () => {
    const now = Math.floor(Date.now() / 1000);
    const out = survivingArticles([art(now + 86400 * 365, "future"), art(now - 100, "recent")]);
    expect(out.map((a) => a.title)).toEqual(["recent"]);
  });

  it("keeps a real newest article", () => {
    const now = Math.floor(Date.now() / 1000);
    const out = survivingArticles([art(now - 5000, "older"), art(now - 100, "newer")]);
    expect(out[0].title).toBe("newer");
  });
});
