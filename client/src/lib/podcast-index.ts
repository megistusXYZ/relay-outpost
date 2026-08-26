// Podcast Index shared types + pure helpers for the in-app "Add RSS feed"
// discovery experience. Everything here is framework-free (no React) so it can
// be unit-tested in the node vitest env and reused by hooks + components.
//
// Directory rule: this surface is fully in-app — no external links/redirects.
// These helpers only shape data returned by the server-side Podcast Index proxy
// (`/api/podcastindex/*`) and the generic feed proxy (`/api/rss`).

// ── Types ───────────────────────────────────────────────────────────────────

/** A single recipient inside a feed's Lightning (value-for-value) block. */
export interface PodcastValueRecipient {
  name?: string;
  type?: string;
  address?: string;
  split?: number;
  fee?: boolean;
  [k: string]: unknown;
}

/** Podcast Index `value` block — present only when a feed supports V4V/Lightning. */
export interface PodcastValue {
  model?: {
    type?: string;
    method?: string;
    suggested?: string;
    [k: string]: unknown;
  };
  destinations?: PodcastValueRecipient[];
  [k: string]: unknown;
}

/** A podcast feed as mapped by the server proxy (search + trending). */
export interface PodcastFeed {
  id: number;
  title: string;
  author: string;
  description: string;
  /** Artwork URL (already resolved from `artwork` || `image` server-side). */
  image: string;
  url: string;
  episodeCount: number;
  language: string;
  /**
   * Category id→name map (preserved from upstream). Older responses may still
   * send a flat name array — use {@link feedCategoryNames} to read either shape.
   */
  categories?: Record<string, string> | string[];
  /** Present when the feed carries a real Lightning value block. */
  value?: PodcastValue | null;
  /** Unix seconds — feed freshness (when the feed itself last changed). */
  lastUpdateTime?: number;
  /** Unix seconds — publish time of the newest item. */
  newestItemPubdate?: number;
  /** Trending-only relevance score. */
  trendScore?: number;
}

/** A playable episode extracted from the generic `/api/rss` proxy. */
export interface PodcastEpisode {
  id: string;
  title: string;
  audioUrl?: string;
  pubDate?: string;
  /** Duration in seconds (as the RSS proxy reports it). */
  duration?: number;
  description?: string;
  thumbnail?: string;
  link?: string;
  /** Podcasting 2.0 `podcast:transcript` URL, when the feed provides one. */
  transcriptUrl?: string;
  transcriptType?: string;
  /** Podcasting 2.0 `podcast:chapters` JSON URL, when the feed provides one. */
  chaptersUrl?: string;
}

/** Podcast Index category (id + display name). */
export interface PodcastCategory {
  id: number;
  name: string;
}

/** A zero-state category pill. `cat === null` means "Top" (no category filter). */
export interface PresetCategoryPill {
  key: string;
  label: string;
  /** Trending `cat` param — a Podcast Index category id, or null for Top. */
  cat: string | null;
}

