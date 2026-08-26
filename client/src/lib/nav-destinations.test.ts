import { describe, it, expect } from "vitest";
import { buildNavDestinations, buildFooterTabs, NAV_ICONS, type NavDestinationId } from "./nav-destinations";

const ZERO = { chatsUnread: 0, newsUnread: 0, alertsUnread: 0, needsYou: 0 };

const ids = (loggedIn: boolean, counts = ZERO): NavDestinationId[] =>
  buildNavDestinations({ loggedIn, counts }).map((d) => d.id);

describe("buildNavDestinations", () => {
  it("gives signed-in users the full most-used-first node list", () => {
    expect(ids(true)).toEqual([
      "feed",
      "chats",
      "news",
      "alerts",
      "media",
      "calendar",
      "communities",
      "create",
    ]);
  });

  it("gives signed-out visitors only the public destinations (no create, no personal counts)", () => {
    expect(ids(false)).toEqual(["feed", "media", "news", "communities"]);
    // No action node and no chats/alerts for logged-out.
    const list = buildNavDestinations({ loggedIn: false, counts: ZERO });
    expect(list.some((d) => d.isAction)).toBe(false);
    expect(list.some((d) => d.id === "chats" || d.id === "alerts")).toBe(false);
  });

  it("attaches live counts + glow only when the count is > 0", () => {
    const list = buildNavDestinations({
      loggedIn: true,
      counts: { chatsUnread: 3, newsUnread: 0, alertsUnread: 12, needsYou: 0 },
    });
    const chats = list.find((d) => d.id === "chats")!;
    const news = list.find((d) => d.id === "news")!;
    const alerts = list.find((d) => d.id === "alerts")!;
    expect(chats.count).toBe(3);
    expect(chats.live).toBe(true);
    expect(news.count).toBeUndefined();
    expect(news.live).toBe(false);
    expect(alerts.count).toBe(12);
    expect(alerts.live).toBe(true);
  });

  it("marks Create as the only action node and gives every other node a path", () => {
    const list = buildNavDestinations({ loggedIn: true, counts: ZERO });
    for (const d of list) {
      if (d.id === "create") {
        expect(d.isAction).toBe(true);
        expect(d.path).toBeUndefined();
      } else {
        expect(d.isAction).toBeFalsy();
        expect(typeof d.path).toBe("string");
      }
    }
  });

  it("exposes an icon for every destination id it can emit", () => {
    const allIds = new Set<NavDestinationId>([
      ...ids(true),
      ...ids(false),
    ]);
    for (const id of allIds) {
      // Icons are either plain function components (custom icons) or
      // forwardRef objects (lucide) — both are renderable, non-null values.
      expect(NAV_ICONS[id]).toBeTruthy();
      expect(["function", "object"]).toContain(typeof NAV_ICONS[id]);
    }
  });
});

describe("buildNavDestinations — the collapsed IA (Chats · Activity · Discover · You)", () => {
  const collapsedIds = (loggedIn: boolean, counts = ZERO): NavDestinationId[] =>
    buildNavDestinations({ loggedIn, counts, collapsed: true }).map((d) => d.id);

  it("leaves the existing 8-destination list untouched when the flag is off", () => {
    // The whole point of shipping this dark: nothing moves until the flag flips.
    expect(ids(true)).toEqual(buildNavDestinations({ loggedIn: true, counts: ZERO, collapsed: false }).map((d) => d.id));
    expect(ids(true)).toHaveLength(8);
  });

  it("gives signed-in users exactly four destinations, in order", () => {
    expect(collapsedIds(true)).toEqual(["chats", "activity", "discover", "you"]);
  });

  it("drops Create from the nav — creating happens inside wherever you are", () => {
    expect(collapsedIds(true)).not.toContain("create");
    expect(buildNavDestinations({ loggedIn: true, counts: ZERO, collapsed: true }).some((d) => d.isAction)).toBe(false);
  });

  it("shows a signed-out visitor only Discover — the rest need an account", () => {
    expect(collapsedIds(false)).toEqual(["discover"]);
  });

  it("never badges Discover with News unread — Discover cannot clear it", () => {
    // Discover routes to "/", the feed; News lives at a search route. Badging
    // Discover with news put a number on a destination that did not contain the
    // items, so tapping it never moved the count. Reported live as "Discover is
    // showing notifications".
    const list = buildNavDestinations({ loggedIn: true, counts: { ...ZERO, newsUnread: 4 }, collapsed: true });
    const discover = list.find((d) => d.id === "discover");
    expect(discover?.count).toBeUndefined();
    expect(discover?.live).toBeFalsy();
  });

  it("still badges Discover with nothing when news is quiet", () => {
    const list = buildNavDestinations({ loggedIn: true, counts: ZERO, collapsed: true });
    expect(list.find((d) => d.id === "discover")?.count).toBeUndefined();
  });

  it("keeps chat and activity counts on their own destinations", () => {
    const list = buildNavDestinations({ loggedIn: true, counts: { chatsUnread: 3, newsUnread: 0, alertsUnread: 7, needsYou: 0 }, collapsed: true });
    expect(list.find((d) => d.id === "chats")?.count).toBe(3);
    expect(list.find((d) => d.id === "activity")?.count).toBe(7);
    expect(list.find((d) => d.id === "you")?.count).toBeUndefined();
  });

  it("has an icon and a title for every collapsed destination", () => {
    for (const d of buildNavDestinations({ loggedIn: true, counts: ZERO, collapsed: true })) {
      expect(NAV_ICONS[d.id]).toBeTruthy();
      expect(d.title).toBeTruthy();
      expect(d.path).toBeTruthy();
    }
  });
});

