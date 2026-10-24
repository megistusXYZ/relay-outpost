/**
 * The curated lists the app suggests, in one file for the client and the
 * server. The server serves it at /api/curated (server/curated-route.ts), so
 * a fix reaches everyone at deploy, an installed app on an older build
 * included; the app keeps this same file built in as its fallback
 * (client/src/lib/curated-lists-source.ts). Whatever arrives over the wire
 * is checked entry by entry with the checks below.
 *
 * Starter communities: every entry verified on the wire (NIP-11 answered with
 * a name and operator) before it earned a place; never add one you haven't
 * probed. Order is deliberate (owner-curated, 2026-08-27), not alphabetical.
 */

export interface StarterCommunity {
  url: string;
  name: string;
  /** Our one-line human pitch, NOT the relay's own description. */
  tagline: string;
}

export interface CuratedFeed {
  name: string;
  url: string;
  category: string;
  siteUrl?: string;
}

export interface CuratedLists {
  starterCommunities: StarterCommunity[];
  suggestedFeeds: CuratedFeed[];
}

const str = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

export function isStarterCommunity(x: unknown): x is StarterCommunity {
  const c = x as StarterCommunity | null;
  return !!c && typeof c === "object" && str(c.url) && /^wss:\/\/[^\s/]+/.test(c.url) && str(c.name) && str(c.tagline);
}

