/**
 * A post that announces someone is live on Shosho (owner, 2026-10-09: "why
 * isn't this post showing the live stream?"). Shosho's bot posts a kind-1 —
 * "<name> is Live!", a picture, and a link to the streamer's Shosho PAGE, not
 * the stream — and p-tags the streamer. The stream itself is a separate
 * kind-30311 live event. These helpers tell the two apart so the thread can
 * show our own player when there's one to play, and "Watch on Shosho" when
 * there isn't.
 */
import { describe, it, expect } from "vitest";
import { shoshoHandle, announcedHost } from "./shosho";

const BOT = "85df822a86599ffbe8143db1e1e1bf2d162fa60fc685c65515963e67cfd7499f";
const STREAMER = "20651ab8c2fb1febca56b80deba14630af452bdce64fe8f04a9f5f67e4a3c1cc";

describe("a Shosho page link", () => {
  it("is https://shosho.live/<handle>", () => {
    expect(shoshoHandle("https://shosho.live/jeeef")).toBe("jeeef");
    expect(shoshoHandle("https://shosho.live/jeeef/")).toBe("jeeef");
    expect(shoshoHandle("https://www.shosho.live/Jeeef?ref=x")).toBe("Jeeef");
  });
  it("is not the site's root, a sub-page, another site, or a stream address", () => {
    expect(shoshoHandle("https://shosho.live/")).toBeNull();
    expect(shoshoHandle("https://shosho.live/jeeef/clips")).toBeNull();
    expect(shoshoHandle("https://notshosho.live/jeeef")).toBeNull();
    expect(shoshoHandle("https://example.com/shosho.live/jeeef")).toBeNull();
    expect(shoshoHandle("https://stream.example/live.m3u8")).toBeNull();
    expect(shoshoHandle("javascript:alert(1)")).toBeNull();
  });
});

describe("who the post says is live", () => {
  const post = (tags: string[][], pubkey = BOT) => ({ pubkey, tags });
  it("is the person the post tags, not the bot that posted it", () => {
    expect(announcedHost(post([["p", STREAMER], ["client", "Shobot"]]))).toBe(STREAMER);
  });
  it("is the poster when they tag nobody else (a streamer posting about themself)", () => {
    expect(announcedHost(post([], STREAMER))).toBe(STREAMER);
    expect(announcedHost(post([["p", STREAMER]], STREAMER))).toBe(STREAMER);
  });
  it("is the first tagged person when several are", () => {
    expect(announcedHost(post([["p", STREAMER], ["p", "cd".repeat(32)]]))).toBe(STREAMER);
  });
  it("ignores tags that aren't a key", () => {
    expect(announcedHost(post([["p", "not-a-key"], ["p", STREAMER]]))).toBe(STREAMER);
  });
});
