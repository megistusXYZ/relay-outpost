/**
 * Pure helpers for the Orbit menu's "Stories" layer — unread rings and the
 * press-and-hold preview card. Everything here works over data that is ALREADY
 * on the device (react-query cache snapshots, localStorage ledgers); nothing
 * fetches, subscribes, or decrypts. Kept DOM/React-free for unit testing
 * (see orbit-stories.test.ts).
 */

import { scoreNewsItems, presetShowTitleKeys, type ScorableNewsItem } from "@/lib/news-scoring";
import { normalizeShowTitle } from "@/lib/podcast-index";
import {
  countPriorityUnread,
  type PriorityCountable,
  type PriorityUnreadSummary,
} from "@/lib/news-unread";

// ---- News (RSS) unread from cached feed data --------------------------------

/** The slice of an RSS item the unread computation needs. */
export interface RssCachedItemLite {
  title?: string;
  guid?: string;
  id?: string;
  link?: string;
  pubDate?: string;
  /** Present on real cached payloads; feeds the scoring signals. */
  description?: string;
  author?: string;
}

/**
 * Stable per-article id — MUST mirror `rssItemId` in pages/RSSFeed.tsx
 * (guid → id → link) so the read-ledger written by the News page is
 * interpreted identically here.
 */
export function rssItemKey(item: RssCachedItemLite): string {
  return (item.guid || item.id || item.link || "").trim();
}

export interface RssUnreadSummary {
  count: number;
  /** Newest unread headline (by pubDate when parseable), or null. */
  topTitle: string | null;
}

/**
 * The News page's read-ledger (see RSS_READ_KEY in pages/RSSFeed.tsx — same
 * string, read-only here). Guarded so it is safe in tests / SSR.
 */
export const RSS_READ_LEDGER_KEY = "ro_rss_read_v1";

export function loadRssReadLedger(): Set<string> {
  try {
    if (typeof localStorage === "undefined") return new Set();
    const raw = localStorage.getItem(RSS_READ_LEDGER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is string => typeof x === "string"));
    }
  } catch {}
  return new Set();
}

/**
 * Count unread items across already-cached feed payloads. `feeds` is whatever
 * react-query has in memory for ["/api/rss", url] queries — if the user hasn't
 * opened News this session the list is empty and the summary is quiet (that is
 * the contract: no fetches just to light a ring).
 */
export function computeRssUnread(
  feeds: Array<{ items?: RssCachedItemLite[] } | undefined>,
  readIds: Set<string>,
): RssUnreadSummary {
  const seen = new Set<string>();
  let count = 0;
  let top: RssCachedItemLite | null = null;
  let topTime = -Infinity;
  for (const feed of feeds) {
    for (const item of feed?.items ?? []) {
      const key = rssItemKey(item);
      // Unkeyed items can never be marked read — skip them so the ring can't
      // get stuck permanently "new".
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (readIds.has(key)) continue;
      count++;
      const t = item.pubDate ? Date.parse(item.pubDate) : NaN;
      const time = Number.isNaN(t) ? 0 : t;
      if (time > topTime || top === null) {
        top = item;
        topTime = time;
      }
    }
  }
  return { count, topTitle: top?.title?.trim() || null };
}

// ---- Priority unread (the menu's News numbers) ------------------------------

/** One cached react-query payload plus the feed URL from its query key. */
export interface CachedFeedPayloadLite {
  url?: string;
  items?: RssCachedItemLite[];
}

/** The saved-feed slice the menu-side scoring context needs (SavedFeed fits). */
export interface OrbitSavedFeedLite {
  url: string;
  name: string;
  category: string;
}

/** The alert-prefs slice the menu-side scoring context needs. */
export interface OrbitNewsPrefsLite {
  mutedSources?: string[];
  mutedKeywords?: string[];
  onlyPresets?: boolean;
  onlyCreators?: boolean;
}

