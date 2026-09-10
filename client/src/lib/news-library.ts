/**
 * The News library: your sources, and which lane each belongs in.
 *
 * News shows your own news sources only; podcasts get their own Listen lane.
 * A category name can't decide the lane on its own ("Sports" is both a news
 * section and a podcast category), so a source is a podcast when it is one of
 * the preset shows, or when it was saved as a podcast (the add dialog files
 * Podcast Index shows under "Podcast"). See news-library.test.ts.
 */
import {
  ALL_PRESET_FEEDS,
  PODCAST_FEED_URLS,
  STARTER_URLS_V2,
  loadCustomFeeds,
  loadHiddenDefaults,
  saveCustomFeeds,
  saveHiddenDefaults,
  type SavedFeed,
} from "./rss-feeds";

export { STARTER_URLS_V2 };

export type NewsLane = "news" | "listen";

const PODCAST_CATEGORIES = new Set(["podcast", "podcasts"]);

export function laneOf(feed: SavedFeed): NewsLane {
  if (PODCAST_FEED_URLS.has(feed.url)) return "listen";
  if (PODCAST_CATEGORIES.has((feed.category || "").trim().toLowerCase())) return "listen";
  return "news";
}

/** The sources in one lane, in library order. */
export function laneFeeds(library: SavedFeed[], lane: NewsLane): SavedFeed[] {
  return library.filter((feed) => laneOf(feed) === lane);
}

/**
 * The starter every library was derived from until 2026-09: 11 news outlets
 * and 25 podcasts. Frozen verbatim so a library shaped under it can be carried
 * over exactly (migrateNewsLibrary). Never edit this list.
 */
export const LEGACY_STARTER_URLS_V1: ReadonlySet<string> = new Set<string>([
  "https://theintercept.com/feed/?rss",
  "https://www.thefp.com/feed",
  "https://feeds.propublica.org/propublica/main",
  "https://fortune.com/feed/",
  "https://feeds.feedburner.com/zerohedge/feed",
  "https://www.theverge.com/rss/index.xml",
  "https://www.404media.co/rss/",
  "https://frontofficesports.com/feed/",
  "https://www.thisiscolossal.com/feed/",
  "https://www.theatlantic.com/feed/all/",
  "https://bitcoinmagazine.com/feed",
  "https://feeds.megaphone.fm/GLT1412515089",
  "https://lexfridman.com/feed/podcast/",
  "https://feeds.simplecast.com/hNaFxXpO",
  "https://feeds.megaphone.fm/thispastweekend",
  "https://feeds.megaphone.fm/ESP7297553965",
  "https://rss.art19.com/new-heights",
  "https://anchor.fm/s/558f520/podcast/rss",
  "https://feeds.fountain.fm/UZSKQcrOnhqYS1JopxGg",
  "https://feeds.fountain.fm/xRzQd3loNa0ItnvWXcOz",
  "https://feeds.fountain.fm/0EAzqUaM4qqanDr1qNuK",
  "https://serve.podhome.fm/rss/c90e609a-df1e-596a-bd5e-57bcc8aad6cc",
  "https://feeds.megaphone.fm/HS2300184645",
  "https://rss.libsyn.com/shows/254861/destinations/1928300.xml",
  "https://podcast.darknetdiaries.com",
  "https://feeds.simplecast.com/6HKOhNgS",
  "https://feeds.megaphone.fm/hubermanlab",
  "https://rss.libsyn.com/shows/121729/destinations/713489.xml",
  "https://feeds.transistor.fm/mindfulness-meditation-podcast",
  "https://feed.podbean.com/AbrahamHicksInsight/feed.xml",
  "https://feeds.npr.org/510318/podcast.xml",
  "https://feeds.simplecast.com/54nAGcIl",
  "https://feeds.simplecast.com/qm_9xx0g",
  "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/a91018a4-ea4f-4130-bf55-ae270180c327/44710ecc-10bb-48d1-93c7-ae270180c33e/podcast.rss",
  "https://feeds.simplecast.com/BqbsxVfO",
  "http://feeds.feedburner.com/themothpodcast",
]);

/** What a device stores about its library: sources added, and starter sources removed. */
export interface StoredLibrary {
  custom: SavedFeed[];
  hidden: ReadonlySet<string>;
}

/**
 * A library as the reader sees it: the starter's presets (in catalogue order)
 * minus the hidden ones, then the added ones. The same formula the app has
 * always used, with the starter as a parameter.
 */
export function deriveLibrary(starter: ReadonlySet<string>, stored: StoredLibrary): SavedFeed[] {
  const defaults = ALL_PRESET_FEEDS.filter((feed) => starter.has(feed.url) && !stored.hidden.has(feed.url));
  return [...defaults, ...stored.custom];
}

/**
 * Carry a library from the old starter to the new one. Untouched (nothing
 * added, nothing removed): stays empty, so it derives to the new starter.
 * Shaped: the old starter's visible sources become explicit entries ahead of
 * the added ones, and the new starter's sources are hidden, so the library
 * derives to exactly what it was. See news-library.test.ts.
 */
export function migrateNewsLibrary(stored: StoredLibrary): { custom: SavedFeed[]; hidden: Set<string> } {
  if (stored.custom.length === 0 && stored.hidden.size === 0) return { custom: [], hidden: new Set() };
  // Already carried over: every new starter source is hidden. A library shaped
  // under the old starter can't look like this (BBC World, NPR News, The
  // Guardian World and NASA were never defaults, so nothing could hide them).
  if ([...STARTER_URLS_V2].every((url) => stored.hidden.has(url))) {
    return { custom: [...stored.custom], hidden: new Set(stored.hidden) };
  }
  const carried = deriveLibrary(LEGACY_STARTER_URLS_V1, { custom: [], hidden: stored.hidden });
  return {
    custom: [...carried, ...stored.custom],
    hidden: new Set([...stored.hidden, ...STARTER_URLS_V2]),
  };
}

