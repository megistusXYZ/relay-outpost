/**
 * Your own repost or quote must move the count you see (owner report: tapping
 * Repost turned the icon green but left "112" at 112; quoting did nothing).
 * Likes already bumped the shared count; reposts never did, and undo/rollback
 * then subtracted a +1 that was never added.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adjustStats } from "./stat-adjust";

describe("adjustStats", () => {
  const base = { replies: 56, reposts: 112, likes: 83, zaps: 25, zapAmount: 5300 };

  it("a repost adds one to the repost count and leaves the rest", () => {
    expect(adjustStats(base, "reposts", 1)).toEqual({ ...base, reposts: 113 });
  });

  it("undoing takes it back off", () => {
    expect(adjustStats({ ...base, reposts: 113 }, "reposts", -1)).toEqual(base);
  });

  it("a post with no counts yet starts from zero", () => {
    expect(adjustStats(undefined, "reposts", 1)).toEqual({ replies: 0, reposts: 1, likes: 0, zaps: 0, zapAmount: 0 });
  });

  it("never goes below zero", () => {
    expect(adjustStats({ ...base, reposts: 0 }, "reposts", -1).reposts).toBe(0);
    expect(adjustStats(undefined, "reposts", -1).reposts).toBe(0);
  });
});

describe("every repost and quote moves the count", () => {
  // Each place that publishes a repost (kind 6) or a quote (a note with a
  // q tag) must bump the shared count the moment it's signed.
  const PUBLISHERS = [
    "components/NostrPost.tsx",
    "components/nostr-post/thread.tsx",
    "components/MediaInteractionBar.tsx",
  ];

  it("each repost/quote publisher adds one to reposts", () => {
    const missing = PUBLISHERS.filter((f) => {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      return !/primalStatsCache\.adjust\([^,]+,\s*"reposts",\s*1\)/.test(src);
    });
    expect(missing).toEqual([]);
  });

  it("the quote composer counts the quote", () => {
    const src = readFileSync(resolve(__dirname, "../components/nostr-post/thread.tsx"), "utf8");
    const publish = src.slice(src.indexOf('["q", quotedEvent.id]'));
    expect(publish).toMatch(/primalStatsCache\.adjust\(quotedEvent\.id,\s*"reposts",\s*1\)/);
  });
});