export function isCuratedFeed(x: unknown): x is CuratedFeed {
  const f = x as CuratedFeed | null;
  return !!f && typeof f === "object" && str(f.name) && str(f.url) && /^https?:\/\//.test(f.url) && str(f.category)
    && (f.siteUrl === undefined || (typeof f.siteUrl === "string" && /^https?:\/\//.test(f.siteUrl)));
}

/** What arrived from /api/curated, every entry checked; null when it isn't a list object at all. */
export function parseCuratedLists(body: unknown): Partial<CuratedLists> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const out: Partial<CuratedLists> = {};
  if (Array.isArray(b.starterCommunities)) out.starterCommunities = b.starterCommunities.filter(isStarterCommunity);
  if (Array.isArray(b.suggestedFeeds)) out.suggestedFeeds = b.suggestedFeeds.filter(isCuratedFeed);
  return out;
}

export const CURATED_LISTS: CuratedLists = {
  starterCommunities: [
  { url: "wss://relay.ditto.pub", name: "Ditto", tagline: "The Ditto community's home relay" },
  { url: "wss://relay.primal.net", name: "Primal", tagline: "The busiest public square on the network" },
  { url: "wss://pyramid.fiatjaf.com", name: "fiatjaf's Pyramid", tagline: "Invite-only room run by nostr's original builder" },
  { url: "wss://spatia-arcana.com", name: "Spatia Arcana", tagline: "\"I contain multitudes\" — an eclectic gathering place" },
  { url: "wss://nostr21.com", name: "nostr21", tagline: "West-coast original — a paid, spam-free room" },
  { url: "wss://theforest.nostr1.com", name: "The Forest", tagline: "A calm, actively moderated community" },
],
  suggestedFeeds: [
  // World
  { name: "DW News", url: "https://rss.dw.com/rdf/rss-en-all", category: "World", siteUrl: "https://www.dw.com" },
  // US & Breaking
  { name: "ABC News", url: "https://abcnews.go.com/abcnews/topstories", category: "US & Breaking", siteUrl: "https://abcnews.go.com" },
  { name: "Axios", url: "https://api.axios.com/feed/", category: "US & Breaking", siteUrl: "https://www.axios.com" },
  // Business & Finance
  { name: "Fortune", url: "https://fortune.com/feed/", category: "Business & Finance", siteUrl: "https://fortune.com" },
  { name: "NPR Business", url: "https://feeds.npr.org/1006/rss.xml", category: "Business & Finance", siteUrl: "https://www.npr.org/sections/business/" },
  { name: "Business Insider", url: "https://feeds.businessinsider.com/custom/all", category: "Business & Finance", siteUrl: "https://www.businessinsider.com" },
  // Markets
  { name: "CNBC Markets", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664", category: "Markets", siteUrl: "https://www.cnbc.com/markets/" },
  { name: "Investing.com", url: "https://www.investing.com/rss/news.rss", category: "Markets", siteUrl: "https://www.investing.com" },
  // Politics
  { name: "Politico", url: "https://rss.politico.com/politics-news.xml", category: "Politics", siteUrl: "https://www.politico.com" },
  { name: "The Hill", url: "https://thehill.com/feed/", category: "Politics", siteUrl: "https://thehill.com" },
  // Technology
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "Technology" },
  { name: "Wired", url: "https://www.wired.com/feed/rss", category: "Technology" },
  { name: "MIT Tech Review", url: "https://www.technologyreview.com/feed/", category: "Technology" },
  { name: "404 Media", url: "https://www.404media.co/rss/", category: "Technology" },
  { name: "The Register", url: "https://www.theregister.com/headlines.atom", category: "Technology" },
  // Science
  { name: "Nature News", url: "https://www.nature.com/nature.rss", category: "Science", siteUrl: "https://www.nature.com" },
  { name: "Space.com", url: "https://www.space.com/feeds/all", category: "Science" },
  // Health
  { name: "KFF Health News", url: "https://kffhealthnews.org/feed/", category: "Health", siteUrl: "https://kffhealthnews.org" },
  // Sports
  { name: "Yahoo Sports", url: "https://sports.yahoo.com/rss/", category: "Sports", siteUrl: "https://sports.yahoo.com" },
  // Entertainment & Culture
  { name: "Hollywood Reporter", url: "https://www.hollywoodreporter.com/feed/", category: "Entertainment & Culture", siteUrl: "https://www.hollywoodreporter.com" },
  { name: "Pitchfork", url: "https://pitchfork.com/feed/feed-news/rss", category: "Entertainment & Culture", siteUrl: "https://pitchfork.com" },
  { name: "AV Club", url: "https://www.avclub.com/rss", category: "Entertainment & Culture", siteUrl: "https://www.avclub.com" },
  { name: "Atlas Obscura", url: "https://www.atlasobscura.com/feeds/latest", category: "Entertainment & Culture", siteUrl: "https://www.atlasobscura.com" },
  // Longform
  { name: "Aeon Essays", url: "https://aeon.co/feed.rss", category: "Longform", siteUrl: "https://aeon.co" },
  { name: "Longreads", url: "https://longreads.com/feed/", category: "Longform", siteUrl: "https://longreads.com" },
  { name: "The Marginalian", url: "https://www.themarginalian.org/feed/", category: "Longform", siteUrl: "https://www.themarginalian.org" },
  { name: "Nautilus", url: "https://nautil.us/feed/", category: "Longform", siteUrl: "https://nautil.us" },
  // Local
  { name: "Chicago Sun-Times", url: "https://chicago.suntimes.com/feed", category: "Local", siteUrl: "https://chicago.suntimes.com" },
  { name: "Seattle Times", url: "https://www.seattletimes.com/feed/", category: "Local", siteUrl: "https://www.seattletimes.com" },
  { name: "Texas Tribune", url: "https://www.texastribune.org/feeds/main/", category: "Local", siteUrl: "https://www.texastribune.org" },
  { name: "SFGate Bay Area", url: "https://www.sfgate.com/bayarea/feed/bay-area-news-429.php", category: "Local", siteUrl: "https://www.sfgate.com" },
  { name: "Boston.com", url: "https://www.boston.com/tag/local-news/feed", category: "Local", siteUrl: "https://www.boston.com" },
  // Bitcoin
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", category: "Bitcoin", siteUrl: "https://www.coindesk.com" },
  // Nostr
  { name: "Stacker News", url: "https://stacker.news/rss", category: "Nostr", siteUrl: "https://stacker.news" },
  // Privacy
  { name: "Schneier on Security", url: "https://www.schneier.com/feed/", category: "Privacy", siteUrl: "https://www.schneier.com" },
  { name: "The Tor Project", url: "https://blog.torproject.org/rss.xml", category: "Privacy", siteUrl: "https://blog.torproject.org" },
  { name: "Signal Blog", url: "https://signal.org/blog/rss.xml", category: "Privacy", siteUrl: "https://signal.org/blog/" },
],
};
