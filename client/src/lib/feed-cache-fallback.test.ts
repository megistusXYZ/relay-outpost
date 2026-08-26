/**
 * The cached feed is a FALLBACK, not the first paint.
 *
 * Discover painted the previous session's feed the moment IndexedDB answered,
 * killed the skeleton, and then replaced the whole thing when the real results
 * landed — reported as "old posts and engagements flashing at first before
 * loading in the proper feed".
 *
 * Measured on the same load: IndexedDB 3ms, the feed API 1431ms. The authors
 * had already written the race — the paint is skipped when the fresh load got
 * there first — but a 3ms answer beats a 1431ms one every single time, so the
 * guard never fired. Giving the network a head start is what makes it work.
 *
 * Source-reading, because the behaviour is a timing relationship inside a 4000
 * line component's effect; a render test would need the whole feed pipeline and
 * would prove less than reading the two lines that matter.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "client", "src", "pages", "Home.tsx"), "utf8");
const code = SRC
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

describe("the Discover feed cache", () => {
  it("waits for the network before painting", () => {
    // Deliberately anchored to the CLOSING `}, CACHE_FALLBACK_DELAY_MS)`, not
    // merely to a nearby setTimeout. The looser version of this assertion
    // passed when the paint was moved back out of the callback and a stray
    // `setTimeout(() => {}, 0)` was left beside it — a test that cannot fail
    // for the reason it names is worse than no test.
    expect(code).toMatch(
      /setTimeout\(\(\) => \{[\s\S]*?getCachedFeedEvents\("global_feed"\)[\s\S]*?\}, CACHE_FALLBACK_DELAY_MS\)/,
    );
  });

  it("waits longer than the network typically takes, or the flash returns", () => {
    // 1431ms measured. A token 200-300ms delay would leave the cache winning
    // the race exactly as before, which is the failure mode this guards.
    const m = code.match(/const CACHE_FALLBACK_DELAY_MS = (\d+);/);
    expect(m, "CACHE_FALLBACK_DELAY_MS missing").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1500);
  });

  it("still keeps the race guard, so a fast network skips the cache entirely", () => {
    // Without this the delayed paint would clobber fresh results that already
    // arrived — turning a stale first paint into a stale SECOND one.
    expect(code).toMatch(/if \(initialLoadDoneRef\.current\) return;/);
  });

  it("cancels the pending paint on unmount", () => {
    // Otherwise navigating away inside the window fires a paint into a dead
    // component, and on return the cache has been marked as loaded.
    expect(code).toMatch(/clearTimeout\(cacheFallback\)/);
  });

  it("still paints the cache when the network does not answer", () => {
    // The case the cache genuinely exists for. Deleting the fallback would be a
    // different regression: offline gets an empty feed instead of last session's.
    expect(code).toMatch(/getCachedFeedEvents\("global_feed"\)[\s\S]{0,200}eventStore\.add\(e\)/);
  });
});
