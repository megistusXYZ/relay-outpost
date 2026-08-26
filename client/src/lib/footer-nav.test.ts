import { describe, it, expect } from "vitest";
import { isNavDestinationActive, isChatOverlayRoute, isChatsTabActive, isCommunitiesTabActive, isNewsTabActive } from "./footer-nav";

// The footer's two chat-adjacent tabs. Feed/Alerts are trivial prefix checks;
// these two carve up the /messages + /outposts route space and must never both
// light up (Concord group chats live under /outposts/c/ but belong to Chats).
const activeTabs = (location: string) =>
  [
    isChatsTabActive(location) ? "Chats" : null,
    isCommunitiesTabActive(location) ? "Communities" : null,
  ].filter(Boolean);

describe("isChatsTabActive / isCommunitiesTabActive", () => {
  it("marks at most one of Chats/Communities active per route", () => {
    expect(activeTabs("/")).toEqual([]);
    expect(activeTabs("/messages")).toEqual(["Chats"]);
    expect(activeTabs("/messages/npub1abc")).toEqual(["Chats"]);
    expect(activeTabs("/outposts")).toEqual(["Communities"]);
    expect(activeTabs("/outposts/wss%3A%2F%2Frelay.example.com")).toEqual(["Communities"]);
    expect(activeTabs("/outposts/c/abc123")).toEqual(["Chats"]);
  });

  it("Chats claims Concord group chats under /outposts/c/", () => {
    expect(isChatsTabActive("/outposts/c/abc123")).toBe(true);
    expect(isCommunitiesTabActive("/outposts/c/abc123")).toBe(false);
  });

  it("Communities claims the hub and NIP-29 outpost detail routes only", () => {
    expect(isCommunitiesTabActive("/outposts")).toBe(true);
    expect(isCommunitiesTabActive("/outposts/wss%3A%2F%2Frelay.example.com")).toBe(true);
    expect(isCommunitiesTabActive("/messages")).toBe(false);
    expect(isCommunitiesTabActive("/")).toBe(false);
    // Prefix must be a real path segment boundary case we care about: the hub
    // route itself and children — but NOT an unrelated sibling route.
    expect(isCommunitiesTabActive("/outposts-other")).toBe(false);
  });

  it("neither tab is active on unrelated routes", () => {
    for (const loc of ["/", "/notifications", "/search", "/calendar", "/relays"]) {
      expect(activeTabs(loc)).toEqual([]);
    }
  });
});

describe("isNewsTabActive", () => {
  it("is active only on /search with a type=news query", () => {
    expect(isNewsTabActive("/search", "tab=media&type=news")).toBe(true);
    expect(isNewsTabActive("/search", "type=news")).toBe(true);
    // Leading "?" tolerated (some call sites include it).
    expect(isNewsTabActive("/search", "?tab=media&type=news")).toBe(true);
  });

  it("is inactive on /search without type=news", () => {
    expect(isNewsTabActive("/search", "")).toBe(false);
    expect(isNewsTabActive("/search", "tab=media")).toBe(false);
    expect(isNewsTabActive("/search", "type=media")).toBe(false);
  });

  it("is inactive off the /search pathname regardless of query", () => {
    expect(isNewsTabActive("/", "type=news")).toBe(false);
    expect(isNewsTabActive("/outposts", "type=news")).toBe(false);
    expect(isNewsTabActive("/search-other", "type=news")).toBe(false);
  });
});

describe("isChatOverlayRoute (dm-thread hide-contract whitelist)", () => {
  it("whitelists exactly the DM and Concord chat overlay hosts", () => {
    expect(isChatOverlayRoute("/messages")).toBe(true);
    expect(isChatOverlayRoute("/messages/npub1abc")).toBe(true);
    expect(isChatOverlayRoute("/outposts/c/abc123")).toBe(true);
  });

  it("does NOT whitelist other routes — they must reset the hidden footer", () => {
    expect(isChatOverlayRoute("/")).toBe(false);
    expect(isChatOverlayRoute("/outposts")).toBe(false);
    expect(isChatOverlayRoute("/outposts/wss%3A%2F%2Frelay.example.com")).toBe(false);
    expect(isChatOverlayRoute("/notifications")).toBe(false);
  });

  it("matches MobileFooter's inline whitelist expression exactly", () => {
    // Locks the contract: the inline line in MobileFooter.tsx (~:76) is
    // `!location.startsWith("/messages") && !location.startsWith("/outposts/c/")`
    // — the negation of this predicate — and Chats-tab active state must agree.
    const inlineResets = (location: string) =>
      !location.startsWith("/messages") && !location.startsWith("/outposts/c/");
    for (const loc of ["/", "/messages", "/messages/npub1x", "/outposts", "/outposts/c/x", "/outposts/wss%3A%2F%2Fr", "/notifications"]) {
      expect(isChatOverlayRoute(loc)).toBe(!inlineResets(loc));
      expect(isChatsTabActive(loc)).toBe(isChatOverlayRoute(loc));
    }
  });
});

