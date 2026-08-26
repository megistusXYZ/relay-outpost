/**
 * One back arrow per screen — the deepest level owns it (owner report:
 * "← Discover" stacked over "← back to all feeds" on the News page).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parentRouteOf } from "./back-affordance";

describe("parentRouteOf", () => {
  // The chrome back pops history; this map is only its COLD-ENTRY fallback.
  // It preserves what the deleted per-page hero backs used to encode: a help
  // article's way up is the help index, not the messages tab.
  it("help articles climb to the help index", () => {
    expect(parentRouteOf("/help/first-10-minutes")).toBe("/help");
  });

  it("the help index itself is not its own child", () => {
    expect(parentRouteOf("/help")).toBeNull();
  });

  it("What's New climbs home", () => {
    expect(parentRouteOf("/whats-new")).toBe("/");
  });

  it("the danger zone climbs to Settings", () => {
    expect(parentRouteOf("/settings/danger")).toBe("/settings");
  });

  it("tool pages climb to Tools", () => {
    for (const p of ["/key-backup", "/muted", "/media-servers", "/trust-reviews"]) {
      expect(parentRouteOf(p)).toBe("/tools");
    }
  });

  it("community pages climb to Search", () => {
    expect(parentRouteOf("/community/naddr1xyz")).toBe("/search");
  });

  it("a stream detail climbs to the live tab", () => {
    expect(parentRouteOf("/live/naddr1abc")).toBe("/live");
  });

  it("unmapped routes defer to the caller's default", () => {
    expect(parentRouteOf("/thread/abc")).toBeNull();
    expect(parentRouteOf("/")).toBeNull();
  });
});

describe("the chrome back is the only full-page back", () => {
  // Both chrome backs (mobile app bar + desktop classic sidebar row) climb via
  // the parent map on cold entry. If a refactor drops this, cold deep links to
  // help articles fall back to the messages tab again.
  it("HeaderBackButton and DesktopBackButton both consult parentRouteOf", () => {
    const src = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    const uses = src.match(/goBack\(parentRouteOf\(location\) \?\?/g) ?? [];
    expect(uses.length).toBe(2);
  });

  // The hero backs deleted in this sweep must not creep back: a full page's
  // way up is the chrome back, not a second arrow under it.
  it("no page re-grows a hero back to the help index", () => {
    const dir = resolve(__dirname, "../pages");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => {
        const src = readFileSync(resolve(dir, f), "utf8");
        return /<Link href="\/help"[^>]*>\s*<ArrowLeft/.test(src);
      });
    expect(offenders).toEqual([]);
  });
});

describe("News has no header back at all", () => {
  // The "← Discover" header back was first gated (deepest level owns the
  // arrow, #663), then removed outright (owner call, 2026-08-14): the bottom
  // bar's Discover tab already returns to the bento in one tap, so the header
  // back said the same thing twice. Keep it gone — News's only in-page arrow
  // is the feed-level back-to-all.
  it("no page renders button-news-back-discover", () => {
    const dir = resolve(__dirname, "../pages");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => readFileSync(resolve(dir, f), "utf8").includes("button-news-back-discover"));
    expect(offenders).toEqual([]);
  });
});
