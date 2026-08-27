/**
 * Data behind the Discover bento tiles (/discover).
 *
 * Every fetcher returns `Reached<T>` so the page can put it straight through
 * `resolveTile` (lib/discover-tiles.ts) — three honest states, no tile ever
 * saying "nothing new" about a source that never answered. The reach rules
 * differ per source and are documented at each site, because they are exactly
 * the places this class of bug enters:
 *
 *  - relays: `canReachAny` over the SAME pool the query uses;
 *  - Primal: its cache WS is outside the pool, so only a NON-EMPTY answer is
 *    proof anyone was there (positive-tag rule) — an empty one proves nothing;
 *  - RSS: plain HTTP via react-query; the page derives reach from query
 *    outcomes (any success = answered), not from sockets.
 *
 * Nothing here is imported from pages/ — App.tsx code-splits every page, and a
 * value import from pages/RSSFeed.tsx or pages/ArticlesFeed.tsx would merge
 * those chunks into the landing page's bundle.
 */
import type { Event } from "nostr-tools";
import { eventStore, throttledPoolSubscribe, FAST_RELAYS, getRelaysForPurpose } from "@/lib/nostr";
import { canReachAny, canReachRelay, relayRefusedUs, type Reached } from "@/lib/relay-reach";
import { KIND_LONG_FORM, parseArticle, type ArticleData } from "@/lib/nip23";
import { fetchGlobalFeed, getCachedFollowerCount, primalStatsCache } from "@/lib/primal-cache";
import { filterSpamEvents, MIN_FOLLOWERS_GLOBAL, isReportedEvent, isReportedPubkey } from "@/lib/spam-filter";
import { computeEngagementScore } from "@/lib/engagement";
import { getFirstSeen } from "@/lib/account-age";
import { ensureLanguageDetector, getPreferredLanguages, languageAllowed } from "@/lib/language";
import { getContentWarning } from "@/lib/sensitive-content";
import { pickMarketListings, formatListingPrice, KIND_CLASSIFIED_LISTING, LISTING_RELAYS } from "@/lib/listing";
import { rankDiscoverFeed } from "@/lib/discover-rank";
import { rankTopics, pickNextUpcoming, pickImageShelf, isSensitiveMedia, type RankedTopic, type ShelfImage } from "@/lib/discover-tiles";
import { getEventMediaInfo } from "@/lib/media-utils";
import { parseCalendarEvent, KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT, type CalendarEventData } from "@/lib/calendar-events";
import { NEWS_STARTER_FEEDS, NEWS_FRONT_PAGE_URLS, PODCAST_FEED_URLS, loadHiddenDefaults, type SavedFeed } from "@/lib/rss-feeds";
import { fetchCommunityActivity } from "@/lib/community-activity";
import { normalizeUrl } from "@/lib/pinned-feeds";

/**
 * Did any of these relays actually SERVE us — socket open AND not NIP-42
 * refused? `canReachAny` alone is the wrong gate for a claim: an auth-required
 * relay accepts the WebSocket happily and refuses the REQ, so "reachable"
 * would convert a refusal into an answer (the Buzz case in relay-reach.ts).
 */
async function anyServed(urls: string[]): Promise<boolean> {
  const results = await Promise.all(urls.map(async (u) => (await canReachRelay(u)) && !relayRefusedUs(u)));
  return results.some(Boolean);
}

/** One-shot collect over a pool subscription: resolves on EOSE or the cap. */
function collectOnce(relays: string[], filter: object, capMs: number): Promise<Event[]> {
  return new Promise((resolve) => {
    const collected: Event[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { sub.close(); } catch { /* already closed */ }
      resolve(collected);
    };
    const sub = throttledPoolSubscribe(relays, filter as { kinds: number[] }, {
      onevent: (e: Event) => {
        // Warm the shared store so the page a tile links to opens hot.
        eventStore.add(e);
        collected.push(e);
      },
      oneose: finish,
    });
    setTimeout(finish, capMs);
  });
}

