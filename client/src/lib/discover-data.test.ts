/**
 * The pure halves of the Discover tile data layer. The fetchers themselves are
 * network I/O over primitives tested elsewhere (relay-reach, rss-merge); what
 * earns tests here is the set-building and folding logic where a silent
 * mistake produces a confidently wrong tile.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

// Records which relays each one-shot read asks, delivers whatever the test
// put on the (fake) relays for that filter, and answers at once (EOSE).
let relayEvents: (filter: { kinds?: number[]; authors?: string[]; limit?: number }) => unknown[] = () => [];
const subscribeSpy = vi.fn((_relays: string[], filter: { kinds?: number[]; authors?: string[]; limit?: number }, handlers: { onevent?: (e: unknown) => void; oneose?: () => void }) => {
  setTimeout(() => {
    for (const e of relayEvents(filter)) handlers.onevent?.(e);
    handlers.oneose?.();
  }, 0);
  return { close: () => {} };
});
// Profiles the app already holds (the Feed tile drops authors with none).
let profileOf: Record<string, { name: string; picture?: string }> = {};
vi.mock("@/lib/nostr", () => ({
  eventStore: { add: () => {}, getEvent: (q: { pubkey: string }) => (profileOf[q.pubkey] ? { content: JSON.stringify(profileOf[q.pubkey]) } : null) },
  throttledPoolSubscribe: (...a: Parameters<typeof subscribeSpy>) => subscribeSpy(...a),
  // A general relay: the marketplace shelf must NOT read from it.
  FAST_RELAYS: ["wss://relay.primal.net"],
  getRelaysForPurpose: () => [],
}));
vi.mock("@/lib/primal-cache", () => ({
  fetchGlobalFeed: async () => ({ posts: [], profiles: [], statsLoaded: false }),
  prefetchStatsImmediate: async () => {},
  getCachedFollowerCount: () => undefined,
  primalStatsCache: new Map(),
}));
const activitySpy = vi.fn(async () => new Map<string, number>());
vi.mock("@/lib/community-activity", () => ({ fetchCommunityActivity: (...a: unknown[]) => activitySpy(...a) }));
// Trust scores come from the server's score cards (the network boundary).
// Like the server: a number for everyone it could check (-1 = no score card).
// `scoresDown` is a lookup that couldn't be made (rate limit, cooldown): no
// answer about anyone.
let scoreOf: Record<string, number> = {};
let scoresDown = false;
/** Every score lookup the tiles made: who was asked about. */
let scoreAsks: string[][] = [];
vi.mock("@/lib/brainstorm-search", () => ({
  fetchBrainstormWotBatch: async (pks: string[]) => {
    scoreAsks.push(pks);
    return new Map(scoresDown ? [] : pks.map((p) => [p, p in scoreOf ? scoreOf[p] : -1] as const));
  },
}));
vi.mock("@/lib/relay-reach", () => ({
  canReachAny: async () => true,
  canReachRelay: async () => true,
  relayRefusedUs: () => undefined,
}));

import { discoverNewsFeeds, summarizePulse, fetchCommunityPulse, feedSnippet, survivingArticles, fetchMarketShelf, fetchNextCalendarEvent, fetchImagesTeaser, fetchVideoTeaser, fetchNewestArticle, fetchFeedTeaser, setDiscoverTrust, resetDiscoverAnswers } from "./discover-data";
import { LISTING_RELAYS, KIND_CLASSIFIED_LISTING } from "./listing";
import { ALL_NEWS_FEEDS, ALL_PODCAST_FEEDS, DEFAULT_FEEDS, STARTER_URLS_V2, type SavedFeed } from "./rss-feeds";

/**
 * The Discover news hero follows your News library (2026-09), not the starter:
 * after the News migration a library someone shaped keeps its sources as added
 * entries and hides the new starter, so a starter-based hero would be empty.
 */