/**
 * Remove a source for good: drop any stored copy of it (an added source, or a
 * renamed starter source) and hide the starter entry, so it can't come back.
 */
export function removeFromLibrary(stored: StoredLibrary, url: string): { custom: SavedFeed[]; hidden: Set<string> } {
  return {
    custom: stored.custom.filter((feed) => feed.url !== url),
    hidden: new Set([...stored.hidden, url]),
  };
}

/**
 * Whether the starter is still a suggestion ("suggested": News shows one
 * quiet line with Keep and Edit) or your own library ("settled").
 *
 * Settled once you tap Keep, once anything is stored as your own (a source you
 * added, a starter source you renamed, or a library carried over from the old
 * starter, which is always stored as explicit entries), or once no suggestion
 * is left. Removing a suggestion alone doesn't settle it: that's still
 * editing the suggestions. See news-library.test.ts.
 */
export type StarterStatus = "suggested" | "settled";

export function starterStatus(stored: StoredLibrary, prefs: { kept: boolean }): StarterStatus {
  if (prefs.kept || stored.custom.length > 0) return "settled";
  return [...STARTER_URLS_V2].some((url) => !stored.hidden.has(url)) ? "suggested" : "settled";
}

/** Set when you tap Keep on the suggested sources. */
export const NEWS_STARTER_KEPT_KEY = "ro_news_starter_kept";

export interface SourceSections {
  suggested: SavedFeed[];
  news: SavedFeed[];
  shows: SavedFeed[];
}

/**
 * The Sources drawer's sections. While the starter is a suggestion its
 * sources are listed as Suggested; once settled they are simply your news
 * sources, ahead of the ones you added (the library's own order).
 */
export function sourceSections(stored: StoredLibrary, status: StarterStatus): SourceSections {
  const starter = deriveLibrary(STARTER_URLS_V2, { custom: [], hidden: stored.hidden });
  const yours = status === "suggested" ? stored.custom : [...starter, ...stored.custom];
  return {
    suggested: status === "suggested" ? starter : [],
    news: laneFeeds(yours, "news"),
    shows: laneFeeds(yours, "listen"),
  };
}

/**
 * Undo for removeFromLibrary: bring back one source as it was before it was
 * removed (its stored copy, if it had one, and whether it was hidden), and
 * leave every other change since then alone.
 */
export function restoreSource(now: StoredLibrary, before: StoredLibrary, url: string): { custom: SavedFeed[]; hidden: Set<string> } {
  const copy = before.custom.find((feed) => feed.url === url);
  const custom = copy && !now.custom.some((feed) => feed.url === url) ? [...now.custom, copy] : [...now.custom];
  const hidden = new Set(now.hidden);
  if (!before.hidden.has(url)) hidden.delete(url);
  return { custom, hidden };
}

/** Set once this device's library has been carried over to the new starter. */
export const NEWS_LIBRARY_VERSION_KEY = "ro_news_library_version";
/** The oldest saved-feeds key: it held the whole list, defaults included. */
const LEGACY_FEEDS_KEY = "relay-outpost-rss-feeds";
/** Stored News settings with no control left to change them (or superseded). */
const RETIRED_KEYS = ["ro_news_edition_v1", "ro_news_topic_v1", "ro_rss_density", "ro_rss_sort"];

/** Your library as every reader sees it (after the start-up migration). */
export function loadLibraryFeeds(): SavedFeed[] {
  return deriveLibrary(STARTER_URLS_V2, { custom: loadCustomFeeds(), hidden: loadHiddenDefaults() });
}

/** The oldest key's non-default entries become added sources, judged against the starter of its day. */
function foldLegacyFeedsKey(storage: Storage): void {
  const raw = storage.getItem(LEGACY_FEEDS_KEY);
  if (raw === null) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const oldDefaults = new Set(deriveLibrary(LEGACY_STARTER_URLS_V1, { custom: [], hidden: new Set() }).map((f) => f.url));
      const added = parsed.filter((f): f is SavedFeed => !!f && typeof f.url === "string" && !oldDefaults.has(f.url));
      if (added.length > 0) {
        const existing = loadCustomFeeds();
        const known = new Set(existing.map((f) => f.url));
        saveCustomFeeds([...existing, ...added.filter((f) => !known.has(f.url))]);
      }
    }
  } catch {}
  storage.removeItem(LEGACY_FEEDS_KEY);
}

/**
 * Carry this device's library over to the new starter, once. Call at start-up
 * (main.tsx), before anything reads or writes the library: an add or remove
 * landing first would make an untouched device look customised. Never throws,
 * and does nothing where storage is missing or blocked.
 */
export function ensureNewsLibraryMigrated(): void {
  let storage: Storage | undefined;
  try {
    storage = globalThis.localStorage;
  } catch {
    return;
  }
  if (!storage) return;
  try {
    if (storage.getItem(NEWS_LIBRARY_VERSION_KEY) === "2") return;
    foldLegacyFeedsKey(storage);
    const migrated = migrateNewsLibrary({ custom: loadCustomFeeds(), hidden: loadHiddenDefaults() });
    saveCustomFeeds(migrated.custom);
    saveHiddenDefaults(migrated.hidden);
    for (const key of RETIRED_KEYS) storage.removeItem(key);
    storage.setItem(NEWS_LIBRARY_VERSION_KEY, "2");
  } catch {}
}