// ── Static category catalog (Podcast Index `/categories/list`, 112 entries) ──
// Mirrors github.com/Podcastindex-org/podcast-namespace/categories.json so pills
// render instantly without a round-trip; the /categories route refreshes it.
export const PODCAST_CATEGORIES: PodcastCategory[] = [
  { id: 1, name: "Arts" },
  { id: 2, name: "Books" },
  { id: 3, name: "Design" },
  { id: 4, name: "Fashion" },
  { id: 5, name: "Beauty" },
  { id: 6, name: "Food" },
  { id: 7, name: "Performing" },
  { id: 8, name: "Visual" },
  { id: 9, name: "Business" },
  { id: 10, name: "Careers" },
  { id: 11, name: "Entrepreneurship" },
  { id: 12, name: "Investing" },
  { id: 13, name: "Management" },
  { id: 14, name: "Marketing" },
  { id: 15, name: "Non-Profit" },
  { id: 16, name: "Comedy" },
  { id: 17, name: "Interviews" },
  { id: 18, name: "Improv" },
  { id: 19, name: "Stand-Up" },
  { id: 20, name: "Education" },
  { id: 21, name: "Courses" },
  { id: 22, name: "How-To" },
  { id: 23, name: "Language" },
  { id: 24, name: "Learning" },
  { id: 25, name: "Self-Improvement" },
  { id: 26, name: "Fiction" },
  { id: 27, name: "Drama" },
  { id: 28, name: "History" },
  { id: 29, name: "Health" },
  { id: 30, name: "Fitness" },
  { id: 31, name: "Alternative" },
  { id: 32, name: "Medicine" },
  { id: 33, name: "Mental" },
  { id: 34, name: "Nutrition" },
  { id: 35, name: "Sexuality" },
  { id: 36, name: "Kids" },
  { id: 37, name: "Family" },
  { id: 38, name: "Parenting" },
  { id: 39, name: "Pets" },
  { id: 40, name: "Animals" },
  { id: 41, name: "Stories" },
  { id: 42, name: "Leisure" },
  { id: 43, name: "Animation" },
  { id: 44, name: "Manga" },
  { id: 45, name: "Automotive" },
  { id: 46, name: "Aviation" },
  { id: 47, name: "Crafts" },
  { id: 48, name: "Games" },
  { id: 49, name: "Hobbies" },
  { id: 50, name: "Home" },
  { id: 51, name: "Garden" },
  { id: 52, name: "Video-Games" },
  { id: 53, name: "Music" },
  { id: 54, name: "Commentary" },
  { id: 55, name: "News" },
  { id: 56, name: "Daily" },
  { id: 57, name: "Entertainment" },
  { id: 58, name: "Government" },
  { id: 59, name: "Politics" },
  { id: 60, name: "Buddhism" },
  { id: 61, name: "Christianity" },
  { id: 62, name: "Hinduism" },
  { id: 63, name: "Islam" },
  { id: 64, name: "Judaism" },
  { id: 65, name: "Religion" },
  { id: 66, name: "Spirituality" },
  { id: 67, name: "Science" },
  { id: 68, name: "Astronomy" },
  { id: 69, name: "Chemistry" },
  { id: 70, name: "Earth" },
  { id: 71, name: "Life" },
  { id: 72, name: "Mathematics" },
  { id: 73, name: "Natural" },
  { id: 74, name: "Nature" },
  { id: 75, name: "Physics" },
  { id: 76, name: "Social" },
  { id: 77, name: "Society" },
  { id: 78, name: "Culture" },
  { id: 79, name: "Documentary" },
  { id: 80, name: "Personal" },
  { id: 81, name: "Journals" },
  { id: 82, name: "Philosophy" },
  { id: 83, name: "Places" },
  { id: 84, name: "Travel" },
  { id: 85, name: "Relationships" },
  { id: 86, name: "Sports" },
  { id: 87, name: "Baseball" },
  { id: 88, name: "Basketball" },
  { id: 89, name: "Cricket" },
  { id: 90, name: "Fantasy" },
  { id: 91, name: "Football" },
  { id: 92, name: "Golf" },
  { id: 93, name: "Hockey" },
  { id: 94, name: "Rugby" },
  { id: 95, name: "Running" },
  { id: 96, name: "Soccer" },
  { id: 97, name: "Swimming" },
  { id: 98, name: "Tennis" },
  { id: 99, name: "Volleyball" },
  { id: 100, name: "Wilderness" },
  { id: 101, name: "Wrestling" },
  { id: 102, name: "Technology" },
  { id: 103, name: "True Crime" },
  { id: 104, name: "TV" },
  { id: 105, name: "Film" },
  { id: 106, name: "After-Shows" },
  { id: 107, name: "Reviews" },
  { id: 108, name: "Climate" },
  { id: 109, name: "Weather" },
  { id: 110, name: "Tabletop" },
  { id: 111, name: "Role-Playing" },
  { id: 112, name: "Cryptocurrency" },
];

/**
 * The zero-state pills. "Top" (no cat) leads, then a broad, mainstream spread
 * that maps to real Podcast Index category ids so trending filters correctly.
 */
export const PRESET_CATEGORY_PILLS: PresetCategoryPill[] = [
  { key: "top", label: "Top", cat: null },
  { key: "news", label: "News", cat: "55" },
  { key: "business", label: "Business", cat: "9" },
  { key: "sports", label: "Sports", cat: "86" },
  { key: "technology", label: "Technology", cat: "102" },
  { key: "health", label: "Health", cat: "29" },
  { key: "science", label: "Science", cat: "67" },
  { key: "stories", label: "Stories", cat: "41" },
  { key: "comedy", label: "Comedy", cat: "16" },
];

