/**
 * The guest taste-then-wall rule: a shared link shows its content plus a
 * taste; exploring past it is for members. Signed-in users are never capped.
 */
import { describe, it, expect } from "vitest";
import { capForGuest, GUEST_TASTE_COUNT } from "./guest-limits";

const list = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("capForGuest", () => {
  it("signed-in passes through untouched, same reference", () => {
    const items = list(50);
    const out = capForGuest(items, true);
    expect(out.shown).toBe(items);
    expect(out.walled).toBe(false);
  });

  it("guests get the taste and the wall", () => {
    const out = capForGuest(list(50), false);
    expect(out.shown).toHaveLength(GUEST_TASTE_COUNT);
    expect(out.walled).toBe(true);
  });

  it("a short list never walls — a wall under three posts reads as a paywall on nothing", () => {
    const items = list(3);
    const out = capForGuest(items, false);
    expect(out.shown).toBe(items);
    expect(out.walled).toBe(false);
  });

  it("empty stays empty with no wall, so empty-state logic never changes", () => {
    const out = capForGuest([], false);
    expect(out.shown).toEqual([]);
    expect(out.walled).toBe(false);
  });
});

describe("browse surfaces are hard-walled for guests (owner decision, 2026-08-14)", () => {
  // The four browse pages replace their content with the GuestWall outright —
  // the legacy-social model. Shared deep links (a post, an article, an
  // invite, a channel preview) live on other routes and stay open. This scan
  // pins each page's render-gate so a refactor can't quietly reopen a
  // directory to enumeration.
  const WALLED_PAGES = [
    "Discover.tsx",
    "Outposts.tsx",
    "ArticlesFeed.tsx",
    "RSSFeed.tsx",
    "NewsTrending.tsx",
  ];

  it("each browse page gates its render on the viewer's pubkey", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const page of WALLED_PAGES) {
      const src = readFileSync(resolve(__dirname, "../pages", page), "utf8");
      expect(src, `${page} must render GuestWall`).toContain("<GuestWall");
      expect(src, `${page} must gate on !pubkey`).toMatch(/if \(!pubkey\) \{/);
    }
  });

  it("profiles taste-then-wall instead (shared 'look at this person' links stay useful)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../pages/Profile.tsx"), "utf8");
    expect(src).toMatch(/capForGuest\(originalNotes, !!myPubkey\)/);
    expect(src).toContain("<GuestWall");
  });
});
