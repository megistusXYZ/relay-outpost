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
  it("start the trusted people's posts together with the trending pool, not after it", () => {
    const all = teaser.match(/await Promise\.all\(\[([\s\S]*?)\]\);/);
    expect(all, "one Promise.all for the pool").not.toBeNull();
    expect(all![1]).toContain("trustedPostsP");
    expect(all![1]).toContain("fetchGlobalFeed(");
  });

  it("don't wait on the pool before asking for the trusted list", () => {
    const beforeAll = teaser.slice(0, teaser.indexOf("await Promise.all(["));
    // Asked for at once, and its relay lookup decided as soon as the server's
    // sample has or hasn't arrived (milliseconds), never on the app's own read.
    expect(beforeAll).toMatch(/const trustedPostsP(?::[^=]+)? = Promise\.all\(\[loadDiscoverTrust\(\[\], trustOpts\), recentSample\.fromServer\]\)/);
  });
});