describe("discoverNewsFeeds — the Discover news hero draws from your News library", () => {
  it("takes your news sources, in your order, never a podcast", () => {
    const show = ALL_PODCAST_FEEDS[0];
    const [first, second] = ALL_NEWS_FEEDS;
    expect(discoverNewsFeeds([show, first, second]).map((f) => f.url)).toEqual([first.url, second.url]);
  });

  it("keeps the fan-out bounded — /api/rss budget is shared with the News page", () => {
    expect(discoverNewsFeeds(ALL_NEWS_FEEDS).length).toBeLessThanOrEqual(8);
  });

  it("still has sources for someone whose library was carried over from the old starter", () => {
    const carried: SavedFeed[] = ALL_NEWS_FEEDS.filter((f) => !STARTER_URLS_V2.has(f.url)).slice(0, 3);
    expect(discoverNewsFeeds(carried).length).toBeGreaterThan(0);
  });

  it("uses the new starter for a library nobody customised", () => {
    expect(new Set(discoverNewsFeeds(DEFAULT_FEEDS).map((f) => f.url))).toEqual(new Set(STARTER_URLS_V2));
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

/**
 * Discover's marketplace shelf is the front door to the Marketplace, so it
 * shows only what Conduit's marketplace relay carries, exactly like the
 * Marketplace page (owner report, 2026-09-28: the shelf led with a steroid
 * shop's Clomid and Testosterone listings, published to general relays such
 * as relay.primal.net, where 22 of 40 recent listings were that one seller).
 */
describe("Discover's marketplace shelf", () => {
  it("reads only Conduit's marketplace relay, never the general relays", async () => {
    subscribeSpy.mockClear();
    await fetchMarketShelf();
    const asked = subscribeSpy.mock.calls
      .filter((c) => c[1].kinds?.includes(KIND_CLASSIFIED_LISTING))
      .map((c) => c[0]);
    expect(asked.length).toBeGreaterThan(0);
    for (const relays of asked) expect(relays).toEqual(LISTING_RELAYS);
  });
});

/**
 * PR 2 of "Discover shows only highly trusted people" (owner, 2026-09-29):
 * Events and the Marketplace shelf show only hosts and sellers at 0.50+
 * (or people you follow), and say so when the trusted list can't be read.
 */
describe("Discover's Events and Marketplace tiles show only trusted people", () => {
  beforeEach(() => resetDiscoverAnswers());
  afterEach(() => vi.unstubAllGlobals());
  const TRUSTED = "a".repeat(64);
  const STRANGER = "b".repeat(64);
  const soon = Math.floor(Date.now() / 1000) + 3600;
  const later = soon + 86400;
  const event = (pubkey: string, start: number, title: string) => ({
    id: pubkey.slice(0, 8) + start, kind: 31923, pubkey, created_at: 1, content: "", sig: "s",
    tags: [["d", title], ["title", title], ["start", String(start)]],
  });
  const listing = (pubkey: string, title: string) => ({
    id: pubkey.slice(0, 8) + title, kind: 30402, pubkey, created_at: Math.floor(Date.now() / 1000), content: "", sig: "s",
    tags: [["d", title], ["title", title], ["image", "https://img.example/" + title + ".jpg"], ["price", "10", "USD"]],
  });
  const trustedList = (ok: boolean) => vi.stubGlobal("fetch", vi.fn(async () => ok
    ? { ok: true, json: async () => ({ authors: [TRUSTED] }) }
    : { ok: false, json: async () => ({}) }));

  it("Events: the next event from a trusted host, even when a stranger's is sooner", async () => {
    trustedList(true);
    scoreOf = { [TRUSTED]: 0.9, [STRANGER]: 0.1 };
    setDiscoverTrust({ follows: new Set(), wotEnabled: false, ownScores: null });
    relayEvents = (f) => (f.kinds?.includes(31923) ? [event(STRANGER, soon, "Spam meetup"), event(TRUSTED, later, "Bitcoin meetup")] : []);
    const r = await fetchNextCalendarEvent();
    expect(r.reached).toBe(true);
    expect(r.data?.title).toBe("Bitcoin meetup");
  });

  it("Marketplace: only trusted sellers' listings", async () => {
    trustedList(true);
    scoreOf = { [TRUSTED]: 0.9, [STRANGER]: 0.1 };
    setDiscoverTrust({ follows: new Set(["f".repeat(64)]), wotEnabled: false, ownScores: null });
    relayEvents = (f) => (f.kinds?.includes(KIND_CLASSIFIED_LISTING) ? [listing(STRANGER, "Pills"), listing(TRUSTED, "Hat")] : []);
    const r = await fetchMarketShelf();
    expect(r.data?.map((t) => t.title)).toEqual(["Hat"]);
  });

  it("Marketplace: one listing per seller, and no placeholder \"Test\" listings", async () => {
    trustedList(true);
    const OTHER = "c".repeat(64);
    scoreOf = { [TRUSTED]: 0.9, [OTHER]: 0.8 };
    setDiscoverTrust({ follows: new Set(["f".repeat(64)]), wotEnabled: false, ownScores: null });
    relayEvents = (f) => (f.kinds?.includes(KIND_CLASSIFIED_LISTING)
      ? [listing(TRUSTED, "Coffee"), listing(TRUSTED, "Coffee beans"), listing(OTHER, "Test"), listing(OTHER, "Hat")]
      : []);
    const r = await fetchMarketShelf();
    expect(r.data?.map((t) => t.title).sort()).toEqual(["Coffee", "Hat"].sort());
  });

  it("Images: trusted people's photos for a visitor who follows nobody, strangers' left out", async () => {
    trustedList(true);
    scoreOf = { [TRUSTED]: 0.9, [STRANGER]: 0.1 };
    setDiscoverTrust({ follows: new Set(), wotEnabled: false, ownScores: null });
    const photo = (pubkey: string, n: number) => ({
      id: pubkey.slice(0, 6) + n, kind: 20, pubkey, created_at: Math.floor(Date.now() / 1000) - 60, sig: "s",
      content: "", tags: [["imeta", `url https://img.example/${pubkey.slice(0, 4)}${n}.jpg`, "m image/jpeg"], ["title", "pic"]],
    });
    relayEvents = (f) => (f.kinds?.includes(20) ? [photo(STRANGER, 1), photo(TRUSTED, 2)] : []);
    const r = await fetchImagesTeaser([], new Set());
    expect(r.reached).toBe(true);
    expect((r.data ?? []).map((i) => i.authorPk)).toEqual([TRUSTED]);
  });

  // Measured 2026-09-30: score lookups are limited to 30 a minute per IP.
  // Past that nobody got a score, the gate dropped everyone, and tiles said
  // "Quiet right now" / "Nothing scheduled" over a busy network.
  describe("when people's scores couldn't be read", () => {
    const visitor = () => setDiscoverTrust({ follows: new Set(), wotEnabled: false, ownScores: null });
    const video = (pubkey: string, title: string) => ({
      id: pubkey.slice(0, 8) + title, kind: 21, pubkey, created_at: Math.floor(Date.now() / 1000) - 60, content: "", sig: "s",
      tags: [["title", title], ["imeta", "url https://v.example/a.mp4", "image https://v.example/a.jpg"]],
    });
    beforeEach(() => { resetDiscoverAnswers(); scoresDown = false; trustedList(true); visitor(); });
    afterEach(() => { scoresDown = false; profileOf = {}; });

    it("Events: an empty tile says it couldn't reach, not that nothing is scheduled", async () => {
      scoresDown = true;
      relayEvents = (f) => (f.kinds?.includes(31923) && !f.authors ? [event(STRANGER, soon, "Meetup by someone unchecked")] : []);
      const r = await fetchNextCalendarEvent();
      expect(r).toEqual({ data: null, reached: false });
    });

    it("Events: the same person, checked and scored low, really is nothing to show", async () => {
      scoreOf = { [STRANGER]: 0.1 };
      relayEvents = (f) => (f.kinds?.includes(31923) && !f.authors ? [event(STRANGER, soon, "Spam meetup")] : []);
      const r = await fetchNextCalendarEvent();
      expect(r).toEqual({ data: null, reached: true });
    });

    it("Events: whatever could be vetted is still shown", async () => {
      scoresDown = true;
      relayEvents = (f) => (f.kinds?.includes(31923) ? [event(STRANGER, soon, "Unchecked"), event(TRUSTED, later, "Bitcoin meetup")] : []);
      const r = await fetchNextCalendarEvent();
      expect(r.reached).toBe(true);
      expect(r.data?.title).toBe("Bitcoin meetup");
    });

    it("Marketplace: an empty shelf says it couldn't reach", async () => {
      scoresDown = true;
      relayEvents = (f) => (f.kinds?.includes(KIND_CLASSIFIED_LISTING) && !f.authors ? [listing(STRANGER, "Hat")] : []);
      const r = await fetchMarketShelf();
      expect(r).toEqual({ data: null, reached: false });
    });

    it("Videos: an empty tile says it couldn't reach", async () => {
      scoresDown = true;
      relayEvents = (f) => (f.kinds?.includes(21) && !f.authors ? [video(STRANGER, "A talk")] : []);
      const r = await fetchVideoTeaser();
      expect(r).toEqual({ data: null, reached: false });
    });

    it("Articles: an empty tile says it couldn't reach", async () => {
      scoresDown = true;
      const article = { id: "art1", kind: 30023, pubkey: STRANGER, created_at: Math.floor(Date.now() / 1000) - 60, content: "Body of the article.", sig: "s", tags: [["d", "a"], ["title", "An essay"], ["published_at", String(Math.floor(Date.now() / 1000) - 60)]] };
      relayEvents = (f) => (f.kinds?.includes(30023) && !f.authors ? [article] : []);
      const r = await fetchNewestArticle([]);
      expect(r).toEqual({ data: [], reached: false });
    });

    it("Feed: an empty tile says it couldn't reach, not 'Quiet right now'", async () => {
      scoresDown = true;
      const post = { id: "n1".padEnd(64, "0"), kind: 1, pubkey: STRANGER, created_at: Math.floor(Date.now() / 1000) - 60, content: "A thoughtful post about relays.", sig: "s", tags: [] };
      relayEvents = (f) => (f.kinds?.includes(1) && !f.authors ? [post] : []);
      const r = await fetchFeedTeaser();
      expect(r).toEqual({ data: [], reached: false });
    });

    it("Feed, relay fallback: its authors are asked about too, and a trusted one is shown", async () => {
      // Off the top list, trusted at 0.9. The fallback used to gate on the
      // (empty) pool's scores, so everyone off the top list was dropped unasked.
      const WRITER = "c".repeat(64);
      scoreOf = { [WRITER]: 0.9 };
      profileOf = { [WRITER]: { name: "Writer", picture: "https://img.example/w.jpg" } };
      const post = { id: "n3".padEnd(64, "0"), kind: 1, pubkey: WRITER, created_at: Math.floor(Date.now() / 1000) - 60, content: "A thoughtful post about relays and how they work.", sig: "s", tags: [] };
      relayEvents = (f) => (f.kinds?.includes(1) && !f.authors && f.limit === 30 ? [post] : []);
      const r = await fetchFeedTeaser();
      expect(r.reached).toBe(true);
      expect(r.data.map((e) => e.pubkey)).toEqual([WRITER]);
    });

    it("Feed, relay fallback: empty with scores unread says it couldn't reach", async () => {
      scoresDown = true;
      const post = { id: "n4".padEnd(64, "0"), kind: 1, pubkey: STRANGER, created_at: Math.floor(Date.now() / 1000) - 60, content: "A thoughtful post about relays and how they work.", sig: "s", tags: [] };
      relayEvents = (f) => (f.kinds?.includes(1) && !f.authors && f.limit === 30 ? [post] : []);
      const r = await fetchFeedTeaser();
      expect(r).toEqual({ data: [], reached: false });
    });

    it("Feed: the same person, checked and scored low, really is quiet", async () => {
      scoreOf = { [STRANGER]: 0.1 };
      const post = { id: "n2".padEnd(64, "0"), kind: 1, pubkey: STRANGER, created_at: Math.floor(Date.now() / 1000) - 60, content: "Buy my coin.", sig: "s", tags: [] };
      relayEvents = (f) => (f.kinds?.includes(1) && !f.authors ? [post] : []);
      const r = await fetchFeedTeaser();
      expect(r).toEqual({ data: [], reached: true });
    });
  });

  it("when the trusted list can't be read, Events says so and shows nothing", async () => {
    trustedList(false);
    setDiscoverTrust({ follows: new Set(["e".repeat(64)]), wotEnabled: false, ownScores: null });
    relayEvents = (f) => (f.kinds?.includes(31923) ? [event(TRUSTED, later, "Bitcoin meetup")] : []);
    const r = await fetchNextCalendarEvent();
    expect(r.reached).toBe(false);
    expect(r.data).toBeNull();
  });
});

/**
 * Articles, Events and Videos take their broad sample from our server, which
 * has already kept only trusted people's events (measured 2026-09-30, per
 * visitor before this: articles 981 KB, events 118 KB, videos 132 KB of
 * relay reads, plus a score lookup per tile).
 */
describe("Discover tiles fed by the server's samples", () => {
  const soon = Math.floor(Date.now() / 1000) + 3600;
  const recent = Math.floor(Date.now() / 1000) - 600;
  const key = generateSecretKey();
  const AUTHOR = getPublicKey(key);
  const sign = (kind: number, tags: string[][], content = "") => finalizeEvent({ kind, created_at: recent, tags, content }, key);

  /** Our server: the trusted list, and whichever samples the test provides. Anything else: 503. */
  const server = (samples: Record<string, unknown[]>) => vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/discover/trusted-authors")) return { ok: true, json: async () => ({ authors: [] }) };
    const name = url.match(/\/api\/discover\/sample\/(\w+)/)?.[1];
    if (name && name in samples) return { ok: true, json: async () => JSON.parse(JSON.stringify({ events: samples[name] })) };
    return { ok: false, json: async () => ({}) };
  }));
  const broadRelayReads = (kind: number) =>
    subscribeSpy.mock.calls.filter(([, f]) => f.kinds?.includes(kind) && !f.authors).length;

  beforeEach(() => {
    resetDiscoverAnswers(); subscribeSpy.mockClear(); scoreAsks = []; scoreOf = {}; scoresDown = false;
    relayEvents = () => [];
    setDiscoverTrust({ follows: new Set(), wotEnabled: false, ownScores: null });
  });

  it("Events: shown from the server's sample, with no broad relay read and no score lookup", async () => {
    server({ events: [sign(31923, [["d", "meetup"], ["title", "Bitcoin meetup"], ["start", String(soon)]])] });
    const r = await fetchNextCalendarEvent();
    expect(r.reached).toBe(true);
    expect(r.data?.title).toBe("Bitcoin meetup");
    expect(broadRelayReads(31923)).toBe(0);
    expect(scoreAsks).toEqual([]);
  });

  it("Videos: shown from the server's sample, with no broad relay read and no score lookup", async () => {
    server({ videos: [sign(21, [["title", "A talk"], ["imeta", "url https://v.example/a.mp4", "image https://v.example/a.jpg"]])] });
    const r = await fetchVideoTeaser();
    expect(r.reached).toBe(true);
    expect(r.data?.title).toBe("A talk");
    expect(broadRelayReads(21)).toBe(0);
    expect(scoreAsks).toEqual([]);
  });

  it("Articles: shown from the server's sample, with no broad relay read and no score lookup", async () => {
    // The tile only shows real articles: a title, a summary or image, 300+ characters.
    server({ articles: [sign(30023, [["d", "essay"], ["title", "An essay"], ["summary", "What it says"], ["published_at", String(recent)]], "The body of the essay. ".repeat(20))] });
    const r = await fetchNewestArticle([]);
    expect(r.reached).toBe(true);
    expect(r.data.map((a) => a.title)).toEqual(["An essay"]);
    expect(broadRelayReads(30023)).toBe(0);
    expect(scoreAsks).toEqual([]);
  });

  it("the server's sample is empty: the relays were reached and nothing is by trusted people", async () => {
    server({ videos: [] });
    const r = await fetchVideoTeaser();
    expect(r).toEqual({ data: null, reached: true });
    expect(broadRelayReads(21)).toBe(0);
  });

  it("an event whose signature doesn't check out is not shown on the server's word", async () => {
    const forged = { ...sign(21, [["title", "Real title"], ["imeta", "url https://v.example/a.mp4", "image https://v.example/a.jpg"]]), tags: [["title", "Swapped title"]] };
    server({ videos: [forged] });
    relayEvents = () => [];
    const r = await fetchVideoTeaser();
    expect(r.data).toBeNull();
    // Not an answer to build on, so the app took its own sample.
    expect(broadRelayReads(21)).toBe(1);
  });

  it("the server can't answer: the app takes its own sample and checks its authors", async () => {
    server({});
    scoreOf = { [AUTHOR]: 0.9 };
    relayEvents = (f) => (f.kinds?.includes(21) && !f.authors ? [sign(21, [["title", "From a relay"], ["imeta", "url https://v.example/b.mp4", "image https://v.example/b.jpg"]])] : []);
    const r = await fetchVideoTeaser();
    expect(r.data?.title).toBe("From a relay");
    expect(broadRelayReads(21)).toBe(1);
    expect(scoreAsks).toEqual([[AUTHOR]]);
  });

  it("your own trust map decides: the server's pick isn't yours, so the app samples", async () => {
    const own = new Map(Array.from({ length: 120 }, (_, i) => [i.toString(16).padStart(64, "0"), 0.9] as const));
    setDiscoverTrust({ follows: new Set(), wotEnabled: true, ownScores: own });
    server({ videos: [sign(21, [["title", "Server pick"], ["imeta", "url https://v.example/a.mp4", "image https://v.example/a.jpg"]])] });
    const r = await fetchVideoTeaser();
    expect(r.data).toBeNull();
    expect(broadRelayReads(21)).toBe(1);
  });
});
