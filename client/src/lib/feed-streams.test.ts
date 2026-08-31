/**
 * Feed stream posts (lib/feed-streams.ts) — the decidable half of "live
 * streams people post as plain notes" (owner ask 2026-08-31: an iptv channel
 * posts kind-1 notes carrying raw .m3u8 URLs; those should reach the Live
 * section while actually live, and never as stale cards).
 *
 * This module only DECIDES (extract, dedupe, title) — liveness is the
 * health probe's job and stays out of here.
 */
import { describe, expect, it } from "vitest";
import { extractStreamUrl, pickFeedStreams, toLiveEventData, isFeedStreamEntry, rankChannels } from "./feed-streams";

const PK_A = "a".repeat(64);
const PK_B = "b".repeat(64);
const note = (id: string, pubkey: string, createdAt: number, content: string, kind = 1) =>
  ({ id: id.padEnd(64, "0"), kind, pubkey, created_at: createdAt, content, tags: [], sig: "" }) as never;

describe("extractStreamUrl — a post's playable stream URL", () => {
  it("finds an https .m3u8 URL inside post text", () => {
    expect(extractStreamUrl("RealWildTV iptv 📺 https://cdn.example.com/wild/index.m3u8 enjoy"))
      .toBe("https://cdn.example.com/wild/index.m3u8");
  });

  it("keeps query strings (tokenized manifests are the common real shape)", () => {
    expect(extractStreamUrl("live now https://s.example.com/hls/x.m3u8?token=abc123"))
      .toBe("https://s.example.com/hls/x.m3u8?token=abc123");
  });

  it("refuses plain-http manifests — browsers block them and the proxy refuses them, so claiming them is a lie", () => {
    expect(extractStreamUrl("watch http://insecure.example.com/live.m3u8")).toBeUndefined();
  });

  it("returns undefined when there is no stream URL", () => {
    expect(extractStreamUrl("just words and https://example.com/article.html")).toBeUndefined();
  });

  it("first URL wins when a post carries several", () => {
    expect(extractStreamUrl("https://a.example.com/1.m3u8 https://b.example.com/2.m3u8"))
      .toBe("https://a.example.com/1.m3u8");
  });
});

describe("pickFeedStreams — assembling the lane from raw notes", () => {
  it("keeps only kind-1 notes that carry a stream URL, newest first", () => {
    const out = pickFeedStreams([
      note("old", PK_A, 100, "morning show https://cdn.x.com/a.m3u8"),
      note("new", PK_B, 200, "evening show https://cdn.x.com/b.m3u8"),
      note("plain", PK_A, 300, "no stream here"),
      note("wrongkind", PK_A, 400, "https://cdn.x.com/c.m3u8", 30311),
    ]);
    expect(out.map((s) => s.id.slice(0, 3))).toEqual(["new", "old"]);
  });

  it("dedupes by URL — a channel reposting the same stream keeps only the newest note", () => {
    const out = pickFeedStreams([
      note("first", PK_A, 100, "live https://cdn.x.com/same.m3u8"),
      note("again", PK_A, 500, "still live https://cdn.x.com/same.m3u8"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id.startsWith("again")).toBe(true);
  });

  it("titles the card from the post's words, never the URL", () => {
    const out = pickFeedStreams([note("t", PK_A, 100, "Fox news Now iptv 📺\nhttps://cdn.x.com/fox.m3u8")]);
    expect(out[0].title).toBe("Fox news Now iptv 📺");
  });

  it("a bare-URL post still gets an honest generic title", () => {
    const out = pickFeedStreams([note("b", PK_A, 100, "https://cdn.x.com/bare.m3u8")]);
    expect(out[0].title).toBe("Live stream");
  });
});

describe("rankChannels — the Channels directory order", () => {
  const posts = pickFeedStreams([
    note("deadOld", PK_A, 100, "Dead Old https://cdn.x.com/dead-old.m3u8"),
    note("liveOld", PK_A, 200, "Live Old https://cdn.x.com/live-old.m3u8"),
    note("unknownNew", PK_B, 300, "Unknown New https://cdn.x.com/unknown.m3u8"),
    note("liveNew", PK_B, 400, "Live New https://cdn.x.com/live-new.m3u8"),
    note("deadNew", PK_B, 500, "Dead New https://cdn.x.com/dead-new.m3u8"),
  ]);
  const liveness = (url: string) =>
    url.includes("live-") ? "verified-live" as const : url.includes("dead-") ? "offline" as const : "unknown" as const;

  // Fixture timestamps are seconds 100–500, so "now" = 600 keeps every post
  // inside the unwatchable-freshness window; the aging rule has its own test.
  const NOW = 600;

  it("verified channels lead, unknown follow, offline sit last — newest first within each band", () => {
    const ranked = rankChannels(posts, liveness, NOW);
    expect(ranked.map((p) => p.id.replace(/0+$/, ""))).toEqual([
      "liveNew", "liveOld", "unknownNew", "deadNew", "deadOld",
    ]);
  });

  it("a channel directory keeps its FRESH offline rows — going down must reorder, never erase", () => {
    const ranked = rankChannels(posts, () => "offline", NOW);
    expect(ranked).toHaveLength(posts.length);
  });

  // Durable channels vs one-shot session streams (measured 2026-08-31: a
  // personal streamer posts a FRESH streamstr URL per broadcast — 27 dead
  // sessions over 3 weeks — while the TV-channel bot reposts its lineup
  // every ~2 days). An unwatchable entry earns its dimmed row only while
  // its post is fresh; a durable channel's repost cadence keeps it fresh
  // by itself.
  it("dead one-shot sessions age out; a LIVE stream stays no matter how old its post is", () => {
    const now = 1_000_000;
    const fresh = now - 60 * 60;             // 1h ago
    const stale = now - 5 * 24 * 60 * 60;    // 5d ago
    const aged = pickFeedStreams([
      note("liveAncient", PK_A, now - 20 * 24 * 3600, "Live Ancient https://cdn.x.com/live-a.m3u8"),
      note("deadFresh", PK_A, fresh, "Dead Fresh https://cdn.x.com/dead-f.m3u8"),
      note("deadStale", PK_B, stale, "Dead Stale https://cdn.x.com/dead-s.m3u8"),
      note("unknownStale", PK_B, stale, "Unknown Stale https://cdn.x.com/unk-s.m3u8"),
    ]);
    const ranked = rankChannels(aged, liveness, now);
    expect(ranked.map((p) => p.id.replace(/0+$/, ""))).toEqual(["liveAncient", "deadFresh"]);
  });
});

describe("toLiveEventData — riding the Live section's existing card pipeline", () => {
  const post = pickFeedStreams([note("p1", PK_A, 100, "Wild TV\nhttps://cdn.x.com/wild.m3u8")])[0];

  it("synthesizes a live entry the StreamCard grid can render", () => {
    const s = toLiveEventData(post);
    expect(s.status).toBe("live");
    expect(s.streamUrl).toBe("https://cdn.x.com/wild.m3u8");
    expect(s.title).toBe("Wild TV");
    expect(s.pubkey).toBe(PK_A);
    // Chat/zap machinery must stay off — there is no NIP-53 coordinate to
    // chat against, and inventing one would send messages into the void.
    expect(s.chatEnabled).toBe(false);
  });

  it("is recognizable so selection can route to /live/post/<nevent>, never a fabricated naddr", () => {
    const s = toLiveEventData(post);
    expect(isFeedStreamEntry(s)).toBe(true);
    expect(isFeedStreamEntry({ ...s, dTag: "real-stream-d" })).toBe(false);
  });
});