// ── Creator-led preset lists ─────────────────────────────────────────────────

/**
 * One curated show inside a preset pill's list. NEVER blind-hardcoded feed
 * data: `searchTerm` goes through the server's Podcast Index search proxy at
 * runtime and {@link matchPresetShow} picks the live feed (ids/artwork/URLs
 * drift upstream). A show the index doesn't return simply isn't rendered.
 */
export interface PresetShow {
  /** Display/spec title as curated (used for matching). */
  title: string;
  /** Term sent to the search proxy to find the live feed. */
  searchTerm: string;
  /**
   * Alternate canonical titles the index is known to use (e.g. host-name
   * variants that plain normalization can't bridge). Matching still happens
   * against LIVE search results — aliases only widen what counts as "same show".
   */
  aliases?: string[];
}

/**
 * Curated flagship shows per preset pill (keys match {@link PRESET_CATEGORY_PILLS}).
 * "top" is intentionally absent — Top stays fully dynamic via trending.
 */
export const PRESET_SHOWS: Record<string, PresetShow[]> = {
  news: [
    { title: "The Joe Rogan Experience", searchTerm: "The Joe Rogan Experience" },
    { title: "Diary of a CEO", searchTerm: "Diary of a CEO" },
    { title: "The Tim Ferriss Show", searchTerm: "The Tim Ferriss Show" },
    { title: "Armchair Expert", searchTerm: "Armchair Expert Dax Shepard" },
    { title: "WTF with Marc Maron", searchTerm: "WTF with Marc Maron" },
    { title: "Tucker Carlson Show", searchTerm: "The Tucker Carlson Show" },
  ],
  business: [
    { title: "My First Million", searchTerm: "My First Million" },
    { title: "Acquired", searchTerm: "Acquired podcast" },
    {
      title: "The All-In Podcast",
      searchTerm: "All-In Podcast",
      aliases: ["All-In with Chamath, Jason, Sacks & Friedberg"],
    },
    { title: "The Knowledge Project", searchTerm: "The Knowledge Project" },
    { title: "Impact Theory", searchTerm: "Impact Theory Tom Bilyeu" },
  ],
  sports: [
    { title: "Pat McAfee Show", searchTerm: "The Pat McAfee Show" },
    { title: "New Heights", searchTerm: "New Heights Jason Travis Kelce" },
    { title: "The Dan Le Batard Show with Stugotz", searchTerm: "Dan Le Batard Show Stugotz" },
    { title: "Pardon My Take", searchTerm: "Pardon My Take" },
    { title: "The Mina Kimes Show", searchTerm: "The Mina Kimes Show" },
  ],
  technology: [
    { title: "Lex Fridman Podcast", searchTerm: "Lex Fridman Podcast" },
    { title: "Acquired", searchTerm: "Acquired podcast" },
    {
      title: "The All-In Podcast",
      searchTerm: "All-In Podcast",
      aliases: ["All-In with Chamath, Jason, Sacks & Friedberg"],
    },
    { title: "The Knowledge Project", searchTerm: "The Knowledge Project" },
  ],
  health: [
    { title: "Huberman Lab", searchTerm: "Huberman Lab" },
    {
      title: "The Drive (Peter Attia)",
      searchTerm: "Peter Attia Drive",
      aliases: ["The Peter Attia Drive"],
    },
    { title: "FoundMyFitness", searchTerm: "FoundMyFitness" },
    { title: "The Model Health Show", searchTerm: "The Model Health Show" },
  ],
  science: [
    { title: "Huberman Lab", searchTerm: "Huberman Lab" },
    { title: "Lex Fridman Podcast", searchTerm: "Lex Fridman Podcast" },
    { title: "The Jordan B. Peterson Podcast", searchTerm: "Jordan B Peterson Podcast" },
    { title: "FoundMyFitness", searchTerm: "FoundMyFitness" },
  ],
  stories: [
    { title: "Duncan Trussell Family Hour", searchTerm: "Duncan Trussell Family Hour" },
    { title: "The Tim Ferriss Show", searchTerm: "The Tim Ferriss Show" },
    { title: "Diary of a CEO", searchTerm: "Diary of a CEO" },
    { title: "Heavyweight", searchTerm: "Heavyweight podcast" },
    { title: "Armchair Expert", searchTerm: "Armchair Expert Dax Shepard" },
    { title: "WTF with Marc Maron", searchTerm: "WTF with Marc Maron" },
    { title: "This is Actually Happening", searchTerm: "This is Actually Happening" },
  ],
  comedy: [
    { title: "Your Mom's House", searchTerm: "Your Mom's House" },
    { title: "Bad Friends", searchTerm: "Bad Friends podcast" },
    { title: "The Joe Rogan Experience", searchTerm: "The Joe Rogan Experience" },
    { title: "Kill Tony", searchTerm: "Kill Tony" },
    { title: "2 Bears 1 Cave", searchTerm: "2 Bears 1 Cave" },
    { title: "The Bertcast", searchTerm: "Bertcast Bert Kreischer" },
  ],
};

