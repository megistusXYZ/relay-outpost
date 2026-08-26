import { describe, it, expect } from "vitest";
import {
  normalizeNewsUrl,
  extractUrls,
  buildNetworkShareMap,
  applyNetworkBoost,
  type BoostableStory,
} from "./news-network-boost";

describe("normalizeNewsUrl", () => {
  it("collapses scheme, www, trailing slash, and tracking params to one key", () => {
    const a = normalizeNewsUrl("https://www.bbc.com/news/story-123/?utm_source=twitter&fbclid=xyz");
    const b = normalizeNewsUrl("http://bbc.com/news/story-123");
    expect(a).toBe(b);
    expect(a).toBe("bbc.com/news/story-123");
  });

  it("keeps a meaningful query param", () => {
    expect(normalizeNewsUrl("https://x.test/a?id=42")).toBe("x.test/a?id=42");
  });

  it("rejects non-http and junk", () => {
    expect(normalizeNewsUrl("nostr:npub1abc")).toBe("");
    expect(normalizeNewsUrl("not a url")).toBe("");
  });
});

describe("extractUrls", () => {
  it("pulls urls out of a note and trims trailing punctuation", () => {
    const urls = extractUrls("wild story here https://bbc.com/x, and also https://npr.org/y.");
    expect(urls).toContain("https://bbc.com/x");
    expect(urls).toContain("https://npr.org/y");
  });

  it("returns nothing for a plain note", () => {
    expect(extractUrls("just thinking out loud")).toEqual([]);
  });
});

const story = (link: string, memberLinks: string[] = []): BoostableStory => ({ link, memberLinks });

describe("buildNetworkShareMap", () => {
  it("counts DISTINCT sharers per url (one account twice = once)", () => {
    const map = buildNetworkShareMap([
      { pubkey: "alice", content: "read this https://bbc.com/x" },
      { pubkey: "alice", content: "still thinking about https://bbc.com/x" },
      { pubkey: "bob", content: "yeah https://bbc.com/x" },
    ]);
    const entry = map.get("bbc.com/x")!;
    expect(entry.sharers.size).toBe(2);
  });

  it("weights sharers by the provided weight (a trusted friend counts more)", () => {
    const map = buildNetworkShareMap(
      [{ pubkey: "trusted", content: "https://bbc.com/x" }, { pubkey: "rando", content: "https://bbc.com/x" }],
      { weightOf: (pk) => (pk === "trusted" ? 5 : 1) },
    );
    expect(map.get("bbc.com/x")!.score).toBe(6);
  });

  it("ignores the viewer's own shares — self-share is not social proof", () => {
    const map = buildNetworkShareMap(
      [{ pubkey: "me", content: "https://bbc.com/x" }, { pubkey: "friend", content: "https://bbc.com/x" }],
      { viewer: "me" },
    );
    expect(map.get("bbc.com/x")!.sharers.size).toBe(1);
  });
});

describe("applyNetworkBoost", () => {
  const stories = [
    story("https://a.test/1"),
    story("https://a.test/2"),
    story("https://a.test/3"),
    story("https://a.test/4"),
    story("https://a.test/5"),
  ];

  it("lifts a story the network shared above unshared neighbours", () => {
    const map = buildNetworkShareMap([
      { pubkey: "x", content: "https://a.test/4" },
      { pubkey: "y", content: "https://a.test/4" },
      { pubkey: "z", content: "https://a.test/4" },
    ]);
    const out = applyNetworkBoost(stories, map);
    // #4 (3 sharers) should rise well above its base position.
    const idx = out.findIndex((s) => s.link === "https://a.test/4");
    expect(idx).toBeLessThan(3);
    expect(out.find((s) => s.link === "https://a.test/4")!.network!.count).toBe(3);
  });

  it("annotates non-shared stories with null and leaves them ordered", () => {
    const out = applyNetworkBoost(stories, new Map());
    expect(out.map((s) => s.link)).toEqual(stories.map((s) => s.link)); // untouched
    expect(out.every((s) => s.network === null)).toBe(true);
  });

  it("matches via ANY member link — a friend linking a different outlet lifts the cluster", () => {
    const clustered = [
      story("https://reuters.test/lead", ["https://bbc.test/copy", "https://npr.test/copy"]),
      story("https://a.test/other"),
    ];
    const map = buildNetworkShareMap([{ pubkey: "x", content: "https://bbc.test/copy" }]);
    const out = applyNetworkBoost(clustered, map);
    expect(out[0].link).toBe("https://reuters.test/lead");
    expect(out[0].network!.count).toBe(1);
  });

  it("does not let one obscure share leapfrog a strongly-boosted story", () => {
    const map = buildNetworkShareMap([
      // #5 has 1 sharer; #2 has 4 sharers — #2 must stay ahead of #5.
      { pubkey: "a", content: "https://a.test/5" },
      { pubkey: "b", content: "https://a.test/2" },
      { pubkey: "c", content: "https://a.test/2" },
      { pubkey: "d", content: "https://a.test/2" },
      { pubkey: "e", content: "https://a.test/2" },
    ]);
    const out = applyNetworkBoost(stories, map);
    const i2 = out.findIndex((s) => s.link === "https://a.test/2");
    const i5 = out.findIndex((s) => s.link === "https://a.test/5");
    expect(i2).toBeLessThan(i5);
  });

  it("does not double-count a sharer who shared two member links of one story", () => {
    const clustered = [story("https://reuters.test/lead", ["https://bbc.test/copy"]), story("https://a.test/x")];
    const map = buildNetworkShareMap([
      { pubkey: "x", content: "https://reuters.test/lead and https://bbc.test/copy" },
    ]);
    const out = applyNetworkBoost(clustered, map);
    expect(out[0].network!.count).toBe(1); // one sharer, not two
  });
});
