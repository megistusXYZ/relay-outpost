// The canonical news source pool for the trending front page
// (NEWS_TRENDING_PLAN.md). This is the SUBSTRATE of the corroboration signal —
// the invisible ingredients, never shown to a user as "your subscriptions."
// The server aggregation job fans this out, clusters near-duplicate coverage,
// and ranks by outlet consensus (server/news-corroboration.ts).
//
// Lives in shared/ so the server owns the pool without importing the client's
// rich rss-feeds.ts. Every URL here also appears in that curated, fetch-verified
// list; this is the lean {url, source, topic} projection the ranking needs.
//
// TOPIC matches the client's NewsBucket taxonomy (lib/news-categories.ts):
// News | Business | Tech | Sports | Health | Science. Corroboration is densest
// in general "News"; niche topics lean on the client-side Nostr-network boost.

export type NewsTopic = "News" | "Business" | "Tech" | "Sports" | "Health" | "Science";

export interface NewsSource {
  url: string;
  /** Outlet display name — the corroboration unit. */
  source: string;
  topic: NewsTopic;
}

export const NEWS_SOURCES: readonly NewsSource[] = [
  // General news — the dense corroboration core.
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World", topic: "News" },
  { url: "https://www.theguardian.com/world/rss", source: "The Guardian", topic: "News" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera", topic: "News" },
  { url: "https://feeds.npr.org/1001/rss.xml", source: "NPR", topic: "News" },
  { url: "https://www.pbs.org/newshour/feeds/rss/headlines", source: "PBS NewsHour", topic: "News" },
  { url: "https://www.cbsnews.com/latest/rss/main", source: "CBS News", topic: "News" },
  { url: "https://theintercept.com/feed/?rss", source: "The Intercept", topic: "News" },
  { url: "https://feeds.propublica.org/propublica/main", source: "ProPublica", topic: "News" },
  { url: "https://reason.com/feed/", source: "Reason", topic: "News" },
  { url: "https://feeds.npr.org/1014/rss.xml", source: "NPR Politics", topic: "News" },

  // Business & finance.
  { url: "https://fortune.com/feed/", source: "Fortune", topic: "Business" },
  { url: "https://www.businessinsider.com/rss", source: "Business Insider", topic: "Business" },
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", source: "CNBC", topic: "Business" },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", source: "BBC Business", topic: "Business" },
  { url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", source: "MarketWatch", topic: "Business" },
  { url: "https://finance.yahoo.com/news/rssindex", source: "Yahoo Finance", topic: "Business" },
  { url: "https://bitcoinmagazine.com/feed", source: "Bitcoin Magazine", topic: "Business" },

  // Technology.
  { url: "https://www.theverge.com/rss/index.xml", source: "The Verge", topic: "Tech" },
  { url: "https://www.404media.co/rss/", source: "404 Media", topic: "Tech" },
  { url: "https://feeds.arstechnica.com/arstechnica/index", source: "Ars Technica", topic: "Tech" },
  { url: "https://www.eff.org/rss/updates.xml", source: "EFF", topic: "Tech" },
  { url: "https://krebsonsecurity.com/feed/", source: "Krebs on Security", topic: "Tech" },

  // Sports.
  { url: "https://frontofficesports.com/feed/", source: "Front Office Sports", topic: "Sports" },
  { url: "https://www.cbssports.com/rss/headlines/", source: "CBS Sports", topic: "Sports" },
  { url: "https://feeds.bbci.co.uk/sport/rss.xml", source: "BBC Sport", topic: "Sports" },

  // Science.
  { url: "https://www.nasa.gov/news-release/feed/", source: "NASA", topic: "Science" },
  { url: "https://www.scientificamerican.com/platform/syndication/rss/", source: "Scientific American", topic: "Science" },
  { url: "https://api.quantamagazine.org/feed/", source: "Quanta Magazine", topic: "Science" },

  // Health.
  { url: "https://feeds.npr.org/1128/rss.xml", source: "NPR Health", topic: "Health" },
];

/** All distinct feed URLs in the pool — what the aggregation job fetches. */
export const NEWS_SOURCE_URLS: readonly string[] = NEWS_SOURCES.map((s) => s.url);

/** url → outlet name, for tagging fetched items with their source. */
export const SOURCE_BY_URL: ReadonlyMap<string, NewsSource> = new Map(
  NEWS_SOURCES.map((s) => [s.url, s]),
);

export const NEWS_TOPICS: readonly NewsTopic[] = ["News", "Business", "Tech", "Sports", "Health", "Science"];
