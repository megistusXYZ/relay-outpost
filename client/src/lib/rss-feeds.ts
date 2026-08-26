import { categoryToBucket } from "./news-categories";

export interface SavedFeed {
  name: string;
  url: string;
  category: string;
  siteUrl?: string;
  feedImage?: string;
  /** Podcast host / publisher, persisted from Podcast Index adds for rich cards. */
  author?: string;
  /** Feed carries a Lightning value block (known only for Podcast Index adds). */
  v4v?: boolean;
}

// Full curated set — a professional news-reader taxonomy (World / US & Breaking / Business &
// Finance / Markets / Politics / Technology / Science / Health / Sports / Entertainment &
// Culture / Longform / Local / Podcasts, plus Bitcoin, Nostr and Privacy as minority
// categories). Every URL here is fetch-verified (valid RSS/Atom + recent items). Only the
// STARTER subset (below) auto-loads for a new user; the rest stay discoverable as
// EXTRA_DEFAULT_FEEDS.
const NEWS_DEFAULT_FEEDS: SavedFeed[] = [
  // World
  { name: "The Intercept", url: "https://theintercept.com/feed/?rss", category: "World", siteUrl: "https://theintercept.com" },
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", category: "World", siteUrl: "https://www.bbc.com/news/world" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss", category: "World", siteUrl: "https://www.theguardian.com/world" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "World", siteUrl: "https://www.aljazeera.com" },
  { name: "NPR World", url: "https://feeds.npr.org/1004/rss.xml", category: "World", siteUrl: "https://www.npr.org/sections/world/" },
  // US & Breaking
  { name: "The Free Press", url: "https://www.thefp.com/feed", category: "US & Breaking", siteUrl: "https://www.thefp.com" },
  { name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", category: "US & Breaking", siteUrl: "https://www.npr.org" },
  { name: "PBS NewsHour", url: "https://www.pbs.org/newshour/feeds/rss/headlines", category: "US & Breaking", siteUrl: "https://www.pbs.org/newshour" },
  { name: "CBS News", url: "https://www.cbsnews.com/latest/rss/main", category: "US & Breaking", siteUrl: "https://www.cbsnews.com" },
  // Business & Finance
  { name: "Fortune", url: "https://fortune.com/feed/", category: "Business & Finance", siteUrl: "https://fortune.com" },
  { name: "Business Insider", url: "https://www.businessinsider.com/rss", category: "Business & Finance", siteUrl: "https://www.businessinsider.com" },
  { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", category: "Business & Finance", siteUrl: "https://www.cnbc.com" },
  { name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", category: "Business & Finance", siteUrl: "https://www.bbc.com/news/business" },
  // Markets
  { name: "ZeroHedge", url: "https://feeds.feedburner.com/zerohedge/feed", category: "Markets", siteUrl: "https://www.zerohedge.com" },
  { name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", category: "Markets", siteUrl: "https://www.marketwatch.com" },
  { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", category: "Markets", siteUrl: "https://finance.yahoo.com" },
  // Politics
  { name: "ProPublica", url: "https://feeds.propublica.org/propublica/main", category: "Politics", siteUrl: "https://www.propublica.org" },
  { name: "Reason", url: "https://reason.com/feed/", category: "Politics", siteUrl: "https://reason.com" },
  { name: "PBS NewsHour Politics", url: "https://www.pbs.org/newshour/feeds/rss/politics", category: "Politics", siteUrl: "https://www.pbs.org/newshour/politics" },
  { name: "NPR Politics", url: "https://feeds.npr.org/1014/rss.xml", category: "Politics", siteUrl: "https://www.npr.org/sections/politics/" },
  // Technology
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "Technology" },
  { name: "404 Media", url: "https://www.404media.co/rss/", category: "Technology", siteUrl: "https://www.404media.co" },
  { name: "Hacker News", url: "https://news.ycombinator.com/rss", category: "Technology" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "Technology", siteUrl: "https://arstechnica.com" },
  // Science
  { name: "NASA", url: "https://www.nasa.gov/news-release/feed/", category: "Science", siteUrl: "https://www.nasa.gov" },
  { name: "Scientific American", url: "https://www.scientificamerican.com/platform/syndication/rss/", category: "Science", siteUrl: "https://www.scientificamerican.com" },
  { name: "Quanta Magazine", url: "https://api.quantamagazine.org/feed/", category: "Science", siteUrl: "https://www.quantamagazine.org" },
  // Health
  { name: "NPR Health", url: "https://feeds.npr.org/1128/rss.xml", category: "Health", siteUrl: "https://www.npr.org/sections/health/" },
  // Sports
  { name: "Front Office Sports", url: "https://frontofficesports.com/feed/", category: "Sports", siteUrl: "https://frontofficesports.com" },
  { name: "CBS Sports", url: "https://www.cbssports.com/rss/headlines/", category: "Sports", siteUrl: "https://www.cbssports.com" },
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml", category: "Sports", siteUrl: "https://www.bbc.co.uk/sport" },
  // Entertainment & Culture
  { name: "Colossal", url: "https://www.thisiscolossal.com/feed/", category: "Entertainment & Culture", siteUrl: "https://www.thisiscolossal.com" },
  { name: "Open Culture", url: "https://www.openculture.com/feed", category: "Entertainment & Culture", siteUrl: "https://www.openculture.com" },
  { name: "Variety", url: "https://variety.com/feed/", category: "Entertainment & Culture", siteUrl: "https://variety.com" },
  { name: "Rolling Stone", url: "https://www.rollingstone.com/feed/", category: "Entertainment & Culture", siteUrl: "https://www.rollingstone.com" },
  // Longform
  { name: "The Atlantic", url: "https://www.theatlantic.com/feed/all/", category: "Longform", siteUrl: "https://www.theatlantic.com" },
  { name: "The New Yorker", url: "https://www.newyorker.com/feed/everything", category: "Longform", siteUrl: "https://www.newyorker.com" },
  // Local
  { name: "Gothamist (NYC)", url: "https://gothamist.com/feed", category: "Local", siteUrl: "https://gothamist.com" },
  { name: "LA Times California", url: "https://www.latimes.com/local/rss2.0.xml", category: "Local", siteUrl: "https://www.latimes.com/california" },
  // Bitcoin (news blogs — the Bitcoin podcast shows live in the Podcast library below)
  { name: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/feed", category: "Bitcoin", siteUrl: "https://bitcoinmagazine.com" },
  { name: "Bitcoin Optech", url: "https://bitcoinops.org/feed.xml", category: "Bitcoin", siteUrl: "https://bitcoinops.org" },
  // Privacy
  { name: "EFF Deeplinks", url: "https://www.eff.org/rss/updates.xml", category: "Privacy", siteUrl: "https://www.eff.org" },
  { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/", category: "Privacy", siteUrl: "https://krebsonsecurity.com" },
];

// ── Podcast starter library ─────────────────────────────────────────────────
  // A dedicated, categorized podcast set (12 topic categories) that lives ALONGSIDE
  // the news feeds above. Every `url` is an audio RSS enclosure feed — playback is
  // driven by the item's audioUrl (RSSFeed.tsx `isPodcast = !!item.audioUrl`), NOT
  // by the category string, so these render/play as podcasts under any category
  // name. Resolved + fetch-verified via iTunes Search (collectionName / feedUrl /
  // artworkUrl600 / trackViewUrl). The ~2 flagships per category (see STARTER_URLS)
  // auto-load for a new user; the rest stay one tap away in discovery (EXTRA).
  // The "Sports" and "Nostr" names intentionally reuse the existing news categories
  // (those already carried podcasts); the other ten are new, Top-only categories.
const PODCAST_DEFAULT_FEEDS: SavedFeed[] = [
  // Interviews & Ideas
  { name: "The Joe Rogan Experience", url: "https://feeds.megaphone.fm/GLT1412515089", category: "Interviews & Ideas", siteUrl: "https://podcasts.apple.com/us/podcast/the-joe-rogan-experience/id360084272?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/53/f9/1b/53f91b92-46f0-cf52-f65c-6b23343397c3/mza_9009835258120886668.jpg/600x600bb.jpg" },
  { name: "Lex Fridman Podcast", url: "https://lexfridman.com/feed/podcast/", category: "Interviews & Ideas", siteUrl: "https://podcasts.apple.com/us/podcast/lex-fridman-podcast/id1434243584?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts115/v4/3e/e3/9c/3ee39c89-de08-47a6-7f3d-3849cef6d255/mza_16657851278549137484.png/600x600bb.jpg" },
  { name: "The Diary of a CEO", url: "https://rss2.flightcast.com/xmsftuzjjykcmqwolaqn6mdn", category: "Interviews & Ideas", siteUrl: "https://podcasts.apple.com/us/podcast/the-diary-of-a-ceo-with-steven-bartlett/id1291423644?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/69/af/0d/69af0ddd-1e0f-7ae3-c84b-88f18e31ad0c/mza_14445920128472365296.png/600x600bb.jpg" },
  { name: "The Tim Ferriss Show", url: "https://rss.art19.com/tim-ferriss-show", category: "Interviews & Ideas", siteUrl: "https://podcasts.apple.com/us/podcast/the-tim-ferriss-show/id863897795?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/18/39/b4/1839b420-7aff-c501-5d0d-af2842fba013/mza_6255154260686997849.jpeg/600x600bb.jpg" },
  { name: "Armchair Expert with Dax Shepard", url: "https://rss.art19.com/armchair-expert", category: "Interviews & Ideas", siteUrl: "https://podcasts.apple.com/us/podcast/armchair-expert-with-dax-shepard/id1345682353?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/f0/13/8f/f0138f4b-8bc3-0a64-2c11-ef566840f60f/mza_3062409012210474882.jpeg/600x600bb.jpg" },
  { name: "Tetragrammaton with Rick Rubin", url: "https://feeds.megaphone.fm/tetragrammaton", category: "Interviews & Ideas", siteUrl: "https://podcasts.apple.com/us/podcast/tetragrammaton-with-rick-rubin/id1671669052?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/8c/b7/9e/8cb79e99-ca5c-7b0f-f00b-ff047bb9fce2/mza_10956699920341576569.png/600x600bb.jpg" },
  // Comedy
  { name: "KILL TONY", url: "https://feeds.simplecast.com/JZSQrle9", category: "Comedy", siteUrl: "https://podcasts.apple.com/us/podcast/kill-tony/id1042361179?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/a0/ad/df/a0addf99-adce-5a42-a138-81d9f8e4562e/mza_8301528492532104652.jpg/600x600bb.jpg" },
  { name: "SmartLess", url: "https://feeds.simplecast.com/hNaFxXpO", category: "Comedy", siteUrl: "https://podcasts.apple.com/us/podcast/smartless/id1521578868?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/b1/93/5f/b1935f9f-35be-9144-e813-626bd8dabfb4/mza_4132654708551836825.jpg/600x600bb.jpg" },
  { name: "Bad Friends", url: "https://feeds.megaphone.fm/TPC1602991613", category: "Comedy", siteUrl: "https://podcasts.apple.com/us/podcast/bad-friends/id1496265971?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/b0/26/c8/b026c805-1a24-55ea-cff3-d0329d2338ce/mza_11376115143280052758.jpeg/600x600bb.jpg" },
  { name: "Call Her Daddy", url: "https://feeds.simplecast.com/mKn_QmLS", category: "Comedy", siteUrl: "https://podcasts.apple.com/us/podcast/call-her-daddy/id1418960261?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/05/10/91/05109145-8c22-5464-1f20-aaedeab769f8/mza_10276081716633787086.jpg/600x600bb.jpg" },
  { name: "This Past Weekend w/ Theo Von", url: "https://feeds.megaphone.fm/thispastweekend", category: "Comedy", siteUrl: "https://podcasts.apple.com/us/podcast/this-past-weekend-w-theo-von/id1190981360?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/9c/f6/5a/9cf65abb-f8db-fb7b-984f-b4276a1e8c85/mza_2107148709996282347.jpg/600x600bb.jpg" },
  { name: "Conan O'Brien Needs a Friend", url: "https://feeds.simplecast.com/dHoohVNH", category: "Comedy", siteUrl: "https://podcasts.apple.com/us/podcast/conan-obrien-needs-a-friend/id1438054347?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/c6/02/8a/c6028ab7-bffd-db83-53e4-34a4ea9bef21/mza_16944101310108746053.jpg/600x600bb.jpg" },
  // Sports
  { name: "The Pat McAfee Show", url: "https://feeds.megaphone.fm/ESP7297553965", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/the-pat-mcafee-show/id1435183458?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/d4/1e/fd/d41efd6c-1286-3647-be02-e53a3f349d6e/mza_14569431522144413673.jpg/600x600bb.jpg" },
  { name: "New Heights with Jason & Travis Kelce", url: "https://rss.art19.com/new-heights", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/new-heights-with-jason-travis-kelce/id1643745036?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/3a/7b/24/3a7b2444-814b-2ad4-1398-6406514a78a3/mza_6923137187248425375.jpeg/600x600bb.jpg" },
  { name: "Pardon My Take", url: "https://mcsorleys.barstoolsports.com/feed/pardon-my-take", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/pardon-my-take/id1089022756?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/35/74/6a/35746a0c-7687-7dde-ff04-338d93e78303/mza_10377078556009223546.jpg/600x600bb.jpg" },
  { name: "The Bill Simmons Podcast", url: "https://feeds.megaphone.fm/the-bill-simmons-podcast", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/the-bill-simmons-podcast/id1043699613?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/d6/ec/33/d6ec332d-41b2-4f6e-3b26-26932d266089/mza_9745793819236520970.jpg/600x600bb.jpg" },
  { name: "The Dan Le Batard Show with Stugotz", url: "https://feeds.megaphone.fm/ESP2298543312", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/the-dan-le-batard-show/id934820588?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/57/d7/d9/57d7d9e0-cf27-7928-0650-578623e80c29/mza_14930160221470262963.jpg/600x600bb.jpg" },
  { name: "Busted Open", url: "https://feeds.simplecast.com/85uBY5kw", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/busted-open/id1463861548?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/e8/93/02/e89302e5-b744-43b0-905e-f60c19892346/mza_248023211905735597.jpg/600x600bb.jpg" },
  { name: "Bettor Day", url: "https://feeds.simplecast.com/GWzT7hqa", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/bettor-day/id1832598574?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/0d/b3/7b/0db37b7b-52b6-e1a6-f42c-29b091667665/mza_13429232242680389893.jpg/600x600bb.jpg" },
  { name: "Baseball Today", url: "https://feeds.simplecast.com/9pM3N4cY", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/baseball-today/id1570550741?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/07/14/89/0714895d-cd17-0962-46f4-21c71ba2fd82/mza_1537398136079221583.jpg/600x600bb.jpg" },
  { name: "Play Me or Fade Me", url: "https://feeds.megaphone.fm/playmeorfademe", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/play-me-or-fade-me-sports-betting-picks-podcast/id1583328373?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/63/dd/8c/63dd8cca-965c-a023-fb12-7fbb1d2aeab6/mza_15178353930116704629.jpeg/600x600bb.jpg" },
  { name: "Gunfighter Life", url: "https://www.spreaker.com/show/4187306/episodes/feed", category: "Sports", siteUrl: "https://podcasts.apple.com/us/podcast/gunfighter-life-survival-guns-ammo-hunting-defense/id1493302664?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/17/f3/2e/17f32ecc-b612-d04b-d46d-0aea621530d0/mza_7720750900078264952.jpg/600x600bb.jpg" },
  // Bitcoin & Crypto
  { name: "TFTC: A Bitcoin Podcast", url: "https://anchor.fm/s/558f520/podcast/rss", category: "Bitcoin & Crypto", siteUrl: "https://podcasts.apple.com/us/podcast/tftc-a-bitcoin-podcast/id1292381204?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/29/84/2a/29842aec-ab2f-f4ea-720c-0a182b896001/mza_16883325139704201560.jpg/600x600bb.jpg" },
  { name: "What Bitcoin Did", url: "https://feeds.fountain.fm/UZSKQcrOnhqYS1JopxGg", category: "Bitcoin & Crypto", siteUrl: "https://podcasts.apple.com/us/podcast/what-bitcoin-did/id1482455669?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/fb/ff/bb/fbffbba3-1a5b-0759-fa35-cafc42f214c9/mza_4444412895211887709.jpg/600x600bb.jpg" },
  { name: "Bitcoin Magazine Podcast", url: "https://anchor.fm/s/cefa18a0/podcast/rss", category: "Bitcoin & Crypto", siteUrl: "https://podcasts.apple.com/us/podcast/bitcoin-magazine-podcast/id1459884105?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts113/v4/ac/ae/db/acaedb6a-8d05-1ced-555d-c9503431478f/mza_436577427972612537.jpg/600x600bb.jpg" },
  { name: "Bankless", url: "https://feeds.flightcast.com/p83fuj0y0u58o82l41xei7zo.xml", category: "Bitcoin & Crypto", siteUrl: "https://podcasts.apple.com/us/podcast/bankless/id1499409058?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts125/v4/7d/89/b1/7d89b1bf-d4dc-c8aa-894c-d2bc002c42be/mza_5764066019463168929.png/600x600bb.jpg" },
  { name: "Coin Stories with Natalie Brunell", url: "https://rss.libsyn.com/shows/344543/destinations/2813255.xml", category: "Bitcoin & Crypto", siteUrl: "https://podcasts.apple.com/us/podcast/coin-stories-with-natalie-brunell/id1569130932?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/1a/7b/dc/1a7bdcc2-aec2-cc7e-bc6f-7ff6a0e9a3e5/mza_17870559487036912637.jpg/600x600bb.jpg" },
  { name: "THE Bitcoin Podcast", url: "https://feeds.fountain.fm/VV0f6IwusQoi5kOqvNCx", category: "Bitcoin & Crypto", siteUrl: "https://podcasts.apple.com/us/podcast/the-bitcoin-podcast/id1694392423?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/23/19/1e/23191e18-532e-19cb-45bf-09f7461ae9d0/mza_9248153621676036701.jpg/600x600bb.jpg" },
  { name: "Bitcoin News Alerts", url: "https://rss.libsyn.com/shows/587535/destinations/5099755.xml", category: "Bitcoin & Crypto", siteUrl: "https://podcasts.apple.com/us/podcast/bitcoin-news-alerts-daily-btc-macro-signal/id1482070333?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/92/fb/01/92fb0161-6217-6575-ad99-793f89632bc9/mza_13568706689876036371.jpg/600x600bb.jpg" },
  { name: "Krypto Podcast (DE)", url: "https://feeds.acast.com/public/shows/67b47924ef66dc14d1c0e258", category: "Bitcoin & Crypto", siteUrl: "https://podcasts.apple.com/us/podcast/krypto-podcast-bitcoin-ki-krypto-news-und-cbdc-rwa/id1345084187?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts112/v4/ea/8b/2e/ea8b2e3a-b8e6-fdb8-bd0d-4a787e8d5d1b/mza_11676288571358134672.jpg/600x600bb.jpg" },
  // Nostr
  { name: "Plebchain Radio", url: "https://feeds.fountain.fm/xRzQd3loNa0ItnvWXcOz", category: "Nostr", siteUrl: "https://podcasts.apple.com/us/podcast/plebchain-radio/id1691033484?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/5d/f0/63/5df06354-a08e-010a-9576-415cfb1017d6/mza_17691993919286006024.jpg/600x600bb.jpg" },
  { name: "Rabbit Hole Recap", url: "https://feeds.fountain.fm/0EAzqUaM4qqanDr1qNuK", category: "Nostr", siteUrl: "https://podcasts.apple.com/us/podcast/rabbit-hole-recap/id1622698349?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/f2/e2/17/f2e2177f-46df-8eba-a909-485d182cbde2/mza_8161838611335848412.jpg/600x600bb.jpg" },
  { name: "Citadel Dispatch", url: "https://serve.podhome.fm/rss/c90e609a-df1e-596a-bd5e-57bcc8aad6cc", category: "Nostr", siteUrl: "https://podcasts.apple.com/us/podcast/citadel-dispatch/id1546393840?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/01/bc/59/01bc59a8-83df-55dc-3f7e-b03ad6180d21/mza_16016917205334564904.jpeg/600x600bb.jpg" },
  // Business & Investing
  { name: "My First Million", url: "https://feeds.megaphone.fm/HS2300184645", category: "Business & Investing", siteUrl: "https://podcasts.apple.com/us/podcast/my-first-million/id1469759170?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/2a/5e/4d/2a5e4df0-8f2f-c5c7-1be9-4d220778f967/mza_12868536899493151042.jpeg/600x600bb.jpg" },
  { name: "All-In", url: "https://rss.libsyn.com/shows/254861/destinations/1928300.xml", category: "Business & Investing", siteUrl: "https://podcasts.apple.com/us/podcast/all-in-with-chamath-jason-sacks-friedberg/id1502871393?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts124/v4/c7/d2/92/c7d292ea-44b3-47ff-2f5e-74fa5b23db6c/mza_7005270671777648882.png/600x600bb.jpg" },
  { name: "Acquired", url: "https://feeds.transistor.fm/acquired", category: "Business & Investing", siteUrl: "https://podcasts.apple.com/us/podcast/acquired/id1050462261?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/a8/e1/de/a8e1deff-9f88-4e55-a541-b0dc793c0cdc/mza_11539673419613154037.jpg/600x600bb.jpg" },
  { name: "Invest Like the Best", url: "https://feeds.megaphone.fm/CLS2859450455", category: "Business & Investing", siteUrl: "https://podcasts.apple.com/us/podcast/invest-like-the-best-with-patrick-oshaughnessy/id1154105909?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/61/ae/be/61aebe7a-06e8-7390-3ae5-f2fc5889e36c/mza_10827489189939068066.jpg/600x600bb.jpg" },
  { name: "The Knowledge Project", url: "https://feeds.megaphone.fm/FSMI7575968096", category: "Business & Investing", siteUrl: "https://podcasts.apple.com/us/podcast/the-knowledge-project/id990149481?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/4a/9c/e2/4a9ce2fd-ddf6-0d00-8760-4e7167378ecf/mza_16600443422050351456.jpeg/600x600bb.jpg" },
  { name: "Planet Money", url: "https://feeds.npr.org/510289/podcast.xml", category: "Business & Investing", siteUrl: "https://podcasts.apple.com/us/podcast/planet-money/id290783428?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/85/df/53/85df5334-0fae-28a9-2bc4-b97b81061d0e/mza_10839245066228881011.jpg/600x600bb.jpg" },
  { name: "Work On Your Game", url: "https://feeds.soundcloud.com/users/soundcloud:users:68106508/sounds.rss", category: "Business & Investing", siteUrl: "https://podcasts.apple.com/us/podcast/work-on-your-game-discipline-structure-and-execution/id1102601387?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/0e/b2/6e/0eb26eb7-58c7-0663-88b8-fd648ab188cc/mza_15414287056514931185.jpg/600x600bb.jpg" },
  // Science & Tech
  { name: "Darknet Diaries", url: "https://podcast.darknetdiaries.com", category: "Science & Tech", siteUrl: "https://podcasts.apple.com/us/podcast/darknet-diaries/id1296350485?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts122/v4/3a/80/a7/3a80a7db-5620-f77b-9935-016e61cc2fbc/mza_9399859904175514567.jpg/600x600bb.jpg" },
  { name: "The Quark Side", url: "https://www.spreaker.com/show/6866878/episodes/feed", category: "Science & Tech", siteUrl: "https://podcasts.apple.com/us/podcast/the-quark-side-quantum-physics-podcast/id1874948322?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/84/67/6e/84676ed7-7243-85c0-349e-50c27e80025e/mza_3891842202905032493.jpg/600x600bb.jpg" },
  { name: "The AI Edge Daily", url: "https://feeds.acast.com/public/shows/69fc41fd669475c1079ad214", category: "Science & Tech", siteUrl: "https://podcasts.apple.com/us/podcast/the-ai-edge-daily/id1896400463?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/74/bf/7a/74bf7ade-2e11-bcd5-72d3-cbe55b056224/mza_9261052019428064419.jpeg/600x600bb.jpg" },
  { name: "Hard Fork", url: "https://feeds.simplecast.com/6HKOhNgS", category: "Science & Tech", siteUrl: "https://podcasts.apple.com/us/podcast/hard-fork/id1528594034?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/de/c5/20/dec52092-6be0-9007-875c-6aa8e690a905/mza_12490014444602578825.jpg/600x600bb.jpg" },
  { name: "StarTalk Radio", url: "https://feeds.simplecast.com/4T39_jAj", category: "Science & Tech", siteUrl: "https://podcasts.apple.com/us/podcast/startalk-radio/id325404506?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/d7/88/9b/d7889bab-dca5-77ba-3d0c-7fae8f16ab11/mza_8810454848871508.jpg/600x600bb.jpg" },
  { name: "Radiolab", url: "https://feeds.simplecast.com/EmVW7VGp", category: "Science & Tech", siteUrl: "https://podcasts.apple.com/us/podcast/radiolab/id152249110?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/2b/b2/4d/2bb24d28-f3bb-916f-6bf3-9e125ba5219b/mza_4476298389845914795.jpg/600x600bb.jpg" },
  // Health & Longevity
  { name: "Huberman Lab", url: "https://feeds.megaphone.fm/hubermanlab", category: "Health & Longevity", siteUrl: "https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/9a/d3/19/9ad31912-0b5a-a16e-2d7c-9fd074698b9c/mza_8994222203629500925.jpg/600x600bb.jpg" },
  { name: "The Peter Attia Drive", url: "https://rss.libsyn.com/shows/121729/destinations/713489.xml", category: "Health & Longevity", siteUrl: "https://podcasts.apple.com/us/podcast/the-peter-attia-drive/id1400828889?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/89/b8/c0/89b8c0bb-f65c-66ef-8b96-fffea8f0cf5f/mza_872007510196734520.png/600x600bb.jpg" },
  { name: "FoundMyFitness", url: "https://rss.libsyn.com/shows/51714/destinations/184296.xml", category: "Health & Longevity", siteUrl: "https://podcasts.apple.com/us/podcast/foundmyfitness/id818198322?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/89/9a/d4/899ad444-4dc0-7a0c-e244-ed8f869d4f09/mza_4758067400065032137.jpg/600x600bb.jpg" },
  { name: "Dr. Ken Berry", url: "https://feeds.megaphone.fm/VG7178269724", category: "Health & Longevity", siteUrl: "https://podcasts.apple.com/us/podcast/dr-ken-berry-the-proper-human-diet-ancestral-health/id1886704927?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/0b/00/8f/0b008f6f-b284-558e-1041-a3f5676958a5/mza_4570984964320385763.jpeg/600x600bb.jpg" },
  { name: "The Model Health Show", url: "https://feeds.megaphone.fm/TMMOO1543465979", category: "Health & Longevity", siteUrl: "https://podcasts.apple.com/us/podcast/the-model-health-show/id640246578?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/65/e6/c3/65e6c3cd-842b-d14d-b98a-60133a67f1ae/mza_16856244931320610692.jpg/600x600bb.jpg" },
  // Mind & Wellness
  { name: "Mindfulness Meditation Podcast", url: "https://feeds.transistor.fm/mindfulness-meditation-podcast", category: "Mind & Wellness", siteUrl: "https://podcasts.apple.com/us/podcast/mindfulness-meditation-podcast/id1032846074?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/6b/ac/3e/6bac3edd-4f30-25e0-8e47-b2ca9e18a149/mza_8295255360470932212.jpg/600x600bb.jpg" },
  { name: "Abraham Hicks", url: "https://feed.podbean.com/AbrahamHicksInsight/feed.xml", category: "Mind & Wellness", siteUrl: "https://podcasts.apple.com/us/podcast/abraham-hicks/id1896856320?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/73/32/af/7332afc7-19ba-57c4-d169-23d958a0a078/mza_524421785778099230.png/600x600bb.jpg" },
  { name: "All In with Allie", url: "https://www.spreaker.com/show/5828975/episodes/feed", category: "Mind & Wellness", siteUrl: "https://podcasts.apple.com/us/podcast/all-in-with-allie/id1455030878?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/7b/a9/d5/7ba9d5a2-1b4b-f25a-dde6-e295d5c82c70/mza_16993638742081529016.jpg/600x600bb.jpg" },
  { name: "Deep Sleep Sounds & ASMR Rain", url: "https://media.rss.com/asmr-space/feed.xml", category: "Mind & Wellness", siteUrl: "https://podcasts.apple.com/us/podcast/deep-sleep-sounds-asmr-white-noise-rain-sounds-relaxing/id1796438393?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/47/90/a7/4790a767-d92c-429a-18c4-c37bdecb90dd/mza_3182785049430322703.jpg/600x600bb.jpg" },
  { name: "Sleep with Silk: Nature Sounds", url: "https://feeds.feedburner.com/silknature", category: "Mind & Wellness", siteUrl: "https://podcasts.apple.com/us/podcast/sleep-with-silk-nature-sounds-rain-thunder-wind-ocean/id1066154319?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/42/67/1a/42671a8d-97e6-cd21-556a-8ed75cca7fff/mza_12379086342191269642.jpg/600x600bb.jpg" },
  { name: "Law of Attraction Daily", url: "https://www.spreaker.com/show/5319819/episodes/feed", category: "Mind & Wellness", siteUrl: "https://www.spreaker.com/podcast/law-of-attraction-daily--5319819" },
  // News & Commentary
  { name: "Morning Wire", url: "https://rss.pdrl.fm/3f8a3d/feeds.megaphone.fm/BVDWV8747925072", category: "News & Commentary", siteUrl: "https://podcasts.apple.com/us/podcast/morning-wire/id1576594336?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/c1/d1/84/c1d184f0-ee90-a43c-f5f7-88f21e8eeccf/mza_14163782799458392314.jpg/600x600bb.jpg" },
  { name: "The Ezra Klein Show", url: "https://feeds.simplecast.com/kEKXbjuJ", category: "News & Commentary", siteUrl: "https://podcasts.apple.com/us/podcast/the-ezra-klein-show/id1548604447?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/9d/ca/35/9dca35d8-e7d2-7e4f-63b5-c2ff4973a3f5/mza_16891544429738729361.jpg/600x600bb.jpg" },
  { name: "The Tucker Carlson Show", url: "https://feeds.megaphone.fm/RSV1597324942", category: "News & Commentary", siteUrl: "https://podcasts.apple.com/us/podcast/the-tucker-carlson-show/id1719657632?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/1a/1f/9c/1a1f9c6d-67fd-0e33-cdf3-4b62617ea9a6/mza_9226157347267917930.jpg/600x600bb.jpg" },
  { name: "The Jordan B. Peterson Podcast", url: "https://feeds.megaphone.fm/BVDWV6444647327", category: "News & Commentary", siteUrl: "https://podcasts.apple.com/us/podcast/the-jordan-b-peterson-podcast/id1184022695?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/58/16/42/581642ef-7f31-d538-7c69-0a42ec25c604/mza_5721699391369703653.jpeg/600x600bb.jpg" },
  { name: "The Rubin Report", url: "https://rss.libsyn.com/shows/576235/destinations/4990775.xml", category: "News & Commentary", siteUrl: "https://podcasts.apple.com/us/podcast/the-rubin-report/id1052842770?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/ea/e9/fe/eae9fecc-7fea-d467-8b53-b2c23a1bb1aa/mza_6521149252441833359.jpg/600x600bb.jpg" },
  { name: "Up First from NPR", url: "https://feeds.npr.org/510318/podcast.xml", category: "News & Commentary", siteUrl: "https://podcasts.apple.com/us/podcast/up-first-from-npr/id1222114325?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/0e/35/25/0e352569-e694-81d9-ea55-5f935981c15a/mza_1788275989855583986.png/600x600bb.jpg" },
  { name: "The Daily", url: "https://feeds.simplecast.com/54nAGcIl", category: "News & Commentary", siteUrl: "https://podcasts.apple.com/us/podcast/the-daily/id1200361736?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/ab/64/66/ab6466a9-9a7d-e20e-7a3d-bc5be37d29ce/mza_15084852813176276273.jpg/600x600bb.jpg" },
  // True Crime & Curiosity
  { name: "Crime Junkie", url: "https://feeds.simplecast.com/qm_9xx0g", category: "True Crime & Curiosity", siteUrl: "https://podcasts.apple.com/us/podcast/crime-junkie/id1322200189?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/8c/35/04/8c350430-2fbf-98d0-0a25-00b76550ffeb/mza_13445204151221888086.jpg/600x600bb.jpg" },
  { name: "Morbid", url: "https://feeds.simplecast.com/ohmVlJZQ", category: "True Crime & Curiosity", siteUrl: "https://podcasts.apple.com/us/podcast/morbid/id1379959217?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/78/e9/0e/78e90ee0-567d-1ad8-17a0-17d7c988c4bd/mza_8425901783365617933.jpg/600x600bb.jpg" },
  { name: "Stuff You Should Know", url: "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/a91018a4-ea4f-4130-bf55-ae270180c327/44710ecc-10bb-48d1-93c7-ae270180c33e/podcast.rss", category: "True Crime & Curiosity", siteUrl: "https://podcasts.apple.com/us/podcast/stuff-you-should-know/id278981407?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/aa/82/91/aa82912f-23ee-6f6a-583c-a4e993164d0e/mza_12111158076643383507.jpg/600x600bb.jpg" },
  { name: "Hidden Brain", url: "https://feeds.simplecast.com/kwWc0lhf", category: "True Crime & Curiosity", siteUrl: "https://podcasts.apple.com/us/podcast/hidden-brain/id1028908750?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/e2/18/b8/e218b838-b790-3a33-441f-c3772d9abbbf/mza_6896085647855199484.jpg/600x600bb.jpg" },
  { name: "Freakonomics Radio", url: "https://feeds.simplecast.com/Y8lFbOT4", category: "True Crime & Curiosity", siteUrl: "https://podcasts.apple.com/us/podcast/freakonomics-radio/id354668519?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts115/v4/f7/0c/c5/f70cc540-ce36-d96f-b111-c970aad5505c/mza_17703422762227531425.jpg/600x600bb.jpg" },
  { name: "TED Talks Daily", url: "https://feeds.acast.com/public/shows/67587e77c705e441797aff96", category: "True Crime & Curiosity", siteUrl: "https://podcasts.apple.com/us/podcast/ted-talks-daily/id160904630?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/2e/cf/99/2ecf996f-71f7-604f-b0a0-43116b9d6619/mza_10257768296573848480.png/600x600bb.jpg" },
  // Culture & Creativity
  { name: "Brad Leavitt Podcast", url: "https://feeds.simplecast.com/vLiGvFnf", category: "Culture & Creativity", siteUrl: "https://podcasts.apple.com/us/podcast/brad-leavitt-podcast/id1482995768?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts126/v4/18/87/65/18876502-be9e-7424-e3cc-d2c773991f56/mza_9587140592251387195.jpg/600x600bb.jpg" },
  { name: "Your World of Creativity", url: "https://feeds.captivate.fm/markstinson/", category: "Culture & Creativity", siteUrl: "https://podcasts.apple.com/us/podcast/your-world-of-creativity/id1529812538?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts112/v4/11/cc/e1/11cce1e8-98ef-6683-7d78-5ae0a5efab9c/mza_14590745210149832069.jpg/600x600bb.jpg" },
  { name: "Roz & Mocha", url: "https://feeds.simplecast.com/v_BVbu6v", category: "Culture & Creativity", siteUrl: "https://podcasts.apple.com/us/podcast/roz-mocha/id1317799038?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/81/60/4b/81604b74-6197-1a42-251b-21ccb70484e6/mza_3268062339428990795.jpg/600x600bb.jpg" },
  { name: "99% Invisible", url: "https://feeds.simplecast.com/BqbsxVfO", category: "Culture & Creativity", siteUrl: "https://podcasts.apple.com/us/podcast/99-invisible/id394775318?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/79/d0/35/79d035ea-9043-b43e-7380-33cd47bd968b/mza_2606971010425550919.jpg/600x600bb.jpg" },
  { name: "The Moth", url: "http://feeds.feedburner.com/themothpodcast", category: "Culture & Creativity", siteUrl: "https://podcasts.apple.com/us/podcast/the-moth/id275699983?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/16/39/63/1639632d-7ad2-d87b-d4f7-d0ec95eff386/mza_8915289722686017414.jpg/600x600bb.jpg" },
  { name: "This American Life", url: "https://www.thisamericanlife.org/podcast/rss.xml", category: "Culture & Creativity", siteUrl: "https://podcasts.apple.com/us/podcast/this-american-life/id201671138?uo=4", feedImage: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/64/aa/3a/64aa3a66-a08a-947c-cf21-a5722a1b77ae/mza_11390421932467026234.png/600x600bb.jpg" },
];

// Full curated set = the news library first, then the podcast starter library.
const ALL_DEFAULT_FEEDS: SavedFeed[] = [...NEWS_DEFAULT_FEEDS, ...PODCAST_DEFAULT_FEEDS];

/** Every curated NEWS preset (podcasts excluded). */
export const ALL_NEWS_FEEDS: SavedFeed[] = NEWS_DEFAULT_FEEDS;

/** The WHOLE curated library — every news preset AND every podcast preset. This
 *  is the source for the merged "All feeds" firehose: the All view mixes the
 *  full news library with the popular podcast shows, newest-first, independent
 *  of which flagships are auto-subscribed (STARTER). Podcast episodes carry rich
 *  artwork + descriptions and get surfaced by the news-scoring "followed
 *  creator" boost, so top shows ride near the top alongside trending news. */
export const ALL_PRESET_FEEDS: SavedFeed[] = ALL_DEFAULT_FEEDS;

/** Every curated PODCAST preset — the whole popular-shows library. */
export const ALL_PODCAST_FEEDS: SavedFeed[] = PODCAST_DEFAULT_FEEDS;

/** URLs of the curated podcast presets — lets the reader tell a preset podcast
 *  show apart from a news feed (e.g. for the podcast-showcase shelf). */
export const PODCAST_FEED_URLS: ReadonlySet<string> = new Set(PODCAST_DEFAULT_FEEDS.map((f) => f.url));

// The flagships a brand-new user auto-loads on day one. NEWS: one strong pick per major
// category, plus one Bitcoin blog. PODCASTS: ~2 flagships per podcast category (a
// deliberately "moderate" auto-subscribe — the rest of the podcast library stays one tap
// away in discovery / EXTRA).
//
// News selection criterion (2026-07 audit): every news starter must render RICH in-app —
// full-copy article text in the feed itself (content:encoded, not a teaser) plus
// inline images. The big-wire feeds (BBC/NPR/CNBC/MarketWatch/PBS/SciAm/CBS
// Sports/Variety/Guardian) all ship <400-char teasers that force a click-out, so
// they were demoted to discovery. Measured through our own /api/rss:
// ProPublica 22k chars · NASA 42k · Colossal 13k · Intercept 11k · Fortune 9k ·
// ZeroHedge 7k · 404 Media 4k · Free Press 2k — all with images.
// Podcast flagships are picked by reach/activity within each category (~2 each).
const STARTER_URLS = new Set<string>([
  "https://theintercept.com/feed/?rss", // The Intercept (World) — full text + images
  "https://www.thefp.com/feed", // The Free Press (US & Breaking) — creator-led, full text
  "https://feeds.propublica.org/propublica/main", // ProPublica (Politics) — 22k-char investigations
  "https://fortune.com/feed/", // Fortune (Business & Finance) — full text
  "https://feeds.feedburner.com/zerohedge/feed", // ZeroHedge (Markets) — full text
  "https://www.theverge.com/rss/index.xml", // The Verge (Technology) — hero images
  "https://www.404media.co/rss/", // 404 Media (Technology) — journalist-owned, full text
  "https://frontofficesports.com/feed/", // Front Office Sports (Sports)
  "https://www.thisiscolossal.com/feed/", // Colossal (Entertainment & Culture) — visual, full text
  "https://www.theatlantic.com/feed/all/", // The Atlantic (Longform) — full text
  "https://bitcoinmagazine.com/feed", // Bitcoin Magazine
  // ── Podcast flagships (~2 per category) — the "moderate" auto-subscribe set ──
  "https://feeds.megaphone.fm/GLT1412515089", // The Joe Rogan Experience (Interviews & Ideas)
  "https://lexfridman.com/feed/podcast/", // Lex Fridman Podcast (Interviews & Ideas)
  "https://feeds.simplecast.com/hNaFxXpO", // SmartLess (Comedy)
  "https://feeds.megaphone.fm/thispastweekend", // This Past Weekend w/ Theo Von (Comedy)
  "https://feeds.megaphone.fm/ESP7297553965", // The Pat McAfee Show (Sports)
  "https://rss.art19.com/new-heights", // New Heights with Jason & Travis Kelce (Sports)
  "https://anchor.fm/s/558f520/podcast/rss", // TFTC: A Bitcoin Podcast (Bitcoin & Crypto)
  "https://feeds.fountain.fm/UZSKQcrOnhqYS1JopxGg", // What Bitcoin Did (Bitcoin & Crypto)
  "https://feeds.fountain.fm/xRzQd3loNa0ItnvWXcOz", // Plebchain Radio (Nostr)
  "https://feeds.fountain.fm/0EAzqUaM4qqanDr1qNuK", // Rabbit Hole Recap (Nostr)
  "https://serve.podhome.fm/rss/c90e609a-df1e-596a-bd5e-57bcc8aad6cc", // Citadel Dispatch (Nostr)
  "https://feeds.megaphone.fm/HS2300184645", // My First Million (Business & Investing)
  "https://rss.libsyn.com/shows/254861/destinations/1928300.xml", // All-In (Business & Investing)
  "https://podcast.darknetdiaries.com", // Darknet Diaries (Science & Tech)
  "https://feeds.simplecast.com/6HKOhNgS", // Hard Fork (Science & Tech)
  "https://feeds.megaphone.fm/hubermanlab", // Huberman Lab (Health & Longevity)
  "https://rss.libsyn.com/shows/121729/destinations/713489.xml", // The Peter Attia Drive (Health & Longevity)
  "https://feeds.transistor.fm/mindfulness-meditation-podcast", // Mindfulness Meditation Podcast (Mind & Wellness)
  "https://feed.podbean.com/AbrahamHicksInsight/feed.xml", // Abraham Hicks (Mind & Wellness)
  "https://feeds.npr.org/510318/podcast.xml", // Up First from NPR (News & Commentary)
  "https://feeds.simplecast.com/54nAGcIl", // The Daily (News & Commentary)
  "https://feeds.simplecast.com/qm_9xx0g", // Crime Junkie (True Crime & Curiosity)
  "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/a91018a4-ea4f-4130-bf55-ae270180c327/44710ecc-10bb-48d1-93c7-ae270180c33e/podcast.rss", // Stuff You Should Know (True Crime & Curiosity)
  "https://feeds.simplecast.com/BqbsxVfO", // 99% Invisible (Culture & Creativity)
  "http://feeds.feedburner.com/themothpodcast", // The Moth (Culture & Creativity)
]);

/** Feeds auto-loaded for a brand-new user (the calm starter set). */
export const DEFAULT_FEEDS: SavedFeed[] = ALL_DEFAULT_FEEDS.filter((f) => STARTER_URLS.has(f.url));

/** The QUALITY news flagships only (starter news — each audited to render RICH:
 *  full-copy text + images, never a teaser). This is the news half of the merged
 *  "All feeds" firehose — deliberately NOT the full library, so the demoted
 *  teaser feeds (Variety, NPR World, Rolling Stone, CBS Sports, Guardian World…)
 *  never surface there. Paired with ALL_PODCAST_FEEDS for the mix. */
export const NEWS_STARTER_FEEDS: SavedFeed[] = NEWS_DEFAULT_FEEDS.filter((f) => STARTER_URLS.has(f.url));

/** The remaining curated feeds — not auto-loaded, but offered in discovery (Popular). */
export const EXTRA_DEFAULT_FEEDS: SavedFeed[] = ALL_DEFAULT_FEEDS.filter((f) => !STARTER_URLS.has(f.url));

/**
 * The News "front page": the small curated set fetched on FIRST paint of the
 * All-feeds view (News-perf Phase 2). It deliberately includes:
 *  - one marquee news feed per topic bucket that actually appears — so every
 *    topic tab (News/Business/Tech/Sports) renders immediately (tabs only show
 *    for buckets that already have ≥1 article, so the front page must seed each),
 *  - a few more news flagships for a full "Top" first screen,
 *  - the top flagship podcasts so the Popular-podcasts shelf populates at once.
 * The rest of the ~90-feed library (long-tail news + the other ~70 podcasts)
 * backfills on idle, and tapping a topic tab primes that bucket's feeds early.
 * Built from the existing starter sets so it can't reference a stale URL.
 */
export const NEWS_FRONT_PAGE_URLS: ReadonlySet<string> = (() => {
  const urls = new Set<string>();
  // 1 marquee feed per appearing bucket → guarantees each topic tab shows.
  const seenBucket = new Set<string>();
  for (const f of NEWS_STARTER_FEEDS) {
    const b = categoryToBucket(f.category);
    if (b && !seenBucket.has(b)) { seenBucket.add(b); urls.add(f.url); }
  }
  // A few more news flagships for a fuller Top on first paint.
  for (const f of NEWS_STARTER_FEEDS.slice(0, 6)) urls.add(f.url);
  // Flagship podcasts so the shelf populates immediately.
  const podcastFlagships = PODCAST_DEFAULT_FEEDS.filter((f) => STARTER_URLS.has(f.url));
  for (const f of podcastFlagships.slice(0, 4)) urls.add(f.url);
  return urls;
})();

/** URLs of every curated preset (news + podcast) — lets the All view tell a
 *  user's OWN custom subscription apart from an auto-loaded default. */
export const PRESET_FEED_URLS: ReadonlySet<string> = new Set(ALL_PRESET_FEEDS.map((f) => f.url));

export const SUGGESTED_FEEDS: SavedFeed[] = [
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
];

export const CUSTOM_FEEDS_KEY = "relay-outpost-custom-feeds";
export const HIDDEN_DEFAULTS_KEY = "relay-outpost-hidden-defaults";

export function loadCustomFeeds(): SavedFeed[] {
  try {
    const stored = localStorage.getItem(CUSTOM_FEEDS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveCustomFeeds(feeds: SavedFeed[]) {
  try {
    localStorage.setItem(CUSTOM_FEEDS_KEY, JSON.stringify(feeds));
  } catch {
  }
}

export function loadHiddenDefaults(): Set<string> {
  try {
    const stored = localStorage.getItem(HIDDEN_DEFAULTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {}
  return new Set();
}

export function saveHiddenDefaults(urls: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_DEFAULTS_KEY, JSON.stringify([...urls]));
  } catch {
  }
}

export function getAllSavedFeedUrls(): Set<string> {
  const hidden = loadHiddenDefaults();
  const defaultUrls = DEFAULT_FEEDS.filter(f => !hidden.has(f.url)).map(f => f.url);
  const customUrls = loadCustomFeeds().map(f => f.url);
  return new Set([...defaultUrls, ...customUrls]);
}

export function updateFeedInLibrary(url: string, updates: { name?: string; category?: string }): boolean {
  const isDefault = DEFAULT_FEEDS.some(d => d.url === url);
  if (isDefault) {
    const custom = loadCustomFeeds();
    const existing = custom.find(f => f.url === url);
    if (existing) {
      if (updates.name) existing.name = updates.name;
      if (updates.category) existing.category = updates.category;
      saveCustomFeeds(custom);
    } else {
      const def = DEFAULT_FEEDS.find(d => d.url === url);
      if (!def) return false;
      const override: SavedFeed = { ...def, ...updates };
      custom.push(override);
      saveCustomFeeds(custom);
      const hidden = loadHiddenDefaults();
      hidden.add(url);
      saveHiddenDefaults(hidden);
    }
  } else {
    const custom = loadCustomFeeds();
    const feed = custom.find(f => f.url === url);
    if (!feed) return false;
    if (updates.name) feed.name = updates.name;
    if (updates.category) feed.category = updates.category;
    saveCustomFeeds(custom);
  }
  return true;
}

export function addFeedToLibrary(feed: SavedFeed): boolean {
  const existing = getAllSavedFeedUrls();
  if (existing.has(feed.url)) return false;

  const hidden = loadHiddenDefaults();
  const isHiddenDefault = DEFAULT_FEEDS.some(d => d.url === feed.url) && hidden.has(feed.url);
  if (isHiddenDefault) {
    hidden.delete(feed.url);
    saveHiddenDefaults(hidden);
  } else {
    const custom = loadCustomFeeds();
    custom.push(feed);
    saveCustomFeeds(custom);
  }
  return true;
}