// ── Trend suggestions ("Rising now") ─────────────────────────────────────────

export type TrendMomentum = "new" | "rising" | "surging";

/** One rising-show suggestion from `/api/podcastindex/trend-suggestions`. */
export interface TrendSuggestionItem {
  feedId: number;
  title: string;
  category: string;
  momentum: TrendMomentum;
  /** Human sentence explaining the momentum. */
  reason: string;
  /** Consistent high performer (top 15 on 3+ distinct days) — "Consistently strong". */
  consistent?: boolean;
  /** 0–100 numeric momentum strength (see server/podcast-trends.ts). */
  momentumScore?: number;
  /** Full feed card metadata (hydrated server-side; null when unavailable). */
  feed: PodcastFeed | null;
}

/** Short chip label per momentum tier. */
export const MOMENTUM_LABELS: Record<TrendMomentum, string> = {
  new: "New",
  rising: "Rising",
  surging: "Surging",
};

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Format an episode length as a friendly label: "42 min" / "1h 15m".
 *
 * Contract:
 *  - Non-finite, undefined, zero, or negative → "" (nothing to show).
 *  - Sub-minute lengths round up to "1 min" (never "0 min").
 *  - < 1 hour → "N min"; ≥ 1 hour → "Hh Mm" (drops the minutes when exactly 0).
 *  - Defensive ms-vs-seconds: values ≥ 24h are treated as milliseconds (a common
 *    feed bug) and divided by 1000. Real podcast episodes never exceed a day, so
 *    this only rescues mis-encoded values.
 */
