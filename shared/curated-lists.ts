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

export interface PresetCategoryPill {
  key: string;
  label: string;
  /** Trending `cat` param: a Podcast Index category id, or null for Top. */
  cat: string | null;
}

export interface PresetShow {
  /** Display/spec title as curated (used for matching). */
  title: string;
  /** Term sent to the search proxy to find the live feed. */
  searchTerm: string;
  /**
   * Alternate canonical titles the index is known to use (host-name variants
   * plain normalization can't bridge). Matching still happens against LIVE
   * search results: aliases only widen what counts as "same show".
   */
  aliases?: string[];
}

export interface CuratedLists {
  starterCommunities: StarterCommunity[];
  suggestedFeeds: CuratedFeed[];
  /** Suggested people (npub), in display order. */
  suggestedPeople: string[];
  /** Accounts whose channel posts seed the Channels directory (hex). */
  channelSeedPosters: string[];
  /** Sellers kept off the shared marketplace shelves (hex): catalog floods. */
  mutedSellers: string[];
  /** The podcast zero-state pills. */
  podcastPills: PresetCategoryPill[];
  /** Curated flagship shows per pill key ("top" stays dynamic). */
  podcastShows: Record<string, PresetShow[]>;
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

export const isNpub = (x: unknown): x is string => typeof x === "string" && /^npub1[02-9ac-hj-np-z]{58}$/.test(x);
export const isHexPubkey = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);

export function isPodcastPill(x: unknown): x is PresetCategoryPill {
  const p = x as PresetCategoryPill | null;
  return !!p && typeof p === "object" && str(p.key) && str(p.label) && (p.cat === null || str(p.cat));
}

export function isPresetShow(x: unknown): x is PresetShow {
  const s = x as PresetShow | null;
  return !!s && typeof s === "object" && str(s.title) && str(s.searchTerm)
    && (s.aliases === undefined || (Array.isArray(s.aliases) && s.aliases.every(str)));
}

/** What arrived from /api/curated, every entry checked; null when it isn't a list object at all. */
export function parseCuratedLists(body: unknown): Partial<CuratedLists> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const out: Partial<CuratedLists> = {};
  if (Array.isArray(b.starterCommunities)) out.starterCommunities = b.starterCommunities.filter(isStarterCommunity);
  if (Array.isArray(b.suggestedFeeds)) out.suggestedFeeds = b.suggestedFeeds.filter(isCuratedFeed);
  if (Array.isArray(b.suggestedPeople)) out.suggestedPeople = b.suggestedPeople.filter(isNpub);
  if (Array.isArray(b.channelSeedPosters)) out.channelSeedPosters = b.channelSeedPosters.filter(isHexPubkey);
  if (Array.isArray(b.mutedSellers)) out.mutedSellers = b.mutedSellers.filter(isHexPubkey);
  if (Array.isArray(b.podcastPills)) out.podcastPills = b.podcastPills.filter(isPodcastPill);
  if (b.podcastShows && typeof b.podcastShows === "object" && !Array.isArray(b.podcastShows)) {
    const shows: Record<string, PresetShow[]> = {};
    for (const [key, list] of Object.entries(b.podcastShows as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const good = list.filter(isPresetShow);
      if (good.length) shows[key] = good;
    }
    out.podcastShows = shows;
  }
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
  suggestedPeople: [
  "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m", // jack
  "npub1cn4t4cd78nm900qc2hhqte5aa8c9njm6qkfzw95tszufwcwtcnsq7g3vle", // Jack Mallers
  "npub1ahxjq4v0zlvexf7cg8j9stumqp3nrtzqzzqxa7szpmcdgqrcumdq0h5ech", // Nat Brunell
  "npub18ams6ewn5aj2n3wt2qawzglx9mr4nzksxhvrdc4gzrecw7n5tvjqctp424", // Derek Ross
  "npub1a2cww4kn9wqte4ry70vyfwqyqvpswksna27rtxd8vty6c74era8sdcw83a", // Lyn Alden
  "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z", // Vitor Pamplona
  "npub1dg6es53r3hys9tk3n7aldgz4lx4ly8qu4zg468zwyl6smuhjjrvsnhsguz", // Efrat Fenigson
  // Headroom so the 2×4 strip stays full even after the user follows a few
  // (unresolved/followed entries are skipped at render).
  "npub1dergggklka99wwrs92yz8wdjs952h2ux2ha2ed598ngwu9w7a6fsh9xzpc", // Gigi
  "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6", // fiatjaf
  "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s", // Will (jb55)
],
  channelSeedPosters: [
  // notes@nostrverse.net — IPTV channel directory bot (25 channels, reposted
  // in batches). npub1eek26qhlhptxku39008vnpdzlalksd5z0sn2s4ynmnscwz260h7q57sxmr,
  // decoded in full — never hand-complete a truncated hex.
  "ce6cad02ffb8566b72257bcec985a2ff7f6836827c26a85493dce187095a7dfc",
],
  mutedSellers: [
  // TravelTelly (traveltelly@ditto.pub) — stock-photo flood, resolved live 2026-08-31.
  "7d33ba57d8a6e8869a1f1d5215254597594ac0dbfeb01b690def8c461b82db35",
],
  podcastPills: [
  { key: "top", label: "Top", cat: null },
  { key: "news", label: "News", cat: "55" },
  { key: "business", label: "Business", cat: "9" },
  { key: "sports", label: "Sports", cat: "86" },
  { key: "technology", label: "Technology", cat: "102" },
  { key: "health", label: "Health", cat: "29" },
  { key: "science", label: "Science", cat: "67" },
  { key: "stories", label: "Stories", cat: "41" },
  { key: "comedy", label: "Comedy", cat: "16" },
],
  podcastShows: {
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
},
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
