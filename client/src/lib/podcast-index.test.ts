import { describe, it, expect } from "vitest";
import {
  formatDuration,
  feedCategoryNames,
  feedSupportsValue,
  mergeDedupeById,
  clampMax,
  buildTrendingUrl,
  buildSearchUrl,
  stripHtml,
  normalizeShowTitle,
  showTitleTokenKey,
  matchPresetShow,
  buildResolveUrl,
  buildTrendSuggestionsUrl,
  PODCAST_CATEGORIES,
  PRESET_CATEGORY_PILLS,
  PRESET_SHOWS,
  type PodcastFeed,
} from "./podcast-index";

const feed = (id: number, extra: Partial<PodcastFeed> = {}): PodcastFeed => ({
  id,
  title: `Feed ${id}`,
  author: "",
  description: "",
  image: "",
  url: `https://example.com/${id}.xml`,
  episodeCount: 0,
  language: "en",
  ...extra,
});

describe("formatDuration", () => {
  it("formats sub-hour lengths as minutes", () => {
    expect(formatDuration(42 * 60)).toBe("42 min");
    expect(formatDuration(60)).toBe("1 min");
    expect(formatDuration(90)).toBe("2 min"); // 1.5 min rounds to 2
    expect(formatDuration(59 * 60)).toBe("59 min");
  });

  it("formats hour+ lengths as Hh Mm and drops zero minutes", () => {
    expect(formatDuration(3600 + 15 * 60)).toBe("1h 15m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe("2h 5m");
  });

  it("rounds sub-minute lengths up to 1 min (never 0 min)", () => {
    expect(formatDuration(1)).toBe("1 min");
    expect(formatDuration(30)).toBe("1 min");
    expect(formatDuration(59)).toBe("1 min");
  });

  it("returns empty string for missing / zero / negative values", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-30)).toBe("");
    expect(formatDuration(NaN)).toBe("");
    expect(formatDuration(Infinity)).toBe("");
  });

  it("treats implausibly large values as milliseconds", () => {
    // 90 minutes expressed in ms (5,400,000) should read as 1h 30m, not 1500h.
    expect(formatDuration(90 * 60 * 1000)).toBe("1h 30m");
    // 42 minutes in ms.
    expect(formatDuration(42 * 60 * 1000)).toBe("42 min");
  });

  it("rolls minute-rounding into the hour cleanly", () => {
    // 1h 59m 40s → minutes round to 60 → 2h
    expect(formatDuration(3600 + 59 * 60 + 40)).toBe("2h");
  });
});

describe("category catalog + preset pills", () => {
  it("has the full Podcast Index catalog of 112 categories", () => {
    expect(PODCAST_CATEGORIES).toHaveLength(112);
    const ids = new Set(PODCAST_CATEGORIES.map((c) => c.id));
    expect(ids.size).toBe(112); // no duplicate ids
    expect(PODCAST_CATEGORIES.find((c) => c.id === 1)?.name).toBe("Arts");
    expect(PODCAST_CATEGORIES.find((c) => c.id === 112)?.name).toBe("Cryptocurrency");
  });

  it("maps every non-Top preset pill to a real category id whose name matches its label", () => {
    for (const pill of PRESET_CATEGORY_PILLS) {
      if (pill.cat === null) {
        expect(pill.key).toBe("top");
        continue;
      }
      const cat = PODCAST_CATEGORIES.find((c) => String(c.id) === pill.cat);
      expect(cat, `pill ${pill.label} → cat ${pill.cat}`).toBeTruthy();
      expect(cat!.name).toBe(pill.label);
    }
  });

  it("leads with Top and covers the mainstream spread", () => {
    expect(PRESET_CATEGORY_PILLS[0]).toMatchObject({ key: "top", cat: null });
    const labels = PRESET_CATEGORY_PILLS.map((p) => p.label);
    expect(labels).toEqual(["Top", "News", "Business", "Sports", "Technology", "Health", "Science", "Stories", "Comedy"]);
  });
});

describe("buildTrendingUrl (pill → cat mapping, id or name)", () => {
  it("omits cat for Top / null / empty", () => {
    expect(buildTrendingUrl(null, 10)).toBe("/api/podcastindex/trending?max=10");
    expect(buildTrendingUrl("", 10)).toBe("/api/podcastindex/trending?max=10");
    expect(buildTrendingUrl(undefined, 20)).toBe("/api/podcastindex/trending?max=20");
  });

  it("passes a numeric category id through", () => {
    expect(buildTrendingUrl("55", 10)).toBe("/api/podcastindex/trending?max=10&cat=55");
  });

  it("passes a category name through (url-encoded)", () => {
    expect(buildTrendingUrl("News", 10)).toBe("/api/podcastindex/trending?max=10&cat=News");
    expect(buildTrendingUrl("Society & Culture", 15)).toBe(
      "/api/podcastindex/trending?max=15&cat=Society+%26+Culture",
    );
  });
});