export function formatDuration(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "";
  let n = Math.round(sec);
  // Millisecond guard: nothing legitimate runs a full day, so a value that large
  // was almost certainly reported in ms.
  if (n >= 86400) n = Math.round(n / 1000);
  if (n < 60) return "1 min";
  const hours = Math.floor(n / 3600);
  const minutes = Math.round((n % 3600) / 60);
  if (hours > 0) {
    // Rounding can push minutes to 60 — roll it into the hour.
    if (minutes >= 60) return `${hours + 1}h`;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  return `${minutes} min`;
}

/** Read a feed's category names whether the proxy sent an id→name map or a flat array. */
export function feedCategoryNames(feed: Pick<PodcastFeed, "categories">): string[] {
  const cats = feed.categories;
  if (!cats) return [];
  if (Array.isArray(cats)) return cats.filter((c): c is string => typeof c === "string" && !!c);
  return Object.values(cats).filter((c): c is string => typeof c === "string" && !!c);
}

/** True when a feed carries a real Lightning value block (≥1 destination). */
export function feedSupportsValue(feed: Pick<PodcastFeed, "value">): boolean {
  const v = feed.value;
  if (!v || typeof v !== "object") return false;
  const dests = (v as PodcastValue).destinations;
  return Array.isArray(dests) && dests.length > 0;
}

/**
 * Merge two batches of feeds, de-duplicating by feed id and preserving order
 * (existing first, then new arrivals). Powers in-dialog "Load more".
 */
export function mergeDedupeById(existing: PodcastFeed[], incoming: PodcastFeed[]): PodcastFeed[] {
  const seen = new Set<number>(existing.map((f) => f.id));
  const out = existing.slice();
  for (const f of incoming) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

/** Clamp + default a `max` request count to a safe range. */
export function clampMax(max: number | undefined, fallback: number, cap: number): number {
  if (max == null || !Number.isFinite(max)) return fallback;
  return Math.min(cap, Math.max(1, Math.floor(max)));
}

/**
 * Build the trending request URL. `cat` may be a Podcast Index id ("55"),
 * a name ("News"), or null/"" for Top (no filter).
 */
export function buildTrendingUrl(cat: string | null | undefined, max: number): string {
  const params = new URLSearchParams();
  params.set("max", String(max));
  if (cat != null && String(cat).trim() !== "") params.set("cat", String(cat).trim());
  return `/api/podcastindex/trending?${params.toString()}`;
}

/** Build the search request URL. */
export function buildSearchUrl(q: string, max: number): string {
  const params = new URLSearchParams();
  params.set("q", q.trim());
  params.set("max", String(max));
  return `/api/podcastindex/search?${params.toString()}`;
}

/** Build the preset-resolution URL (long-TTL server-cached search). */
export function buildResolveUrl(term: string): string {
  const params = new URLSearchParams();
  params.set("q", term.trim());
  return `/api/podcastindex/resolve?${params.toString()}`;
}

/** Build the trend-suggestions ("Rising now") URL. `cat` null/"" = global. */
export function buildTrendSuggestionsUrl(cat: string | null | undefined, limit: number): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (cat != null && String(cat).trim() !== "") params.set("category", String(cat).trim());
  return `/api/podcastindex/trend-suggestions?${params.toString()}`;
}

// ── Preset-show title matching (pure, unit-tested) ───────────────────────────

/**
 * Canonical form of a show title for exact matching: lowercase, diacritics
 * folded, parentheticals removed ("The Drive (Peter Attia)" → "the drive"),
 * "&" read as "and", all other punctuation dropped, whitespace collapsed, and
 * a leading "the " stripped.
 */
export function normalizeShowTitle(raw: string): string {
  const s = (raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.startsWith("the ") ? s.slice(4) : s;
}

/**
 * Order-insensitive token key with parenthetical content KEPT (so
 * "The Drive (Peter Attia)" and "The Peter Attia Drive" collide). Articles/
 * connectives that vary between listings are dropped.
 */
export function showTitleTokenKey(raw: string): string {
  const stop = new Set(["the", "a", "an", "with", "and", "of"]);
  return (raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((t) => t && !stop.has(t))
    .sort()
    .join(" ");
}

/**
 * Pick the live search result that IS the curated show, or null (⇒ the preset
 * card simply isn't rendered — never a dead card). Results are checked in the
 * index's relevance order, with three passes of decreasing strictness:
 *  1. exact normalized-title equality against the curated title or an alias;
 *  2. host-suffix tolerance — the result title only appends " with …" /
 *     " featuring …" to the curated title ("Armchair Expert with Dax Shepard");
 *  3. order-insensitive token equality with parenthetical hosts folded in
 *     ("The Drive (Peter Attia)" ↔ "The Peter Attia Drive").
 */
export function matchPresetShow(
  show: Pick<PresetShow, "title" | "aliases">,
  results: PodcastFeed[],
): PodcastFeed | null {
  const targets = [show.title, ...(show.aliases ?? [])].map(normalizeShowTitle).filter(Boolean);
  if (targets.length === 0 || results.length === 0) return null;

  // Pass 1: exact normalized equality.
  for (const f of results) {
    const n = normalizeShowTitle(f.title);
    if (targets.includes(n)) return f;
  }
  // Pass 2: curated title + a host suffix.
  for (const f of results) {
    const n = normalizeShowTitle(f.title);
    if (targets.some((t) => n.startsWith(`${t} with `) || n.startsWith(`${t} featuring `))) return f;
  }
  // Pass 3: token-set equality (parentheticals folded in).
  const targetKeys = [show.title, ...(show.aliases ?? [])].map(showTitleTokenKey).filter(Boolean);
  for (const f of results) {
    const k = showTitleTokenKey(f.title);
    if (k && targetKeys.includes(k)) return f;
  }
  return null;
}

/**
 * Strip HTML tags + decode the common named entities from a description string.
 * Lifted from RSSFeed so the discovery module owns its own text cleaning.
 */
export function stripHtml(html: string): string {
  return (html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
