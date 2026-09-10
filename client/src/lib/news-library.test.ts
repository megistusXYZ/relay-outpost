/**
 * The News library: which of your sources belong in News and which in Listen.
 *
 * Asked 2026-09-10: the News page felt "forced with our agenda and presets".
 * Its "All feeds" stream mixed 11 starter outlets with ALL 76 preset podcasts
 * (Rogan, betting shows, gun reviews, Abraham Hicks…) whether or not you ever
 * chose them, so podcasts dominated the page. The owner's call: News is your
 * own news sources only; podcasts get their own Listen lane.
 *
 * Category names can't tell the two apart: "Sports" is both a news section
 * and a podcast category. What a source IS decides its lane.
 */
import { describe, expect, it } from "vitest";
import { LEGACY_STARTER_URLS_V1, STARTER_URLS_V2, deriveLibrary, laneFeeds, laneOf, migrateNewsLibrary, removeFromLibrary } from "./news-library";
import { ALL_NEWS_FEEDS, ALL_PODCAST_FEEDS, type SavedFeed } from "./rss-feeds";

describe("laneOf — which lane a source belongs in", () => {
  it("puts a podcast in Listen and a news outlet in News, even when both are filed under Sports", () => {
    const sportsShow = ALL_PODCAST_FEEDS.find((f) => f.category === "Sports");
    const sportsDesk = ALL_NEWS_FEEDS.find((f) => f.category === "Sports");
    expect(sportsShow, "fixture: a preset podcast filed under Sports").toBeDefined();
    expect(sportsDesk, "fixture: a preset news feed filed under Sports").toBeDefined();
    expect(laneOf(sportsShow!)).toBe("listen");
    expect(laneOf(sportsDesk!)).toBe("news");
  });

  it("keeps News to your news sources, in your order, with no podcasts mixed in", () => {
    const blog: SavedFeed = { name: "A blog I like", url: "https://example.com/feed.xml", category: "Custom" };
    const show = ALL_PODCAST_FEEDS[0];
    const outlet = ALL_NEWS_FEEDS[0];
    expect(laneFeeds([blog, show, outlet], "news").map((f) => f.url)).toEqual([blog.url, outlet.url]);
    expect(laneFeeds([blog, show, outlet], "listen").map((f) => f.url)).toEqual([show.url]);
  });
});

/**
 * Renaming a starter source stores a renamed copy and hides the original.
 * Removing it afterwards only hid the original again, so the renamed copy
 * survived and the source came back after a reload.
 */
describe("removeFromLibrary — removing a source takes it out for good", () => {
  it("removes a starter source you had renamed", () => {
    const fortune = "https://fortune.com/feed/";
    const renamed = {
      custom: [{ name: "My business news", url: fortune, category: "Business & Finance" }],
      hidden: new Set([fortune]),
    };
    const after = removeFromLibrary(renamed, fortune);
    expect(deriveLibrary(STARTER_URLS_V2, after).map((f) => f.url)).not.toContain(fortune);
  });
});

/**
 * The starter changes from today's 36 (11 news + 25 podcasts, incl. ZeroHedge,
 * The Free Press, Rogan…) to 8 broad outlets. A library is never stored as a
 * list: it is derived from the built-in starter, minus hidden sources, plus
 * added ones. So swapping the starter would silently rewrite the library of
 * everyone who ever added or removed a source. The migration's promise: a
 * library someone shaped comes out exactly the same, in the same order; only
 * a library nobody touched gets the new starter.
 */
describe("migrateNewsLibrary — the new starter never changes a library someone shaped", () => {
  const urls = (feeds: SavedFeed[]) => feeds.map((f) => f.url);
  const zeroHedge = "https://feeds.feedburner.com/zerohedge/feed";
  const rogan = "https://feeds.megaphone.fm/GLT1412515089";
  const myBlog: SavedFeed = { name: "A blog I like", url: "https://example.com/feed.xml", category: "Custom" };

  it("keeps a customised library exactly as it was, in the same order", () => {
    const customised = [
      { custom: [], hidden: new Set([zeroHedge]) },
      { custom: [myBlog], hidden: new Set<string>() },
      { custom: [myBlog], hidden: new Set([zeroHedge, rogan]) },
    ];
    for (const stored of customised) {
      const before = urls(deriveLibrary(LEGACY_STARTER_URLS_V1, stored));
      const after = urls(deriveLibrary(STARTER_URLS_V2, migrateNewsLibrary(stored)));
      expect(after).toEqual(before);
    }
  });

  it("changes nothing when it runs again on a library it already carried over", () => {
    const once = migrateNewsLibrary({ custom: [myBlog], hidden: new Set([zeroHedge]) });
    const twice = migrateNewsLibrary(once);
    expect(urls(twice.custom)).toEqual(urls(once.custom));
    expect([...twice.hidden].sort()).toEqual([...once.hidden].sort());
  });

  it("gives a library nobody touched the new starter of 8 broad outlets, and no podcasts", () => {
    const untouched = { custom: [], hidden: new Set<string>() };
    const library = deriveLibrary(STARTER_URLS_V2, migrateNewsLibrary(untouched));
    expect(new Set(urls(library))).toEqual(new Set([
      "https://feeds.bbci.co.uk/news/world/rss.xml",
      "https://feeds.npr.org/1001/rss.xml",
      "https://www.theguardian.com/world/rss",
      "https://www.theverge.com/rss/index.xml",
      "https://www.theatlantic.com/feed/all/",
      "https://fortune.com/feed/",
      "https://www.nasa.gov/news-release/feed/",
      "https://frontofficesports.com/feed/",
    ]));
    expect(laneFeeds(library, "listen")).toEqual([]);
  });
});