// The desktop rail kept its OWN active-state matcher instead of adopting this
// one, and special-cased on nav TITLE strings ("Feed"/"Media"/"News"). The
// collapsed IA renames home to "Discover", which matched none of them, so it
// fell through to location.startsWith("/") — true on every route in the app.
// The rail marked Discover aria-current="page" everywhere, alongside whichever
// destination was genuinely current: two current pages at once. These tests pin
// the shared predicate for EVERY id either surface can render, so the rail can
// delete its copy rather than have "Discover" bolted onto a title list that
// would go stale again at the next rename.
describe("isNavDestinationActive — rail-only ids", () => {
  it("lights Media and News only on their query-scoped views", () => {
    expect(isNavDestinationActive("media", "/search", "tab=media")).toBe(true);
    expect(isNavDestinationActive("media", "/search", "tab=media&type=news")).toBe(false);
    expect(isNavDestinationActive("media", "/search", "tab=people")).toBe(false);
    expect(isNavDestinationActive("news", "/search", "tab=media&type=news")).toBe(true);
  });

  it("lights Alerts on notifications and Calendar on its own route", () => {
    expect(isNavDestinationActive("alerts", "/notifications", "")).toBe(true);
    expect(isNavDestinationActive("alerts", "/", "")).toBe(false);
    expect(isNavDestinationActive("calendar", "/calendar", "")).toBe(true);
    expect(isNavDestinationActive("calendar", "/", "")).toBe(false);
  });

  it("never lights an action entry — Create opens a composer, it isn't a place", () => {
    expect(isNavDestinationActive("create", "/", "")).toBe(false);
  });
});

describe("isNavDestinationActive — exactly one collapsed destination per route", () => {
  const COLLAPSED = ["chats", "activity", "discover", "you"];
  const ROUTES: Array<[string, string, string]> = [
    ["/discover", "", "discover"],
    // The bento's standalone lanes belong to the tab that opened them.
    ["/news", "", "discover"],
    ["/articles", "", "discover"],
    ["/articles/naddr1abc", "", "discover"],
    ["/search", "tab=people", "discover"],
    ["/messages", "", "chats"],
    ["/outposts", "", "chats"],
    ["/outposts/c/abc", "", "chats"],
    ["/notifications", "", "activity"],
    ["/account", "", "you"],
    ["/account/menu", "", "you"],
  ];

  it.each(ROUTES)("%s?%s lights only %s", (location, search, expected) => {
    const lit = COLLAPSED.filter((id) => isNavDestinationActive(id, location, search, true));
    expect(lit).toEqual([expected]);
  });

  it("does not light Discover away from its routes — the bug that shipped", () => {
    // location.startsWith("/") is true everywhere; this is the regression.
    const discoverOwned = (l: string) =>
      l.startsWith("/discover") || l.startsWith("/search") || l === "/news" || l.startsWith("/articles");
    for (const [location, search] of ROUTES.filter(([l]) => !discoverOwned(l))) {
      expect(isNavDestinationActive("discover", location, search, true)).toBe(false);
    }
  });

  it("lights NOTHING on the feed — since the bento, / is a place you visit FROM Discover", () => {
    // The feed is the Feed tile's destination, not the Discover tab's home.
    // Lighting Discover while reading the feed would claim you are somewhere
    // you are not; lighting nothing is the honest state (same as /thread/…).
    const lit = COLLAPSED.filter((id) => isNavDestinationActive(id, "/", "", true));
    expect(lit).toEqual([]);
  });
});

describe("isNavDestinationActive — one predicate for both footer layouts", () => {
  it("lights the legacy tabs on their own routes", () => {
    expect(isNavDestinationActive("feed", "/", "")).toBe(true);
    expect(isNavDestinationActive("feed", "/messages", "")).toBe(false);
    expect(isNavDestinationActive("news", "/search", "tab=media&type=news")).toBe(true);
    // The standalone routes are back (Discover bento) — both spellings light.
    expect(isNavDestinationActive("news", "/news", "")).toBe(true);
    expect(isNavDestinationActive("media", "/articles", "")).toBe(true);
    // The Create studio's article editor is not a browsing lane.
    expect(isNavDestinationActive("discover", "/articles/write", "", true)).toBe(false);
    expect(isNavDestinationActive("communities", "/outposts", "")).toBe(true);
    expect(isNavDestinationActive("chats", "/messages", "")).toBe(true);
  });

  it("keeps the legacy Chats/Communities split through /outposts/c/", () => {
    // Group chats live under /outposts/c/ but belong to Chats — unchanged.
    expect(isNavDestinationActive("chats", "/outposts/c/abc", "")).toBe(true);
    expect(isNavDestinationActive("communities", "/outposts/c/abc", "")).toBe(false);
  });

  it("gives Chats the whole /outposts namespace once collapsed", () => {
    // With no Communities tab, your communities ARE your chats.
    expect(isNavDestinationActive("chats", "/outposts", "", true)).toBe(true);
    expect(isNavDestinationActive("chats", "/outposts/c/abc", "", true)).toBe(true);
    expect(isNavDestinationActive("chats", "/messages", "", true)).toBe(true);
  });

  it("lights Activity, Discover and You on their routes", () => {
    expect(isNavDestinationActive("activity", "/notifications", "", true)).toBe(true);
    expect(isNavDestinationActive("discover", "/discover", "", true)).toBe(true);
    expect(isNavDestinationActive("discover", "/search", "tab=people", true)).toBe(true);
    expect(isNavDestinationActive("you", "/account", "", true)).toBe(true);
    expect(isNavDestinationActive("you", "/account/menu", "", true)).toBe(true);
  });

  it("never lights two tabs at once on a given route", () => {
    const ids = ["chats", "activity", "discover", "you"] as const;
    for (const loc of ["/", "/discover", "/news", "/messages", "/notifications", "/account", "/outposts", "/search"]) {
      const lit = ids.filter((id) => isNavDestinationActive(id, loc, "", true));
      expect(lit.length, `${loc} lit ${lit.join(",")}`).toBeLessThanOrEqual(1);
    }
  });
});