// ── Answer memo ──────────────────────────────────────────────────────────────
/**
 * Positive answers are remembered for a few minutes at module level, because
 * this page is a landing: it remounts on boot (the auth transition remounts
 * the route subtree), on every tab return, on theme flips. Refiring a Primal
 * fetch + two relay sweeps + a per-community pulse on each of those is the
 * "interaction storm" class this repo has already paid for once (#152).
 *
 * ONLY `reached` results are cached. An unreachable answer expires the moment
 * it is delivered — caching a failure would make Retry a dead control for the
 * TTL, and a tile that says "couldn't reach" must mean NOW, not five minutes
 * ago. (The news tile needs none of this: react-query is its memo.)
 *
 * IN-FLIGHT DEDUP. The settled-value cache alone missed the remount it was
 * built for: the route subtree remounts (tab return, theme flip) WHILE the
 * first flight is still running, so the new tile finds no settled value and
 * refires — 2× Primal fetch, 2× relay sweeps, 2× pulse. Sharing the in-flight
 * PROMISE closes that window: a remount mid-flight awaits the same request.
 * The promise is dropped once it settles unreached (so Retry re-runs).
 */
const ANSWER_TTL_MS = 5 * 60 * 1000;
const answerMemo = new Map<string, { at: number; value: Reached<unknown> }>();
const inFlight = new Map<string, Promise<Reached<unknown>>>();

async function remembered<T>(key: string, fetchFresh: () => Promise<Reached<T>>): Promise<Reached<T>> {
  const hit = answerMemo.get(key);
  if (hit && Date.now() - hit.at <= ANSWER_TTL_MS) return hit.value as Reached<T>;
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<Reached<T>>;

  const flight = (async () => {
    const value = await fetchFresh();
    if (value.reached && !value.refusedReason) answerMemo.set(key, { at: Date.now(), value });
    return value;
  })();
  inFlight.set(key, flight as Promise<Reached<unknown>>);
  try {
    return await flight;
  } finally {
    inFlight.delete(key); // reached results live in answerMemo; failures re-run
  }
}

/**
 * A one-line teaser for a kind-1 post on the Feed tile. Strips the tokens that
 * render as noise on a headline-sized preview: http(s) links AND Nostr
 * references — `nostr:npub1…`, and the bare bech32 entities (npub/nprofile/
 * nevent/note/naddr) that are ubiquitous in post bodies and would otherwise
 * show as a wall of base32 on the app's front door.
 */