describe("buildFooterTabs — the mobile footer's four slots", () => {
  it("preserves today's footer exactly while the flag is off", () => {
    const tabs = buildFooterTabs({ loggedIn: true, counts: ZERO });
    expect(tabs.map((t) => t.id)).toEqual(["feed", "news", "communities", "chats"]);
    expect(tabs.map((t) => t.path)).toEqual(["/", "/news", "/outposts", "/messages"]);
  });

  it("becomes the collapsed list once the flag is on — same four as the rail", () => {
    expect(buildFooterTabs({ loggedIn: true, counts: ZERO, collapsed: true }).map((t) => t.id))
      .toEqual(["chats", "activity", "discover", "you"]);
  });

  it("never includes the centre Create action — the footer owns that itself", () => {
    for (const collapsed of [false, true]) {
      expect(buildFooterTabs({ loggedIn: true, counts: ZERO, collapsed }).some((t) => t.isAction)).toBe(false);
    }
  });

  it("carries the badge counts each layout needs", () => {
    const counts = { chatsUnread: 2, newsUnread: 5, alertsUnread: 9, needsYou: 0 };
    const legacy = buildFooterTabs({ loggedIn: true, counts });
    expect(legacy.find((t) => t.id === "chats")?.count).toBe(2);
    expect(legacy.find((t) => t.id === "news")?.count).toBe(5);
    const next = buildFooterTabs({ loggedIn: true, counts, collapsed: true });
    expect(next.find((t) => t.id === "activity")?.count).toBe(9);
    expect(next.find((t) => t.id === "discover")?.count).toBeUndefined();
  });
});

/**
 * The doorman's number, which had no consumer at all until Stage 2.5: both
 * queues computed `queue.length` and nothing rendered it, so an operator
 * learned somebody was waiting by opening Activity on a hunch.
 */
describe("the Needs-you count reaches the Activity badge", () => {
  it("adds decisions to the Activity badge", () => {
    const list = buildNavDestinations({
      loggedIn: true,
      counts: { chatsUnread: 0, newsUnread: 0, alertsUnread: 4, needsYou: 2 },
      collapsed: true,
    });
    expect(list.find((d) => d.id === "activity")?.count).toBe(6);
  });

  it("badges Activity on a decision alone, with zero unread", () => {
    // The case that matters: a quiet account with one stranger at the door.
    const list = buildNavDestinations({
      loggedIn: true,
      counts: { chatsUnread: 0, newsUnread: 0, alertsUnread: 0, needsYou: 1 },
      collapsed: true,
    });
    const activity = list.find((d) => d.id === "activity");
    expect(activity?.count).toBe(1);
    expect(activity?.live).toBe(true);
  });

  it("stays silent when nothing is waiting and nothing is unread", () => {
    const list = buildNavDestinations({ loggedIn: true, counts: ZERO, collapsed: true });
    const activity = list.find((d) => d.id === "activity");
    expect(activity?.count).toBeUndefined();
    expect(activity?.live).toBe(false);
  });

  it("never lets a missing needsYou delete the alerts badge", () => {
    // A caller omitting the field must degrade to "no needs-you", never to
    // NaN — which would silently take the unread count down with it.
    const legacy = { chatsUnread: 0, newsUnread: 0, alertsUnread: 5 } as never;
    const list = buildNavDestinations({ loggedIn: true, counts: legacy, collapsed: true });
    expect(list.find((d) => d.id === "activity")?.count).toBe(5);
  });

  it("carries the same number into the mobile footer", () => {
    // Three surfaces render this badge; they must not disagree.
    const counts = { chatsUnread: 0, newsUnread: 0, alertsUnread: 1, needsYou: 3 };
    const tabs = buildFooterTabs({ loggedIn: true, counts, collapsed: true });
    const nav = buildNavDestinations({ loggedIn: true, counts, collapsed: true });
    expect(tabs.find((d) => d.id === "activity")?.count).toBe(4);
    expect(nav.find((d) => d.id === "activity")?.count).toBe(4);
  });
});