/**
 * The menu's News numbers, on the same policy as the News page: score every
 * cached article with news-scoring (saved-feed categories, followed creators,
 * engagement from the read ledger, the user's mutes — no trending/clustering,
 * which need page-level caches), then count ONLY tier 1–2 unread within the
 * 72h freshness window (news-unread.ts). Pure: works entirely over what the
 * caller already has on-device; no fetches just to light a ring.
 */
export function computePriorityNewsUnread(
  feeds: Array<CachedFeedPayloadLite | undefined>,
  savedFeeds: OrbitSavedFeedLite[],
  readIds: Set<string>,
  now: number,
  prefs: OrbitNewsPrefsLite = {},
): PriorityUnreadSummary {
  const feedByUrl = new Map(savedFeeds.map((f) => [f.url, f]));
  const presetKeys = presetShowTitleKeys();
  // Followed individual creators — mirrors the News page's rule: user-added
  // podcasts + curated preset shows.
  const followed: string[] = [];
  for (const f of savedFeeds) {
    if (f.category === "Podcast" || presetKeys.has(normalizeShowTitle(f.name))) followed.push(f.url);
  }

  // Dedupe items across cached payloads; collect engagement (a source counts
  // as engaged when any of its cached items has been read).
  const seen = new Set<string>();
  const engaged = new Set<string>();
  type Scorable = ScorableNewsItem & { pubDate?: string };
  const scorables: Scorable[] = [];
  for (const feed of feeds) {
    const url = feed?.url;
    const saved = url ? feedByUrl.get(url) : undefined;
    for (const item of feed?.items ?? []) {
      const key = rssItemKey(item);
      if (!key) continue;
      if (readIds.has(key) && url) engaged.add(url);
      if (seen.has(key)) continue;
      seen.add(key);
      scorables.push({
        id: key,
        title: item.title,
        description: item.description,
        sourceUrl: url,
        sourceName: saved?.name,
        sourceCategory: saved?.category,
        author: item.author,
        pubDate: item.pubDate,
      });
    }
  }

  const scored = scoreNewsItems(scorables, {
    savedCategoryKeys: savedFeeds.map((f) => f.category),
    followedCreatorUrls: followed,
    engagedSourceUrls: engaged,
    mutedSourceUrls: prefs.mutedSources,
    mutedKeywords: prefs.mutedKeywords,
    onlyPresets: prefs.onlyPresets,
    onlyFollowedCreators: prefs.onlyCreators,
  });

  const countables: PriorityCountable[] = scored.map((s) => {
    const t = s.item.pubDate ? Date.parse(s.item.pubDate) : NaN;
    return { id: s.item.id, tier: s.tier, timeMs: Number.isNaN(t) ? undefined : t, title: s.item.title };
  });
  return countPriorityUnread(countables, (id) => readIds.has(id), now);
}

// ---- Preview card placement -------------------------------------------------

export interface PreviewPlacement {
  left: number;
  top: number;
  /** True when the card had to flip below the node (node too close to the top). */
  below: boolean;
}

/**
 * Place the floating preview card near a node: centered above it, clamped to
 * the horizontal margins, flipped underneath when the node sits too close to
 * the top band (search pill / safe area).
 */
export function placePreviewCard(opts: {
  nodeX: number;
  nodeY: number;
  nodeSize: number;
  cardWidth: number;
  cardHeight: number;
  viewportWidth: number;
  margin?: number;
  topBand?: number;
}): PreviewPlacement {
  const {
    nodeX,
    nodeY,
    nodeSize,
    cardWidth,
    cardHeight,
    viewportWidth,
    margin = 12,
    topBand = 76,
  } = opts;
  const left = Math.min(
    Math.max(nodeX - cardWidth / 2, margin),
    Math.max(margin, viewportWidth - margin - cardWidth),
  );
  const above = nodeY - nodeSize / 2 - 10 - cardHeight;
  if (above >= topBand) return { left, top: above, below: false };
  // Below the node: clear the circle plus its label line.
  return { left, top: nodeY + nodeSize / 2 + 26, below: true };
}