const NOSTR_TOKEN = /(?:nostr:)?(?:npub1|nprofile1|nevent1|note1|naddr1|nrelay1)[0-9a-z]+/gi;
export function feedSnippet(content: string, max = 140): string {
  return content
    .replace(/https?:\/\/\S+/g, "")
    .replace(NOSTR_TOKEN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ── News (pure set-builder; the fetching is react-query in the page) ─────────
/**
 * The feed set the News hero queries: the audited front-page flagships, minus
 * anything the user hid, minus podcasts — the hero slot is a headline, not an
 * episode. Bounded (~6-8) on purpose: /api/rss shares a 120 req/min/IP budget
 * with the News page itself.
 */
export function discoverNewsFeeds(
  hidden: Set<string> = loadHiddenDefaults(),
): SavedFeed[] {
  return NEWS_STARTER_FEEDS.filter(
    (f) => NEWS_FRONT_PAGE_URLS.has(f.url) && !hidden.has(f.url) && !PODCAST_FEED_URLS.has(f.url),
  );
}

// ── Articles ─────────────────────────────────────────────────────────────────
/**
 * The page's own quality bar (ArticlesFeed applies these AFTER fetching): raw
 * limit-N 30023 queries return a lot of junk, and the front door must not
 * showcase it. Dedupe keeps the newest edition per addressable coordinate.
 */
export function survivingArticles(events: Event[]): ArticleData[] {
  const byCoord = new Map<string, Event>();
  for (const e of events) {
    const dTag = e.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const key = `${e.pubkey}:${dTag}`;
    const cur = byCoord.get(key);
    if (!cur || e.created_at > cur.created_at) byCoord.set(key, e);
  }
  // A FUTURE publishedAt would win "newest" forever — nip23 only clamps
  // published_at DOWN to created_at, so a post dated next year sits at the top
  // of the Articles tile until it is literally next year. Drop anything dated
  // past now (with an hour of clock skew); it is misconfigured or gaming the
  // sort, and either way not the freshest real article.
  const horizon = Math.floor(Date.now() / 1000) + 3600;
  return [...byCoord.values()]
    .map(parseArticle)
    .filter((a) => a.title.trim().length >= 5 && a.event.content.length >= 300 && (a.summary || a.image) && a.publishedAt <= horizon)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

export function fetchNewestArticle(): Promise<Reached<ArticleData[]>> {
  return remembered("article", fetchNewestArticleFresh);
}

async function fetchNewestArticleFresh(): Promise<Reached<ArticleData[]>> {
  // Reach measured against the same pool sockets the subscribe uses — not a
  // fourth hand-rolled primitive. Raced in parallel; it costs nothing when the
  // sockets are already warm.
  const [served, events] = await Promise.all([
    anyServed(FAST_RELAYS),
    collectOnce(FAST_RELAYS, { kinds: [KIND_LONG_FORM], limit: 15 }, 11_000),
  ]);
  // Top TWO editions — one headline over a tall empty card undersold the
  // shelf (same densification as the feed tile).
  const top = survivingArticles(events).slice(0, 2);
  // Events in hand are themselves proof someone answered, even if the reach
  // probe lost its race with a relay that dropped right after serving us.
  return { data: top, reached: served || events.length > 0 };
}

// ── Feed teaser ──────────────────────────────────────────────────────────────
/**
 * The floor Home's For-You applies, on the pure pieces (filterSpamEvents +
 * language + content-warning). Deliberately WITHOUT `profileSettledGetter`:
 * that getter reports the app's own profile pipeline, which a one-shot call
 * has not primed, so every author would sit in "unsettled" grace and nothing
 * would survive. fetchGlobalFeed delivers the kind-0s in the same response, so
 * profileGetter alone resolves named authors immediately — and an author with
 * no profile at all is exactly what the front door should drop.
 */
function floorTeaser(posts: Event[], langs: string[], mode: "primal" | "relay", flagged: Set<string>): Event[] {
  const floored = filterSpamEvents(posts, {
    allEvents: posts,
    hideMachineReadable: true,
    hideNoProfile: true,
    // The viewer's shield. Home's For You hides flagged authors and the
    // people strip HOLDS for this set; the front-door feed tile must not be
    // the one surface that previews a shield-hidden author's post.
    flaggedPubkeys: flagged,
    profileGetter: (pk: string) => {
      try {
        const ev = eventStore.getEvent({ kind: 0, pubkey: pk, identifier: "" });
        return ev ? JSON.parse(ev.content) : null;
      } catch { return null; }
    },
    crossAuthorDedupe: true,
    languageAllowed: (e: Event) => languageAllowed(e.content, langs),
    // The engagement-fed gates run ONLY on the Primal path, because they are
    // fed by Primal: minFollowers reads getCachedFollowerCount and the combo
    // gate's escape hatches (engagement, follower count, first-seen) are all
    // caches that Primal populates. On the relay fallback — which runs exactly
    // when Primal is down — those caches are empty, every stranger fails every
    // hatch, and the "floor" silently becomes a wall: 30 fresh posts in hand
    // and a tile that says "Quiet right now". A lighter floor on the fallback
    // is honest; an empty confident claim is not.
    ...(mode === "primal"
      ? {
          minFollowers: MIN_FOLLOWERS_GLOBAL,
          followerCountGetter: getCachedFollowerCount,
          newAccountComboGate: true,
          firstSeenGetter: getFirstSeen,
          engagementScoreGetter: (e: Event) => computeEngagementScore(primalStatsCache.get(e.id) ?? null),
        }
      : {}),
  });
  // NSFW is render-time in Home (NostrPost blurs); a bare teaser has no blur,
  // so content warnings are dropped rather than shown naked on the landing.
  return floored.filter((e) => getContentWarning(e) === null);
}

export function fetchFeedTeaser(flagged: Set<string> = new Set()): Promise<Reached<Event[]>> {
  // Key on shield readiness (empty vs applied): a memo taken BEFORE the
  // GrapeRank set loaded must not be served to the same viewer AFTER it does —
  // otherwise the tile keeps a pre-shield pick for the 5-minute TTL.
  return remembered(`teaser:${flagged.size > 0 ? "f" : "0"}`, () => fetchFeedTeaserFresh(flagged));
}

async function fetchFeedTeaserFresh(flagged: Set<string>): Promise<Reached<Event[]>> {
  await ensureLanguageDetector();
  const langs = getPreferredLanguages();
  const sinceSecs = Math.floor(Date.now() / 1000) - 6 * 3600;

  // Top THREE of the same vetted ranking (language, spam floor, flagged
  // shield, engagement) — the tile was showing one post over a tall empty
  // card, which read as a quiet network over a busy one.
  const pick = (posts: Event[], mode: "primal" | "relay"): Event[] =>
    rankDiscoverFeed(floorTeaser(posts, langs, mode, flagged), {
      now: Math.floor(Date.now() / 1000),
      getEngagement: (id: string) => computeEngagementScore(primalStatsCache.get(id) ?? null),
    }).slice(0, 3);

  // Primal never rejects and FAILS OPEN to [] — an empty answer is
  // structurally ambiguous (down, timeout, or genuinely quiet), so only a
  // non-empty one counts as reached.
  const primal = await fetchGlobalFeed(30, sinceSecs);
  if (primal.posts.length > 0) return { data: pick(primal.posts, "primal"), reached: true };
  // (unreached below returns [] — the type's empty, the flag carries the truth)

  // Primal said nothing, which proves nothing. Ask the relays — with reach
  // measured first, so "empty" is only ever claimed after somebody answered.
  const relays = getRelaysForPurpose("notes");
  if (!(await canReachAny(relays))) return { data: [], reached: false };
  const events = await collectOnce(relays, { kinds: [1], limit: 30, since: sinceSecs }, 8_000);
  // hideNoProfile needs kind-0s, and unlike Primal the relays do not volunteer
  // them — without this second hop the floor drops EVERY post (no author can
  // resolve "named") and the tile lies "Quiet right now" over a busy network.
  const authors = [...new Set(events.map((e) => e.pubkey))].slice(0, 40);
  if (authors.length > 0) await collectOnce(relays, { kinds: [0], authors }, 3_000);
  return { data: pick(events, "relay"), reached: true };
}

// ── Communities (joined path) ────────────────────────────────────────────────
export interface CommunityPulse {
  /** How many joined communities we measured. */
  total: number;
  /** Of those, how many had group chat inside the recency window. */
  active: number;
  /** The most recently active one, when any answered with activity. */
  newest?: { url: string; at: number };
}

/**
 * Activity across the joined outposts. fetchCommunityActivity is already
 * reach-aware internally, but its map collapses unreached and reached-quiet
 * into the same absence (correct for ORDERING, its original job — a missing
 * entry means "don't move this row"). The tile makes a claim, not an ordering,
 * so a separate canReachAny gate splits the two: an empty map with nobody
 * reachable is "couldn't reach", not "quiet week".
 */
export function fetchCommunityPulse(
  urls: string[],
  windowMs: number,
): Promise<Reached<CommunityPulse | null>> {
  // Keyed on the joined set: joining or leaving a community must not be
  // answered from the old set's memo.
  return remembered(`pulse:${urls.map(normalizeUrl).sort().join(",")}:${windowMs}`, () => fetchCommunityPulseFresh(urls, windowMs));
}

async function fetchCommunityPulseFresh(
  urls: string[],
  windowMs: number,
): Promise<Reached<CommunityPulse | null>> {
  if (urls.length === 0) return { data: null, reached: true };
  const activity = await fetchCommunityActivity(urls);
  // An entry in the map is an answer by construction. An empty map needs the
  // SERVED check, not mere reachability: fetchCommunityActivity already
  // excluded NIP-42-refused relays, and canReachAny would count exactly those
  // refusals back in as answers.
  const reached = activity.size > 0 || (await anyServed(urls));
  if (!reached) return { data: null, reached: false };
  return { data: summarizePulse(urls, activity, Date.now(), windowMs), reached: true };
}

/**
 * Pure fold of an activity map into the tile's claim. Split out because the
 * lookup key is a trap: the map is keyed by `normalizeUrl` (lowercase, no
 * trailing slash), and a raw-URL lookup makes a community miss its own answer
 * — silently, which is why this has its own tests.
 */
export function summarizePulse(
  urls: string[],
  activity: Map<string, number>,
  now: number,
  windowMs: number,
): CommunityPulse {
  let active = 0;
  let newest: CommunityPulse["newest"];
  for (const url of urls) {
    const at = activity.get(normalizeUrl(url));
    if (at === undefined) continue;
    if (now - at <= windowMs) active++;
    if (!newest || at > newest.at) newest = { url, at };
  }
  return { total: urls.length, active, newest };
}

// ── Next calendar event ──────────────────────────────────────────────────────

export async function fetchNextCalendarEvent(): Promise<Reached<CalendarEventData | null>> {
  return remembered("calendar", fetchNextCalendarEventFresh);
}

async function fetchNextCalendarEventFresh(): Promise<Reached<CalendarEventData | null>> {
  const [served, events] = await Promise.all([
    anyServed(FAST_RELAYS),
    collectOnce(FAST_RELAYS, { kinds: [KIND_DATE_CALENDAR_EVENT, KIND_TIME_CALENDAR_EVENT], limit: 60 }, 11_000),
  ]);
  const parsed = events
    .map(parseCalendarEvent)
    .filter((e): e is CalendarEventData => e !== null && !!e.title);
  const next = pickNextUpcoming(parsed, Math.floor(Date.now() / 1000));
  return { data: next, reached: served || events.length > 0 };
}

// ── Video teaser ─────────────────────────────────────────────────────────────

export interface VideoTeaser {
  /** Event id — the freshness ledger's identity for this video. */
  id: string;
  title: string;
  poster?: string;
  timeMs?: number;
}

/** Title tag + imeta poster from a NIP-71 addressable video event. */
export function videoTeaserOf(event: Event): VideoTeaser | null {
  const title = event.tags.find((t) => t[0] === "title")?.[1]?.trim();
  if (!title) return null;
  const id = event.id;
  const timeMs = event.created_at * 1000;
  let poster: string | undefined;
  for (const t of event.tags) {
    if (t[0] !== "imeta") continue;
    for (const part of t.slice(1)) {
      if (typeof part === "string" && part.startsWith("image ")) { poster = part.slice(6).trim(); break; }
    }
    if (poster) break;
  }
  // NIP-71 also allows a bare image tag.
  if (!poster) poster = event.tags.find((t) => t[0] === "image")?.[1];
  return { id, title, poster, timeMs };
}

// ── Images shelf ─────────────────────────────────────────────────────────────

/**
 * The Discover shelf's thumbnails: last-24h images from BOTH image roots —
 * kind-1 notes with images and NIP-68 kind-20 picture posts — one per author
 * until the cap (pickImageShelf). Reach-honest like every tile fetch here:
 * `reached` is anyServed-or-events, never inferred from emptiness.
 */
export async function fetchImagesTeaser(
  follows: readonly string[],
  flagged: ReadonlySet<string>,
): Promise<Reached<ShelfImage[]>> {
  return remembered(`images:${follows.length}:${flagged.size > 0 ? "f" : "0"}`, () => fetchImagesTeaserFresh(follows, flagged));
}

async function fetchImagesTeaserFresh(
  follows: readonly string[],
  flagged: ReadonlySet<string>,
): Promise<Reached<ShelfImage[]>> {
  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  // NETWORK FIRST (owner call, 2026-08-18): Discover is the front door, and
  // the global image firehose put adjacent-content thumbnails on a new
  // user's first screen. People the viewer follows are the same trust basis
  // the feed runs on (and the fetchNetworkTopics precedent); the global
  // window only fills in when the network yields nothing to show.
  const networkAuthors = follows.slice(0, 150);
  const [served, networkEvents] = await Promise.all([
    anyServed(FAST_RELAYS),
    networkAuthors.length > 0
      ? collectOnce(FAST_RELAYS, { kinds: [1, 20], authors: networkAuthors, since, limit: 60 }, 8_000)
      : Promise.resolve([] as Event[]),
  ]);
  const toCandidates = (events: Event[]): ShelfImage[] => {
    const out: ShelfImage[] = [];
    for (const e of events) {
      // Both filters on BOTH paths: labels are honored even for follows
      // (an author who labelled their post asked not to be a thumbnail),
      // and flagged authors never make the front door.
      if (flagged.has(e.pubkey) || isSensitiveMedia(e)) continue;
      const info = getEventMediaInfo(e.content, e.tags);
      if (!info.hasImage || info.imageUrls.length === 0) continue;
      out.push({ id: e.id, url: info.imageUrls[0], authorPk: e.pubkey, timeMs: e.created_at * 1000 });
    }
    return out;
  };
  // NO global fallback, deliberately: labels can't catch UNLABELLED explicit
  // content from strangers, and the fallback would fire exactly for the new
  // user with a thin follow graph — the person the front door most needs to
  // not scare off. A quiet tile (its door still opens the images feed, where
  // the full trust filters run) beats a roulette thumbnail.
  const candidates = toCandidates(networkEvents);
  return { data: pickImageShelf(candidates, 8), reached: served || networkEvents.length > 0 };
}

export async function fetchVideoTeaser(): Promise<Reached<VideoTeaser | null>> {
  return remembered("video", fetchVideoTeaserFresh);
}

// ── Marketplace tile ─────────────────────────────────────────────────────────

export interface MarketTeaser {
  id: string;
  title: string;
  priceLine?: string;
  image?: string;
  timeMs: number;
}

export async function fetchMarketShelf(): Promise<Reached<MarketTeaser[] | null>> {
  return remembered("market", fetchMarketShelfFresh);
}

async function fetchMarketShelfFresh(): Promise<Reached<MarketTeaser[] | null>> {
  // Conduit's relay carries the densest listing set; the generals fill in.
  const relays = [...LISTING_RELAYS, ...FAST_RELAYS.slice(0, 3)];
  const [served, events] = await Promise.all([
    anyServed(relays),
    collectOnce(relays, { kinds: [KIND_CLASSIFIED_LISTING], limit: 40 }, 11_000),
  ]);
  // A marketplace door that shows words undersells the room behind it
  // (ImagesShelf precedent) — image-bearing, unsold, front-door-safe.
  const teasers = pickMarketListings(events.filter((e) => !isSensitiveMedia(e)), {
    isReported: (e) => isReportedEvent(e.id) || isReportedPubkey(e.pubkey),
  })
    .filter((l) => !l.sold && l.images.length > 0)
    .slice(0, 6)
    .map((l) => ({
      id: l.id,
      title: l.title,
      priceLine: l.price ? formatListingPrice(l.price) : undefined,
      image: l.images[0],
      timeMs: l.publishedAt * 1000,
    }));
  return { data: teasers.length > 0 ? teasers : null, reached: served || events.length > 0 };
}

async function fetchVideoTeaserFresh(): Promise<Reached<VideoTeaser | null>> {
  const [served, events] = await Promise.all([
    anyServed(FAST_RELAYS),
    // All four video generations — NIP-71 21/22 is where new publishing
    // lives; 34235/34236 is the legacy/archive pair (see VIDEO_EVENT_KINDS).
    collectOnce(FAST_RELAYS, { kinds: [21, 22, 34235, 34236], limit: 20 }, 11_000),
  ]);
  const teasers = events
    .sort((a, b) => b.created_at - a.created_at)
    // Same front-door label gate as the images shelf (discover-tiles).
    .filter((e) => !isSensitiveMedia(e))
    .map(videoTeaserOf)
    .filter((t): t is VideoTeaser => t !== null);
  const pick = teasers.find((t) => !!t.poster) ?? teasers[0] ?? null;
  return { data: pick, reached: served || events.length > 0 };
}

// ── Network topics ───────────────────────────────────────────────────────────

/**
 * Hashtags the viewer's NETWORK used in the last day, ranked by distinct
 * authors (rankTopics — spam-resistant by construction). Additive surface:
 * the strip renders nothing when this is empty, so no reach state is carried —
 * absence claims nothing.
 */
export async function fetchNetworkTopics(follows: readonly string[]): Promise<RankedTopic[]> {
  if (follows.length === 0) return [];
  const key = `topics:${follows.length}`;
  const memo = await remembered(key, async () => {
    const since = Math.floor(Date.now() / 1000) - 24 * 3600;
    const authors = follows.slice(0, 150);
    const notes = await collectOnce(getRelaysForPurpose("notes"), { kinds: [1], authors, since, limit: 150 }, 8_000);
    return { data: rankTopics(notes), reached: notes.length > 0 };
  });
  return memo.data ?? [];
}