describe("buildSearchUrl", () => {
  it("encodes the query and carries max", () => {
    expect(buildSearchUrl("bitcoin", 20)).toBe("/api/podcastindex/search?q=bitcoin&max=20");
    expect(buildSearchUrl("  the daily  ", 40)).toBe("/api/podcastindex/search?q=the+daily&max=40");
  });
});

describe("mergeDedupeById (Load-more dedupe)", () => {
  it("appends new feeds and drops ids already present", () => {
    const page1 = [feed(1), feed(2), feed(3)];
    const page2 = [feed(3), feed(4), feed(2), feed(5)];
    const merged = mergeDedupeById(page1, page2);
    expect(merged.map((f) => f.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("preserves existing order and returns a new array", () => {
    const page1 = [feed(10), feed(20)];
    const merged = mergeDedupeById(page1, []);
    expect(merged.map((f) => f.id)).toEqual([10, 20]);
    expect(merged).not.toBe(page1);
  });

  it("dedupes within the incoming batch too", () => {
    const merged = mergeDedupeById([], [feed(7), feed(7), feed(8)]);
    expect(merged.map((f) => f.id)).toEqual([7, 8]);
  });
});

describe("feedCategoryNames", () => {
  it("reads an id→name map (numeric keys iterate in ascending id order)", () => {
    expect(feedCategoryNames({ categories: { "55": "News", "9": "Business" } })).toEqual(["Business", "News"]);
  });
  it("reads a legacy flat array", () => {
    expect(feedCategoryNames({ categories: ["Tech", "Science"] })).toEqual(["Tech", "Science"]);
  });
  it("handles missing categories", () => {
    expect(feedCategoryNames({ categories: undefined })).toEqual([]);
    expect(feedCategoryNames({ categories: {} })).toEqual([]);
  });
});

describe("feedSupportsValue (⚡ badge gate)", () => {
  it("is true only for a real value block with destinations", () => {
    expect(feedSupportsValue({ value: { destinations: [{ name: "host", split: 100 }] } })).toBe(true);
  });
  it("is false for null / empty / malformed value blocks", () => {
    expect(feedSupportsValue({ value: null })).toBe(false);
    expect(feedSupportsValue({ value: undefined })).toBe(false);
    expect(feedSupportsValue({ value: {} })).toBe(false);
    expect(feedSupportsValue({ value: { destinations: [] } })).toBe(false);
  });
});

describe("clampMax", () => {
  it("defaults and clamps within bounds", () => {
    expect(clampMax(undefined, 10, 50)).toBe(10);
    expect(clampMax(NaN, 10, 50)).toBe(10);
    expect(clampMax(999, 10, 50)).toBe(50);
    expect(clampMax(0, 10, 50)).toBe(1);
    expect(clampMax(25, 10, 50)).toBe(25);
    expect(clampMax(25.7, 10, 50)).toBe(25);
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes common entities", () => {
    expect(stripHtml("<p>Hello &amp; <b>world</b></p>")).toBe("Hello & world");
    expect(stripHtml("A &lt;tag&gt; &quot;quote&quot;&#39;s&nbsp;end")).toBe('A <tag> "quote"\'s end');
  });
  it("handles empty input", () => {
    expect(stripHtml("")).toBe("");
  });
});

describe("normalizeShowTitle", () => {
  it("is case- and punctuation-insensitive", () => {
    expect(normalizeShowTitle("The Jordan B. Peterson Podcast")).toBe("jordan b peterson podcast");
    expect(normalizeShowTitle("2 Bears, 1 Cave")).toBe("2 bears 1 cave");
    expect(normalizeShowTitle("Your Mom's House")).toBe("your moms house");
  });
  it("strips parenthetical host suffixes", () => {
    expect(normalizeShowTitle("The Drive (Peter Attia)")).toBe("drive");
    expect(normalizeShowTitle("Heavyweight (Gimlet)")).toBe("heavyweight");
  });
  it("strips a leading article and reads & as and", () => {
    expect(normalizeShowTitle("The Tim Ferriss Show")).toBe("tim ferriss show");
    expect(normalizeShowTitle("Smartless & Friends")).toBe("smartless and friends");
  });
  it("folds diacritics and collapses whitespace", () => {
    expect(normalizeShowTitle("  Café   Chats ")).toBe("cafe chats");
    expect(normalizeShowTitle("")).toBe("");
  });
});

describe("showTitleTokenKey", () => {
  it("is order-insensitive and keeps parenthetical hosts", () => {
    expect(showTitleTokenKey("The Drive (Peter Attia)")).toBe(showTitleTokenKey("The Peter Attia Drive"));
  });
  it("drops connective stop-words", () => {
    expect(showTitleTokenKey("WTF with Marc Maron")).toBe(showTitleTokenKey("WTF Marc Maron"));
  });
});

describe("matchPresetShow", () => {
  const named = (id: number, title: string): PodcastFeed => feed(id, { title });

  it("matches exact titles case/punctuation-insensitively, honoring result order", () => {
    const results = [
      named(1, "Joe Rogan Experience Review"),
      named(2, "The Joe Rogan Experience"),
      named(3, "JRE Clips"),
    ];
    expect(matchPresetShow({ title: "The Joe Rogan Experience" }, results)?.id).toBe(2);
  });

  it("prefers an exact match over an earlier host-suffix match", () => {
    const results = [
      named(1, "Armchair Expert with Dax Shepard"),
      named(2, "Armchair Expert"),
    ];
    expect(matchPresetShow({ title: "Armchair Expert" }, results)?.id).toBe(2);
  });

  it("tolerates ' with …' / ' featuring …' host suffixes", () => {
    expect(
      matchPresetShow({ title: "Armchair Expert" }, [named(1, "Armchair Expert with Dax Shepard")])?.id,
    ).toBe(1);
    expect(
      matchPresetShow({ title: "Diary of a CEO" }, [named(2, "The Diary Of A CEO with Steven Bartlett")])?.id,
    ).toBe(2);
    expect(
      matchPresetShow({ title: "The Mina Kimes Show" }, [named(3, "The Mina Kimes Show featuring Lenny")])?.id,
    ).toBe(3);
    expect(
      matchPresetShow({ title: "New Heights" }, [named(4, "New Heights with Jason & Travis Kelce")])?.id,
    ).toBe(4);
  });

  it("matches reordered titles via parenthetical-aware token sets", () => {
    expect(
      matchPresetShow({ title: "The Drive (Peter Attia)" }, [named(1, "The Peter Attia Drive")])?.id,
    ).toBe(1);
  });

  it("uses aliases when the index's canonical title differs entirely", () => {
    const results = [named(1, "All-In with Chamath, Jason, Sacks & Friedberg")];
    expect(matchPresetShow({ title: "The All-In Podcast" }, results)).toBeNull();
    expect(
      matchPresetShow(
        { title: "The All-In Podcast", aliases: ["All-In with Chamath, Jason, Sacks & Friedberg"] },
        results,
      )?.id,
    ).toBe(1);
  });

  it("returns null (never a wrong card) when nothing truly matches", () => {
    const results = [
      named(1, "Joe Rogan Experience Review"),
      named(2, "The Tim Ferriss Show Fan Recap"),
      named(3, "Huberman Lab Unofficial"),
    ];
    expect(matchPresetShow({ title: "Huberman Lab" }, results)).toBeNull();
    expect(matchPresetShow({ title: "The Tim Ferriss Show" }, results)).toBeNull();
    expect(matchPresetShow({ title: "Anything" }, [])).toBeNull();
  });
});

describe("PRESET_SHOWS structure", () => {
  it("keys every list to a real preset pill (and leaves Top dynamic)", () => {
    const pillKeys = new Set(PRESET_CATEGORY_PILLS.map((p) => p.key));
    for (const key of Object.keys(PRESET_SHOWS)) {
      expect(pillKeys.has(key)).toBe(true);
    }
    expect(PRESET_SHOWS.top).toBeUndefined();
  });
  it("every entry carries a non-empty title and searchTerm", () => {
    for (const shows of Object.values(PRESET_SHOWS)) {
      expect(shows.length).toBeGreaterThan(0);
      for (const s of shows) {
        expect(s.title.trim().length).toBeGreaterThan(0);
        expect(s.searchTerm.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildResolveUrl / buildTrendSuggestionsUrl", () => {
  it("builds the resolve URL with an encoded term", () => {
    expect(buildResolveUrl(" My First Million ")).toBe("/api/podcastindex/resolve?q=My+First+Million");
  });
  it("builds trend-suggestion URLs with and without a category", () => {
    expect(buildTrendSuggestionsUrl("86", 5)).toBe("/api/podcastindex/trend-suggestions?limit=5&category=86");
    expect(buildTrendSuggestionsUrl(null, 5)).toBe("/api/podcastindex/trend-suggestions?limit=5");
    expect(buildTrendSuggestionsUrl("", 3)).toBe("/api/podcastindex/trend-suggestions?limit=3");
  });
});
