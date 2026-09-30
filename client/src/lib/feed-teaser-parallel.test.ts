/**
 * The Discover Feed tile's lookups run side by side (measured 2026-09-29: the
 * trusted people's posts waited for the first batch to finish, ~8 s + ~8 s,
 * though they don't depend on it). Pinned on the source because the fetch is
 * wired to live relays; the before/after timing is measured in the browser.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.resolve(import.meta.dirname, "discover-data.ts"), "utf8");
const teaser = src.slice(src.indexOf("async function fetchFeedTeaserFresh("), src.indexOf("// ── Communities"));

describe("the Feed tile's lookups", () => {
  it("start the trusted people's posts together with the rest of the pool, not after it", () => {
    const all = teaser.match(/await Promise\.all\(\[([\s\S]*?)\]\);/);
    expect(all, "one Promise.all for the pool").not.toBeNull();
    expect(all![1]).toContain("trustedPostsP");
    expect(all![1]).toContain("recentSample.sample");
  });

  // Owner, 2026-09-30: Primal is support, not the main. Its trending posts are
  // asked for up front, alongside everything else, but the tile doesn't wait
  // for them: it gives them a short grace once its own sources are in hand.
  it("ask Primal up front, and never wait on it beyond a short grace", () => {
    const pool = teaser.indexOf("await Promise.all([");
    expect(teaser.indexOf("fetchGlobalFeed(")).toBeGreaterThan(-1);
    expect(teaser.indexOf("fetchGlobalFeed(")).toBeLessThan(pool);
    expect(teaser.slice(pool)).toMatch(/Promise\.race\(\[primalP, new Promise<Event\[\]>\(\(r\) => setTimeout\(\(\) => r\(\[\]\), PRIMAL_GRACE_MS\)\)\]\)/);
    expect(teaser).not.toMatch(/await prefetchStatsImmediate/);
  });

  it("don't wait on the pool before asking for the trusted list", () => {
    const beforeAll = teaser.slice(0, teaser.indexOf("await Promise.all(["));
    // Asked for at once, and its relay lookup decided as soon as the server's
    // sample has or hasn't arrived (milliseconds), never on the app's own read.
    expect(beforeAll).toMatch(/const trustedPostsP(?::[^=]+)? = Promise\.all\(\[loadDiscoverTrust\(\[\], trustOpts\), recentSample\.fromServer\]\)/);
  });
});
