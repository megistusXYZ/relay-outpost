import { describe, it, expect } from "vitest";
import { isNavItemActive } from "./sidebar-nav";

// The four primary nav entries as app-sidebar renders them (Search standalone +
// the Feed·Media·News browse group). Media/News share the /search?tab=media path.
const ITEMS = [
  { title: "Search", path: "/search" },
  { title: "Feed", path: "/" },
  { title: "Media", path: "/search?tab=media" },
  { title: "News", path: "/search?tab=media&type=news" },
];

const activeTitles = (location: string, search: string) =>
  ITEMS.filter((it) => isNavItemActive(location, search, it)).map((it) => it.title);

describe("isNavItemActive", () => {
  it("marks exactly one nav item active per route (regression: multiple items lit)", () => {
    expect(activeTitles("/", "")).toEqual(["Feed"]);
    expect(activeTitles("/search", "")).toEqual(["Search"]);
    expect(activeTitles("/search", "tab=people")).toEqual(["Search"]);
    expect(activeTitles("/search", "tab=media")).toEqual(["Media"]);
    expect(activeTitles("/search", "tab=media&type=news")).toEqual(["News"]);
  });

  it("distinguishes Media from News under /search?tab=media", () => {
    const media = { title: "Media", path: "/search?tab=media" };
    const news = { title: "News", path: "/search?tab=media&type=news" };
    expect(isNavItemActive("/search", "tab=media", media)).toBe(true);
    expect(isNavItemActive("/search", "tab=media", news)).toBe(false);
    expect(isNavItemActive("/search", "tab=media&type=news", news)).toBe(true);
    expect(isNavItemActive("/search", "tab=media&type=news", media)).toBe(false);
  });

  it("does not mark Search active on media or news views", () => {
    const search = { title: "Search", path: "/search" };
    expect(isNavItemActive("/search", "", search)).toBe(true);
    expect(isNavItemActive("/search", "tab=people", search)).toBe(true);
    expect(isNavItemActive("/search", "tab=media", search)).toBe(false);
    expect(isNavItemActive("/search", "tab=media&type=news", search)).toBe(false);
  });

  it("marks Feed active only on the root feed", () => {
    const feed = { title: "Feed", path: "/" };
    expect(isNavItemActive("/", "", feed)).toBe(true);
    expect(isNavItemActive("/search", "", feed)).toBe(false);
    expect(isNavItemActive("/messages", "", feed)).toBe(false);
  });

  it("tolerates a leading '?' in the search string", () => {
    expect(activeTitles("/search", "?tab=media")).toEqual(["Media"]);
  });
});
