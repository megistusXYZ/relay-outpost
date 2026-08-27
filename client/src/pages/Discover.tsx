/**
 * /discover — the bento landing. Four live tiles over one universal search bar.
 *
 * This page exists because "Discover" was a tab named for a job it was never
 * given: its nav entry pointed at "/" (the feed), and when the IA collapsed
 * 8 → 4, News, Articles and Communities lost their nav entries entirely. The
 * decision record is DISCOVER_BENTO_PLAN.md; the rules that shape this file:
 *
 *  - REPLACE, not contain: the landing is a chooser; the feed is one tile.
 *  - LIVE tiles: each shows real content, or it is a menu and a step backward.
 *  - THREE HONEST STATES per tile via resolveTile — "Nothing new" only after
 *    someone provably answered (lib/discover-tiles.ts).
 *  - TILES NEVER DISAPPEAR: a dead relay must not remove the door to
 *    Communities. State changes inside the Card; the Card stays.
 *  - GUESTS SEE THE SAME PAGE, plus one sign-in row. For signed-out visitors
 *    this page is the entire navigation (buildNavDestinations returns only
 *    Discover), so every lane here renders real public content.
 *  - The bento must NOT mark news read — the unread count's whole meaning is
 *    that opening /news is what clears it.
 */
import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode, type ComponentType } from "react";
import { useLocation } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import { Newspaper, TrendingUp, Users, BookOpen, ChevronRight, Radio, Headphones, Calendar, Clapperboard, Hash, ImageIcon, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchPill } from "@/components/SearchPill";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { usePodcastTrending } from "@/hooks/use-podcast-index";
import type { CalendarEventData } from "@/lib/calendar-events";
import type { RankedTopic } from "@/lib/discover-tiles";
import { formatDistanceToNow as fdn } from "date-fns";
import { freshCount, stampTiles, loadSeen, useFreshnessVersion, type TileId as FreshTileId, type FreshItem } from "@/lib/discover-freshness";
import { markRising, type ShelfImage } from "@/lib/discover-tiles";
import { GuestWall } from "@/components/GuestWall";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import {
  useOutpostDirectorySearch,
  useOutpostDirectory,
  restartDiscovery,
  NIP_66_MONITOR_RELAYS,
} from "@/hooks/use-outpost-directory-search";
import { resolveTile } from "@/lib/discover-tiles";
import {
  discoverNewsFeeds,
  fetchNewestArticle,
  fetchFeedTeaser,
  fetchCommunityPulse,
  fetchNextCalendarEvent,
  fetchVideoTeaser,
  fetchImagesTeaser,
  fetchMarketShelf,
  fetchNetworkTopics,
  feedSnippet,
  type CommunityPulse,
  type VideoTeaser,
  type MarketTeaser,
} from "@/lib/discover-data";
import { mergeFeedItems, pickHero, type MergedItem } from "@/lib/rss-merge";
import { loadEdition } from "@/lib/news-edition";
import { computePriorityNewsUnread, loadRssReadLedger, rssItemKey, type RssCachedItemLite } from "@/lib/orbit-stories";
import { DEFAULT_FEEDS, loadCustomFeeds, loadHiddenDefaults } from "@/lib/rss-feeds";
import { loadNewsAlertPrefs } from "@/lib/news-alert-settings";
import { stripHtml } from "@/lib/podcast-index";
import { getOutpostRelays, getOutpostMeta, type OutpostRelay } from "@/lib/outpost-relays";
import { filterDirectory, toDirMatches, joinedUrlSet } from "@/lib/outpost-directory";
import { RECENT_ACTIVITY_WINDOW_MS } from "@/pages/messages/helpers";
import { canReachAny, type Reached } from "@/lib/relay-reach";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { normalizeUrl } from "@/lib/pinned-feeds";
import { FOCUS_RING } from "@/lib/a11y";
import { usePeopleTypeahead } from "@/hooks/use-people-typeahead";
import { PeopleToFollowStrip } from "@/components/PeopleToFollowStrip";
import { getDisplayName, getAvatarUrl, getProfileContent } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { ArticleData } from "@/lib/nip23";

/**
 * The one item shape the News hero flows end to end: what /api/rss caches,
 * what mergeFeedItems/pickHero accept, and what rssItemKey reads. RSSItem (the
 * News page's full type) satisfies it; the remembered edition's slimmed items
 * satisfy it; keeping it structural means no value import from pages/RSSFeed.
 */
type HeroFeedItem = RssCachedItemLite & { thumbnail?: string };

// ── Small shared pieces ──────────────────────────────────────────────────────

/** Profile name straight off the shared event store; falls back to short npub. */
function authorAvatarFor(pubkey: string): string | null {
  try {
    const ev = eventStore.getEvent({ kind: 0, pubkey, identifier: "" });
    if (ev) {
      const p = JSON.parse(ev.content);
      if (typeof p.picture === "string" && p.picture.trim()) return p.picture.trim();
    }
  } catch { /* no picture — initial fallback renders */ }
  return null;
}

function authorNameFor(pubkey: string): string {
  try {
    const ev = eventStore.getEvent({ kind: 0, pubkey, identifier: "" });
    if (ev) {
      const p = JSON.parse(ev.content);
      const name = p.display_name || p.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  } catch { /* fall through to npub */ }
  try { return `${nip19.npubEncode(pubkey).slice(0, 12)}…`; } catch { return "someone"; }
}

/** npub/nprofile (with optional nostr: prefix) → canonical npub, else null. */
function detectProfileTarget(raw: string): string | null {
  const t = raw.trim().replace(/^nostr:/i, "");
  if (!/^(npub1|nprofile1)[a-z0-9]+$/i.test(t)) return null;
  try {
    const d = nip19.decode(t.toLowerCase());
    if (d.type === "npub") return t.toLowerCase();
    if (d.type === "nprofile") return nip19.npubEncode((d.data as { pubkey: string }).pubkey);
  } catch { /* not decodable */ }
  return null;
}

/**
 * One compact tile: header row (icon · label · chip · chevron), a content
 * area, and an optional footer OUTSIDE the main button (retry lives there —
 * nested buttons are invalid HTML and the retry must not navigate).
 */
function TileShell({ icon: Icon, label, chip, onOpen, testId, children, footer, fresh }: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  chip?: ReactNode;
  onOpen: () => void;
  testId: string;
  children: ReactNode;
  footer?: ReactNode;
  /** New-since-you-left: wears the story-ring glow until the door is opened. */
  fresh?: boolean;
}) {
  return (
    <Card className={`glass-card overflow-hidden ${fresh ? "tile-fresh" : ""}`}>
      {/* ONE tile, ONE door, ONE destination: the SECTION. The per-teaser
          item doors from the first pass are gone (owner call, 2026-08-18 —
          "the article click space is way too big; a majority of the time
          users just want the page"): the teaser content visually IS most of
          the tile, so an item door swallowed nearly every tap. The teased
          item stays findable because every section surfaces it at the top of
          its own page (News hero, Images shelf, trending Articles). */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        className={`block w-full text-left p-3 sm:p-4 cursor-pointer transition-colors hover:bg-muted/20 ${FOCUS_RING}`}
        data-testid={testId}
      >
        <span className="flex items-center gap-2 mb-1.5">
          <Icon className="w-4 h-4 text-brand/70 shrink-0" />
          <span className="text-sm font-semibold">{label}</span>
          {chip}
          <ChevronRight className="w-4 h-4 ml-auto shrink-0 text-muted-foreground/40" />
        </span>
        {children}
      </div>
      {footer}
    </Card>
  );
}

/**
 * The rubber band's working memory for THIS visit: every tile reports the
 * items it is currently showing; leaving the page (or opening a tile's door)
 * stamps them seen. Module-level so the leave-stamp effect can read every
 * tile's report without prop-drilling nine callbacks.
 */
const freshReports = new Map<FreshTileId, { items: FreshItem[]; topics?: ReturnType<typeof markRising> }>();

function stampReported(only?: FreshTileId): void {
  const entries = Array.from(freshReports)
    .filter(([tile]) => !only || tile === only)
    .map(([tile, r]) => ({ tile, ids: r.items.map((i) => i.id), topics: r.topics?.map(({ rising: _r, ...t }) => t) }));
  if (entries.length > 0) stampTiles(entries);
}

/** Report current items + get the honest "+N new" count for a tile. */
function useTileFresh(tile: FreshTileId, items: FreshItem[] | null): number {
  const version = useFreshnessVersion();
  useEffect(() => {
    if (items) freshReports.set(tile, { items });
  }, [tile, items]);
  return useMemo(
    () => (items ? freshCount(items, loadSeen()[tile], Date.now()) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, tile, version],
  );
}

/** 0→target tick over ~400ms; reduced motion jumps straight to the number. */
function useCountUp(target: number, ms = 400): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") { setValue(target); return; }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setValue(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function FreshChip({ count }: { count: number }) {
  const shown = useCountUp(count);
  return (
    <span className="fresh-chip inline-flex items-center rounded-full bg-brand/15 text-brand text-[10px] font-semibold px-1.5 py-0.5 tabular-nums" data-testid="fresh-chip">
      +{shown} new
    </span>
  );
}

function TileSkeleton() {
  return (
    <span className="block space-y-2 animate-pulse" aria-hidden="true">
      <span className="block h-3.5 w-4/5 rounded bg-muted/50" />
      <span className="block h-3 w-3/5 rounded bg-muted/40" />
    </span>
  );
}

/** The couldn't-reach body + its retry footer, shared by every tile. */
function unreachableBody(what: string): ReactNode {
  return <span className="block text-xs text-muted-foreground">Couldn't reach {what} — the content is there, we just couldn't ask.</span>;
}

function RetryFooter({ onRetry, testId }: { onRetry: () => void; testId: string }) {
  return (
    <div className="px-3 pb-3 sm:px-4">
      <Button variant="outline" size="sm" className="h-7 text-xs touch-target" onClick={onRetry} data-testid={testId}>
        Retry
      </Button>
    </div>
  );
}

// ── News hero ────────────────────────────────────────────────────────────────

function NewsHeroTile() {
  const [, setLocation] = useLocation();
  const feeds = useMemo(() => discoverNewsFeeds(), []);
  // Same keys and queryFn shape as the News page, so the react-query cache is
  // shared both directions — News opens instantly after Discover and Discover
  // paints instantly after News. Do NOT use the app's default queryFn: it
  // joins key segments with "/" and asks for /api/rss/https://… (wrong).
  const queries = useQueries({
    queries: feeds.map((f) => ({
      queryKey: ["/api/rss", f.url],
      queryFn: async () => {
        const res = await fetch(`/api/rss?url=${encodeURIComponent(f.url)}`);
        // Throw on HTTP errors, exactly like the News page's queryFn for this
        // SAME key. /api/rss returns 4xx/5xx with a JSON {error} body; caching
        // that as a 10-minute success would poison the shared cache — News
        // would mount onto fresh "success" data and render the source silently
        // empty with no retry for the whole staleTime window.
        if (!res.ok) throw new Error(`rss ${res.status}`);
        return res.json();
      },
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
    })),
  });

  const updKey = queries.map((q) => `${q.status}:${q.dataUpdatedAt}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const successes = useMemo(
    () => queries
      .map((q, i) => ({ q, f: feeds[i] }))
      .filter(({ q }) => q.isSuccess && Array.isArray((q.data as { items?: unknown[] })?.items)),
    [updKey, feeds],
  );
  const settled = queries.every((q) => !q.isPending);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveItems = useMemo(() => mergeFeedItems<HeroFeedItem>(
    successes.map(({ q, f }) => {
      const data = q.data as { title?: string; image?: string; link?: string; items: HeroFeedItem[] };
      return {
        source: { url: f.url, name: f.name || data.title, feedImage: f.feedImage || data.image, siteUrl: f.siteUrl || data.link },
        items: data.items,
      };
    }),
  ), [updKey]);

  // The read ledger decides which story is "top": newest UNREAD wins, so the
  // hero moves on as you read — without this page ever writing to the ledger.
  const ledger = useMemo(() => loadRssReadLedger(), []);
  const isRead = useCallback((item: HeroFeedItem) => ledger.has(rssItemKey(item)), [ledger]);

  // Remembered front page (localStorage) — instant content while the live
  // queries run, and an honest fallback when every one of them fails. It only
  // ever shows CONTENT: a snapshot can never justify "nothing new", because it
  // proves nothing about now.
  const edition = useMemo(() => loadEdition(), []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const unread = useMemo(() => {
    if (successes.length === 0) return 0;
    try {
      const hidden = loadHiddenDefaults();
      const savedFeeds = [...DEFAULT_FEEDS.filter((f) => !hidden.has(f.url)), ...loadCustomFeeds()];
      const prefs = loadNewsAlertPrefs();
      // Identical recipe AND identical input to useNewsUnread
      // (hooks/use-news-unread.ts): the WHOLE ["/api/rss"] query cache, not
      // just this tile's own feeds — after a News visit the cache holds more
      // feeds than the hero queries, and counting only ours would show a
      // smaller number here than on the nav badge. Computed inline (not via
      // the hook) because the hook recomputes on mount/focus/90s and would
      // miss our own queries resolving just after mount; updKey retriggers us.
      const cached = queryClient
        .getQueriesData<{ items?: RssCachedItemLite[] }>({ queryKey: ["/api/rss"] })
        .map(([key, data]) => ({ url: typeof key[1] === "string" ? key[1] : undefined, items: data?.items }));
      return computePriorityNewsUnread(
        cached,
        savedFeeds,
        loadRssReadLedger(),
        Date.now(),
        { mutedSources: prefs.mutedSources, mutedKeywords: prefs.mutedKeywords, onlyPresets: prefs.onlyPresets, onlyCreators: prefs.onlyCreators },
      ).count;
    } catch { return 0; }
  }, [updKey]);

  // The hero must respect the user's News mutes — the unread chip already does
  // (computePriorityNewsUnread takes the same prefs), but the headline itself
  // was picked over ALL items, so a muted source or keyword could still be the
  // face of the tile. One predicate, applied before pickHero on both paths.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const notMuted = useMemo(() => {
    const prefs = loadNewsAlertPrefs();
    const sources = new Set(prefs.mutedSources);
    const keywords = prefs.mutedKeywords.map((k) => k.toLowerCase()).filter(Boolean);
    return (m: MergedItem<HeroFeedItem>) => {
      if (m.source.url && sources.has(m.source.url)) return false;
      const hay = `${m.item.title ?? ""} ${m.item.description ?? ""}`.toLowerCase();
      return !keywords.some((k) => hay.includes(k));
    };
  }, [updKey]);

  const live = successes.length > 0;
  const hero: MergedItem<HeroFeedItem> | null = live
    ? pickHero(liveItems.filter(notMuted), isRead)
    : (edition.length > 0 ? pickHero((edition as MergedItem<HeroFeedItem>[]).filter(notMuted), isRead) : null);
  // Zero configured feeds makes `settled` vacuously true — without this guard
  // a user who hid every front-page source got "Couldn't reach the news
  // sources" and a Retry that retries nothing (the dead-control shape).
  const noFeeds = feeds.length === 0;
  const allFailed = settled && !live && !noFeeds;
  const retryAll = () => queries.forEach((q) => q.refetch());

  const item = hero?.item;
  const img = item?.thumbnail || hero?.source.feedImage;
  const dek = item?.description ? stripHtml(item.description).slice(0, 180) : "";
  const [heroImgBroken, setHeroImgBroken] = useState(false);
  useEffect(() => { setHeroImgBroken(false); }, [img]);

  // The whole tile opens /news (owner call, 2026-08-18, superseding the
  // story-door pass): the story teaser is display-only, and the read-mark
  // happens where the read happens — on the News page's own story tap. The
  // bento's never-mark-passively rule is untouched.

  return (
    <Card className="glass-card overflow-hidden md:col-span-2 md:row-span-3 flex flex-col">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setLocation("/news")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLocation("/news"); } }}
        className={`block w-full flex-1 text-left cursor-pointer ${FOCUS_RING}`}
        data-testid="tile-news"
        aria-label="Open News"
      >
        {item && img && !heroImgBroken && (
          <span
            className="block w-full aspect-[16/9] overflow-hidden bg-muted/30"
            data-testid="news-tile-story-image"
          >
            <img
              src={`/api/rss/image-proxy?url=${encodeURIComponent(img)}`}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
              // State, not an imperative style.display="none": the old version
              // set display:none on the wrapper, and because React reuses this
              // DOM node when the hero item changes (same position, no key), the
              // inline style was never cleared — so ONE broken thumbnail blanked
              // the image for every hero after it. `heroImgBroken` resets on img.
              onError={() => setHeroImgBroken(true)}
            />
          </span>
        )}
        <span className="block p-3 sm:p-4">
          <span className="flex items-center gap-2 mb-2">
            <Newspaper className="w-4 h-4 text-brand/70 shrink-0" />
            <span className="text-sm font-semibold">News</span>
            {unread > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand text-white text-[10px] font-semibold tabular-nums" data-testid="news-tile-unread">
                {unread}
              </span>
            )}
            <ChevronRight className="w-4 h-4 ml-auto shrink-0 text-muted-foreground/40" />
          </span>
          {item ? (
            <>
              <span className="block" data-testid="news-tile-story">
                <span className="text-base sm:text-lg font-semibold leading-snug line-clamp-3" data-testid="news-hero-title">
                  {item.title}
                </span>
                <span className="block mt-1 text-xs text-muted-foreground">
                  {hero?.source.name}
                  {item.pubDate && (() => {
                    const d = new Date(item.pubDate);
                    return isNaN(d.getTime()) ? null : <> · {formatDistanceToNow(d, { addSuffix: true })}</>;
                  })()}
                </span>
              </span>
              {/* Two spans on purpose: the OUTER owns responsive visibility
                  (hidden/md:block), the INNER owns the clamp (line-clamp sets
                  display:-webkit-box). Putting both on one element is the exact
                  block-vs-webkit-box collision that made every clamp here inert. */}
              {dek && <span className="mt-2 hidden md:block"><span className="text-sm text-muted-foreground/80 line-clamp-3">{dek}</span></span>}
              {allFailed && (
                <span className="block mt-2 text-[11px] text-muted-foreground/70" data-testid="news-hero-stale">
                  Couldn't refresh — showing the last front page we saw.
                </span>
              )}
            </>
          ) : noFeeds ? (
            <span className="block text-xs text-muted-foreground">All front-page sources are hidden — open News to pick some.</span>
          ) : allFailed ? (
            unreachableBody("the news sources")
          ) : !settled ? (
            <TileSkeleton />
          ) : (
            // Someone answered and pickHero still found nothing to show.
            <span className="block text-xs text-muted-foreground">You're caught up.</span>
          )}
        </span>
      </div>
      {allFailed && <RetryFooter onRetry={retryAll} testId="button-retry-news" />}
    </Card>
  );
}

// ── Feed teaser ──────────────────────────────────────────────────────────────

function FeedTile() {
  const [, setLocation] = useLocation();
  const { pubkey, follows } = useNostrAuth();
  const { flaggedPubkeys, wotEnabled } = useGrapeRankScores();
  // HOLD until the shield is known, exactly as the people strip does: a WoT
  // viewer's teaser must be floored against flaggedPubkeys, and fetching
  // before it loads would preview a shield-hidden author, then re-filter —
  // the filter-after-render the plan forbids. Guests/WoT-off have no shield.
  const shieldReady = !(pubkey && wotEnabled && !flaggedPubkeys);
  const [teaser, setTeaser] = useState<Reached<Event[]> | null>(null);
  // Sequence-guarded: load() can be re-fired (Retry) while a previous fetch is
  // still in flight, and whichever promise resolved LAST would win the state —
  // including a stale one. The counter also covers unmount (cleanup bumps it),
  // so a late resolution can't setState on a dead tile.
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    setTeaser(null);
    fetchFeedTeaser(flaggedPubkeys ?? new Set(), follows ?? [])
      .then((r) => { if (seq.current === id) setTeaser(r); })
      .catch(() => { if (seq.current === id) setTeaser({ data: [], reached: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaggedPubkeys, follows]);
  // Refetch once the shield lands (the memo keys on shield readiness, so this
  // gets a freshly-floored pick rather than the pre-shield one).
  useEffect(() => { if (shieldReady) load(); return () => { seq.current++; }; }, [load, shieldReady]);

  const state = shieldReady ? resolveTile(teaser) : resolveTile<Event[]>(null);
  const posts = state.status === "ready" && state.data ? state.data : [];
  // Names/avatars for the rows — the relay fallback path doesn't volunteer
  // kind-0s for everyone; a cached fetch fills them in and re-render follows.
  useEffect(() => {
    const missing = posts.filter((p) => !authorAvatarFor(p.pubkey)).map((p) => p.pubkey);
    if (missing.length > 0) fetchProfilesCached(missing);
  }, [posts]);
  const freshItems = useMemo<FreshItem[] | null>(
    () => (posts.length > 0 ? posts.map((p) => ({ id: p.id, timeMs: p.created_at * 1000 })) : null),
    [posts],
  );
  const fresh = useTileFresh("feed", freshItems);

  return (
    <TileShell
      icon={TrendingUp}
      label="Feed"
      chip={fresh > 0 ? <FreshChip count={fresh} /> : undefined}
      fresh={fresh > 0}
      onOpen={() => { stampReported("feed"); setLocation("/"); }}
      testId="tile-feed"
      footer={state.status === "unreachable" ? <RetryFooter onRetry={load} testId="button-retry-feed" /> : undefined}
    >
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "ready" && posts.length > 0 && (
        // Three vetted posts, not one over empty space — same ranked pipeline,
        // more of its output. Rows, hairline-separated, faces first.
        <span className="block divide-y divide-border/30 dark:divide-white/[0.05]" data-testid="feed-tile-rows">
          {posts.map((p) => {
            const avatar = authorAvatarFor(p.pubkey);
            const name = authorNameFor(p.pubkey);
            return (
              <span key={p.id} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                <span className="w-[18px] h-[18px] rounded-full overflow-hidden bg-brand/15 shrink-0 flex items-center justify-center">
                  {avatar ? (
                    <img src={avatar} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <span className="text-[8px] font-bold text-brand">{name.slice(0, 1).toUpperCase()}</span>
                  )}
                </span>
                <span className="text-[11px] font-medium text-foreground/90 shrink-0 max-w-[88px] truncate">{name}</span>
                <span className="text-[11px] text-muted-foreground truncate flex-1" data-testid="feed-tile-snippet">
                  {feedSnippet(p.content) || "Shared media"}
                </span>
              </span>
            );
          })}
        </span>
      )}
      {(state.status === "empty" || (state.status === "ready" && posts.length === 0)) && (
        <span className="block text-xs text-muted-foreground">Quiet right now — tap to look around.</span>
      )}
      {state.status === "unreachable" && unreachableBody("the network")}
    </TileShell>
  );
}

// ── Communities ──────────────────────────────────────────────────────────────

function CommunitiesTile() {
  const [, setLocation] = useLocation();
  const [joined, setJoined] = useState<OutpostRelay[]>(() => getOutpostRelays());
  useEffect(() => {
    const sync = () => setJoined(getOutpostRelays());
    window.addEventListener("outpost-relays-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("outpost-relays-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const hasJoined = joined.length > 0;
  const urlsKey = joined.map((r) => r.url).join(",");

  // Joined path: the pulse of YOUR communities.
  const [pulse, setPulse] = useState<Reached<CommunityPulse | null> | null>(null);
  // Same sequence guard as FeedTile — here the re-fire is real and routine:
  // joining/leaving a community changes urlsKey and re-runs the effect while
  // the previous pulse may still be mid-flight over the OLD relay set.
  const pulseSeq = useRef(0);
  const loadPulse = useCallback(() => {
    const id = ++pulseSeq.current;
    setPulse(null);
    fetchCommunityPulse(urlsKey ? urlsKey.split(",") : [], RECENT_ACTIVITY_WINDOW_MS)
      .then((r) => { if (pulseSeq.current === id) setPulse(r); })
      .catch(() => { if (pulseSeq.current === id) setPulse({ data: null, reached: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);
  useEffect(() => { if (hasJoined) loadPulse(); return () => { pulseSeq.current++; }; }, [hasJoined, loadPulse]);

  // Guest path: the public directory. Discovery is a one-shot shared store;
  // `active` only when this tile actually needs it, so joined users never pay
  // for a NIP-66 sweep they won't see.
  const dir = useOutpostDirectory(!hasJoined);
  const guestMatches = useMemo(
    () => (hasJoined ? [] : toDirMatches(filterDirectory(dir.relays, "", joinedUrlSet(joined)), 3)),
    [hasJoined, dir.relays, joined],
  );
  const [dirReached, setDirReached] = useState<boolean | null>(null);
  useEffect(() => {
    if (hasJoined || dir.loading || dir.relays.length > 0) return;
    let cancelled = false;
    canReachAny(NIP_66_MONITOR_RELAYS).then((ok) => { if (!cancelled) setDirReached(ok); });
    return () => { cancelled = true; };
  }, [hasJoined, dir.loading, dir.relays.length]);

  const newestName = (p: CommunityPulse): string | null => {
    if (!p.newest) return null;
    const rec = joined.find((r) => normalizeUrl(r.url) === normalizeUrl(p.newest!.url));
    const meta = getOutpostMeta(p.newest.url);
    try {
      return meta.name || rec?.label || new URL(p.newest.url.replace(/^ws/, "http")).hostname;
    } catch { return meta.name || rec?.label || p.newest.url; }
  };

  let body: ReactNode;
  let footer: ReactNode;
  if (hasJoined) {
    const state = resolveTile(pulse);
    if (state.status === "loading") body = <TileSkeleton />;
    else if (state.status === "unreachable") {
      body = unreachableBody("your communities");
      footer = <RetryFooter onRetry={loadPulse} testId="button-retry-communities" />;
    } else if (state.status === "ready" && state.data) {
      const p = state.data;
      const name = newestName(p);
      body = (
        <>
          {/* Faces first: the joined communities' own icons — a row of places,
              not a sentence about them. */}
          <span className="flex items-center gap-1.5 mb-1.5" data-testid="communities-tile-faces">
            {joined.slice(0, 6).map((r) => {
              const meta = getOutpostMeta(r.url);
              const label = meta.name || r.label || r.url;
              return (
                <span key={r.url} className="w-6 h-6 rounded-md overflow-hidden bg-brand/15 ring-1 ring-border/40 shrink-0 flex items-center justify-center" title={label}>
                  {meta.icon ? (
                    <img src={meta.icon} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <span className="text-[9px] font-bold text-brand">{label.slice(0, 1).toUpperCase()}</span>
                  )}
                </span>
              );
            })}
            {joined.length > 6 && (
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">+{joined.length - 6}</span>
            )}
          </span>
          {p.newest && name ? (
            <span className="block text-xs font-medium text-foreground/90" data-testid="communities-tile-newest">
              {name} · active {formatDistanceToNow(new Date(p.newest.at), { addSuffix: true })}
            </span>
          ) : (
            <span className="block text-xs font-medium text-foreground/90">Quiet this week</span>
          )}
          <span className="block text-xs text-muted-foreground">
            {p.active} of {p.total} active this week
          </span>
        </>
      );
    } else {
      body = <span className="block text-xs text-muted-foreground">Quiet this week.</span>;
    }
  } else if (dir.loading) {
    body = <TileSkeleton />;
  } else if (dir.relays.length > 0) {
    body = (
      <>
        <span className="block text-xs font-medium text-foreground/90" data-testid="communities-tile-count">
          {dir.relays.length} communities in the directory
        </span>
        {guestMatches.length > 0 && (
          // Rows with faces, not a comma list: each suggestion is a place.
          <span className="block divide-y divide-border/30 dark:divide-white/[0.05] mt-1" data-testid="communities-tile-suggestions">
            {guestMatches.map((m) => (
              <span key={m.url} className="flex items-center gap-2 py-1 first:pt-0 last:pb-0">
                <span className="w-5 h-5 rounded-md overflow-hidden bg-brand/15 ring-1 ring-border/40 shrink-0 flex items-center justify-center">
                  {m.icon ? (
                    <img src={m.icon} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <span className="text-[8px] font-bold text-brand">{m.name.slice(0, 1).toUpperCase()}</span>
                  )}
                </span>
                <span className="text-[11px] text-foreground/85 truncate flex-1">{m.name}</span>
                {typeof m.activeUserCount === "number" && m.activeUserCount > 0 && (
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{m.activeUserCount} active</span>
                )}
              </span>
            ))}
          </span>
        )}
      </>
    );
  } else if (dirReached === false) {
    body = unreachableBody("the directory");
    footer = (
      <RetryFooter
        onRetry={() => { setDirReached(null); restartDiscovery(); }}
        testId="button-retry-communities"
      />
    );
  } else if (dirReached === null) {
    // Discovery settled empty but the canReachAny probe hasn't answered yet
    // (it only STARTS in an effect after this render). null is "still asking"
    // — collapsing it into the empty claim below is the exact three-states-
    // into-two fold this page exists to avoid.
    body = <TileSkeleton />;
  } else {
    // The monitors answered and the directory is genuinely empty right now.
    body = <span className="block text-xs text-muted-foreground">Nothing to show yet.</span>;
  }

  return (
    <TileShell icon={Users} label="Communities" onOpen={() => setLocation("/outposts")} testId="tile-communities" footer={footer}>
      {body}
    </TileShell>
  );
}

// ── Articles ─────────────────────────────────────────────────────────────────

function ArticlesTile() {
  const [, setLocation] = useLocation();
  const { follows } = useNostrAuth();
  const [article, setArticle] = useState<Reached<ArticleData[]> | null>(null);
  const [, bumpProfiles] = useState(0);
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    setArticle(null);
    fetchNewestArticle(follows ?? [])
      .then(async (r) => {
        if (seq.current !== id) return;
        setArticle(r);
        if (r.data && r.data.length > 0) {
          // Resolve the authors' names after the fact; re-render when they land.
          try { await fetchProfilesCached(r.data.map((a) => a.event.pubkey)); } catch { /* names stay npub */ }
          if (seq.current === id) bumpProfiles((n) => n + 1);
        }
      })
      .catch(() => { if (seq.current === id) setArticle({ data: [], reached: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follows]);
  useEffect(() => { load(); return () => { seq.current++; }; }, [load]);

  const state = resolveTile(article);
  const articles = state.status === "ready" && state.data ? state.data : [];
  const freshItems = useMemo<FreshItem[] | null>(
    () => (articles.length > 0 ? articles.map((a) => ({ id: a.event.id, timeMs: a.publishedAt * 1000 })) : null),
    [articles],
  );
  const fresh = useTileFresh("articles", freshItems);

  return (
    <TileShell
      icon={BookOpen}
      label="Articles"
      chip={fresh > 0 ? <FreshChip count={fresh} /> : undefined}
      fresh={fresh > 0}
      onOpen={() => { stampReported("articles"); setLocation("/articles"); }}
      testId="tile-articles"
      footer={state.status === "unreachable" ? <RetryFooter onRetry={load} testId="button-retry-articles" /> : undefined}
    >
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "ready" && articles.length > 0 && (
        // Two editions with cover thumbnails — the shelf shows its books.
        <span className="block divide-y divide-border/30 dark:divide-white/[0.05]" data-testid="articles-tile-rows">
          {articles.map((a) => (
            <span key={a.event.id} className="flex items-center gap-2.5 py-1.5 first:pt-0 last:pb-0">
              {a.image && (
                <span className="w-9 h-9 rounded-md overflow-hidden bg-muted/30 shrink-0">
                  <img src={a.image} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-medium text-foreground/90 truncate" data-testid="articles-tile-title">{a.title}</span>
                <span className="block text-[10.5px] text-muted-foreground truncate">
                  {authorNameFor(a.event.pubkey)} · {formatDistanceToNow(new Date(a.publishedAt * 1000), { addSuffix: true })}
                </span>
              </span>
            </span>
          ))}
        </span>
      )}
      {(state.status === "empty" || (state.status === "ready" && articles.length === 0)) && (
        <span className="block text-xs text-muted-foreground">Nothing new — tap to browse.</span>
      )}
      {state.status === "unreachable" && unreachableBody("the article relays")}
    </TileShell>
  );
}

// ── Universal search bar ─────────────────────────────────────────────────────

function UniversalBar() {
  const [, setLocation] = useLocation();
  const { pubkey } = useNostrAuth();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const raw = query.trim();
  const { joinedMatches, dirMatches, loading, looksLikeUrl, urlToOpen, groupInvite } =
    useOutpostDirectorySearch(query, { active: focused || !!raw });
  const profileTarget = useMemo(() => detectProfileTarget(raw), [raw]);
  // The placeholder promised people; until this, the dropdown only searched
  // communities and the promise was only kept for a pasted npub. Shared hook
  // (same machinery as Search's People tab + the launcher): instant cached
  // rows, one debounced remote pass, stale-cancel — `enabled` tracks the
  // dropdown so a dismissed bar stops firing relay searches per keystroke.
  const { results: peopleResults, loading: peopleLoading } =
    usePeopleTypeahead(query, focused && !!raw, 4);

  const go = (path: string) => {
    setQuery("");
    setFocused(false);
    setLocation(path);
  };
  // A community DETAIL page is behind the account gate (joining needs keys),
  // so for a guest that link is a locked door: the route guard bounces it to
  // the signup funnel. Send guests to the hub seeded with their query instead
  // — same information, honest destination. Signed-in goes straight in.
  const goCommunity = (url: string, name: string) =>
    go(pubkey ? `/outposts/${encodeURIComponent(url)}` : `/outposts?q=${encodeURIComponent(name)}`);
  const openPerson = (pk: string) => {
    try { go(`/profile/${nip19.npubEncode(pk)}`); } catch { /* malformed pubkey — ignore */ }
  };
  // Enter priority mirrors the Outposts command bar: an invite is checked
  // FIRST so the looks-like-a-URL branch can't swallow it; a person comes next
  // (Outposts has no people lane — here "find a person" is half the point of a
  // universal bar); then link, then community matches, then plain search.
  const submit = () => {
    if (!raw) return;
    if (groupInvite) return go(groupInvite.path);
    if (profileTarget) return go(`/profile/${profileTarget}`);
    if (looksLikeUrl) return goCommunity(urlToOpen, raw);
    // Enter follows the DROPDOWN'S VISUAL ORDER — people rows render above
    // community rows, so Enter must pick what the eye reads first. (The first
    // draft preferred a joined community over a person and the review caught
    // the mismatch: Enter activated a row that was visibly ranked second.)
    if (peopleResults[0]) return openPerson(peopleResults[0].pubkey);
    if (joinedMatches[0]) return goCommunity(joinedMatches[0].url, joinedMatches[0].name);
    if (dirMatches[0]) return goCommunity(dirMatches[0].url, dirMatches[0].name);
    return go(`/search?q=${encodeURIComponent(raw)}`);
  };

  const rows = useMemo(
    () => [...joinedMatches, ...dirMatches].slice(0, peopleResults.length > 0 ? 3 : 5),
    [joinedMatches, dirMatches, peopleResults.length],
  );
  const open = focused && !!raw;

  return (
    <div className="relative" data-testid="discover-command-bar">
      <SearchPill
        ref={inputRef}
        placeholder="Search people, communities — or paste any link…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setQuery(""); inputRef.current?.blur(); return; }
          if (e.key === "Enter") { e.preventDefault(); submit(); }
        }}
        enterKeyHint="go"
        data-testid="input-discover-universal"
      />
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-border/40 bg-background/95 backdrop-blur-md shadow-lg overflow-hidden"
          // Without this, the input's blur fires before a row's onClick and the
          // dropdown vanishes out from under the tap (Outposts.tsx precedent).
          onMouseDown={(e) => e.preventDefault()}
          data-testid="discover-search-results"
        >
          {groupInvite && (
            <ResultRow label="Join this group chat" hint="Invite link" onPick={() => go(groupInvite.path)} testId="row-discover-invite" />
          )}
          {profileTarget && (
            <ResultRow label="Open profile" hint={`${profileTarget.slice(0, 16)}…`} onPick={() => go(`/profile/${profileTarget}`)} testId="row-discover-profile" />
          )}
          {!groupInvite && !profileTarget && looksLikeUrl && (
            <ResultRow label="Open as community" hint={urlToOpen} onPick={() => goCommunity(urlToOpen, raw)} testId="row-discover-url" />
          )}
          {/* Guests keep the LINK flows above (a pasted invite/profile/community
              link is the share path and must always resolve) — but name-search
              is exploration, and exploration is for members. One calm row, not
              a wall card in a dropdown. */}
          {!pubkey && (
            <ResultRow
              label="Search is for members — get started"
              hint="Takes a minute"
              onPick={() => go("/login")}
              testId="row-discover-guest-gate"
            />
          )}
          {pubkey && peopleResults.map((ev) => {
            const name = getDisplayName(ev);
            const nip05 = getProfileContent(ev)?.nip05;
            const avatar = getAvatarUrl(ev);
            return (
              <button
                key={ev.pubkey}
                type="button"
                onClick={() => openPerson(ev.pubkey)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors text-left cursor-pointer min-h-[44px] ${FOCUS_RING}`}
                data-testid={`row-discover-person-${ev.pubkey.slice(0, 8)}`}
              >
                <Avatar className="w-7 h-7 shrink-0 border border-border/40">
                  {avatar && <AvatarImage src={avatar} alt="" />}
                  <AvatarFallback className="text-[10px] bg-muted/50">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium truncate">{name}</span>
                {nip05 && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/60 truncate max-w-[45%]">{nip05}</span>}
              </button>
            );
          })}
          {pubkey && peopleLoading && peopleResults.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground/60">Looking for people…</div>
          )}
          {pubkey && rows.map((m) => (
            <ResultRow
              key={m.url}
              label={m.name}
              hint={"activeUserCount" in m && m.activeUserCount ? `~${m.activeUserCount} active` : "Community"}
              onPick={() => goCommunity(m.url, m.name)}
              testId={`row-discover-community-${m.url.slice(6, 20)}`}
              // Show the relay's own NIP-11 icon when it has one, exactly like
              // the people rows show avatars; fall back to its initials.
              avatar={{ src: m.icon, fallback: m.name.replace(/^wss?:\/\//, "").slice(0, 2).toUpperCase() }}
            />
          ))}
          {pubkey && loading && rows.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-muted-foreground/60">Searching the directory…</div>
          )}
          {pubkey && (
            <ResultRow label={`Search everything for "${raw}"`} hint="Posts, people, media" onPick={() => go(`/search?q=${encodeURIComponent(raw)}`)} testId="row-discover-search-all" />
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ label, hint, onPick, testId, avatar }: {
  label: string;
  hint?: string;
  onPick: () => void;
  testId: string;
  /** A leading icon — the relay's NIP-11 image for community rows, so they read
   *  like the people rows above them. `src` null ⇒ initials fallback. */
  avatar?: { src: string | null; fallback: string };
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full flex ${avatar ? "items-center" : "items-baseline"} gap-2.5 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left cursor-pointer ${FOCUS_RING}`}
      data-testid={testId}
    >
      {avatar && (
        // rounded-md, not full — a relay/community reads as an app icon, the
        // people rows read as round avatars, so the two are told apart at a glance.
        <Avatar className="w-7 h-7 shrink-0 rounded-md border border-border/40">
          {avatar.src && <AvatarImage src={avatar.src} alt="" className="rounded-md" />}
          <AvatarFallback className="rounded-md text-[10px] bg-muted/50">{avatar.fallback}</AvatarFallback>
        </Avatar>
      )}
      <span className="text-sm font-medium truncate">{label}</span>
      {hint && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/60 truncate max-w-[45%]">{hint}</span>}
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────


// ── Live ─────────────────────────────────────────────────────────────────────

/**
 * The bento's door to live streams (owner request, 2026-08-15 — browsing live
 * previously ROUTED ONLY through Search's Live tab). The body makes POSITIVE
 * claims only: it names live counts when the live-status poller has them, and
 * says "see who's broadcasting" otherwise — never "no one is live", because
 * this context can't distinguish a quiet network from unreachable relays
 * (positive-tag rule). The door itself is always valid: /search?tab=live.
 */
function LiveTile() {
  const [, setLocation] = useLocation();
  const { follows } = useNostrAuth();
  const { livePubkeys, getLiveStream } = useLiveStatus();

  const followsSet = useMemo(() => new Set(follows ?? []), [follows]);
  const networkLive = useMemo(
    () => Array.from(livePubkeys).filter((pk) => followsSet.has(pk)),
    [livePubkeys, followsSet],
  );
  const firstNetwork = networkLive[0] ? getLiveStream(networkLive[0]) : undefined;

  const anyLive = livePubkeys.size > 0;
  // On-air whenever ANYONE is live, not just followed hosts — the facepile
  // below shows real faces either way, so the chip's claim is always backed.
  const chip = anyLive ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-red-500" data-testid="live-tile-chip">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
      Live
    </span>
  ) : undefined;

  // The live-host facepile (owner call, 2026-08-18): the tile's whitespace
  // fills with the people actually streaming — followed hosts first, capped.
  // Real content only, per the bento's own rules; profiles are warmed through
  // the shared cache and the tick re-renders once faces arrive.
  const hostPks = useMemo(() => {
    const rest = Array.from(livePubkeys).filter((pk) => !followsSet.has(pk));
    return [...networkLive, ...rest].slice(0, 6);
  }, [livePubkeys, networkLive, followsSet]);
  const [, setProfileTick] = useState(0);
  useEffect(() => {
    if (hostPks.length === 0) return;
    // fetchProfilesCached is fire-and-forget (batched) — poll the store a few
    // times so faces pop in as kind-0s land (PeopleToFollowStrip's pattern),
    // then stop; missing profiles just keep their initials fallback.
    try { fetchProfilesCached(hostPks); } catch { /* fallback initials */ }
    let ticks = 0;
    const timer = setInterval(() => {
      setProfileTick((t) => t + 1);
      if (++ticks >= 5) clearInterval(timer);
    }, 900);
    return () => clearInterval(timer);
  }, [hostPks]);

  return (
    <TileShell icon={Radio} label="Live" chip={chip} onOpen={() => setLocation("/live")} testId="tile-live">
      {networkLive.length > 0 ? (
        <>
          <span className="block text-xs font-medium text-foreground/90" data-testid="live-tile-host">
            {authorNameFor(networkLive[0])}
            {networkLive.length > 1 && <span className="text-muted-foreground"> +{networkLive.length - 1} more you follow</span>}
          </span>
          <span className="block text-xs text-muted-foreground line-clamp-1">
            {firstNetwork?.title || "Streaming now"}
          </span>
        </>
      ) : anyLive ? (
        <span className="block text-xs text-muted-foreground" data-testid="live-tile-count">
          {livePubkeys.size} {livePubkeys.size === 1 ? "stream" : "streams"} on right now
        </span>
      ) : (
        <span className="block text-xs text-muted-foreground">See who's broadcasting.</span>
      )}
      {anyLive && hostPks.length > 0 && (
        <span className="mt-2 flex items-center" data-testid="live-tile-facepile">
          {hostPks.map((pk, i) => {
            const ev = eventStore.getEvent({ kind: 0, pubkey: pk, identifier: "" });
            return (
              <Avatar key={pk} className={`w-7 h-7 border-2 border-card bg-card ${i > 0 ? "-ml-2" : ""}`}>
                <AvatarImage src={getAvatarUrl(ev ?? undefined)} alt="" />
                <AvatarFallback className="text-[9px] bg-muted text-muted-foreground">
                  {authorNameFor(pk).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            );
          })}
          {livePubkeys.size > hostPks.length && (
            <span className="ml-1.5 text-[10px] text-muted-foreground" data-testid="live-tile-more">
              +{livePubkeys.size - hostPks.length}
            </span>
          )}
        </span>
      )}
    </TileShell>
  );
}


// ── Podcasts ─────────────────────────────────────────────────────────────────

function PodcastsTile() {
  const [, setLocation] = useLocation();
  const { feeds, isLoading, isError } = usePodcastTrending(null, 5, true);
  const top = feeds[0];
  const freshItems = useMemo<FreshItem[] | null>(
    () => (feeds.length > 0
      ? feeds.map((f) => ({ id: `${f.id}:${f.newestItemPubdate ?? 0}`, timeMs: f.newestItemPubdate ? f.newestItemPubdate * 1000 : undefined }))
      : null),
    [feeds],
  );
  const freshN = useTileFresh("podcasts", freshItems);
  const freshness = top?.newestItemPubdate
    ? fdn(new Date(top.newestItemPubdate * 1000), { addSuffix: true })
    : null;
  return (
    <TileShell
      icon={Headphones}
      label="Audio"
      chip={freshN > 0 && !isError ? <FreshChip count={freshN} /> : undefined}
      fresh={freshN > 0 && !isError}
      onOpen={() => { stampReported("podcasts"); setLocation("/search?tab=media&type=audio"); }}
      testId="tile-audio"
      footer={isError ? <RetryFooter onRetry={() => queryClient.invalidateQueries({ queryKey: ["/api/podcastindex/trending"] })} testId="button-retry-audio" /> : undefined}
    >
      {isLoading && <TileSkeleton />}
      {!isLoading && !isError && top && (
        <span className="flex items-center gap-2.5">
          {top.image && <img src={top.image} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" loading="lazy" />}
          <span className="min-w-0">
            <span className="block text-xs font-medium text-foreground/90 truncate" data-testid="podcasts-tile-title">{top.title}</span>
            <span className="block text-xs text-muted-foreground truncate">
              {freshness ? `New episode ${freshness}` : "Trending now"}
            </span>
          </span>
        </span>
      )}
      {!isLoading && !isError && !top && <span className="block text-xs text-muted-foreground">Browse trending shows.</span>}
      {isError && unreachableBody("the podcast index")}
    </TileShell>
  );
}

// ── Events ───────────────────────────────────────────────────────────────────

function EventsTile() {
  const [, setLocation] = useLocation();
  const [teaser, setTeaser] = useState<Reached<CalendarEventData | null> | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    setTeaser(null);
    fetchNextCalendarEvent()
      .then((r) => { if (seq.current === id) setTeaser(r); })
      .catch(() => { if (seq.current === id) setTeaser({ data: null, reached: false }); });
  }, []);
  useEffect(() => { load(); return () => { seq.current++; }; }, [load]);

  const state = resolveTile(teaser);
  const next = state.status === "ready" ? state.data : null;
  const freshItems = useMemo<FreshItem[] | null>(
    // Id-gate only: an upcoming event stays new until seen, however long ago
    // it was published.
    () => (next ? [{ id: next.id }] : null),
    [next],
  );
  const freshN = useTileFresh("events", freshItems);
  const startSecs = next?.startTime ?? (next?.startDate ? Math.floor(Date.parse(`${next.startDate}T00:00:00`) / 1000) : undefined);
  const when = startSecs !== undefined
    ? (startSecs <= Math.floor(Date.now() / 1000) ? "Happening now" : fdn(new Date(startSecs * 1000), { addSuffix: true }))
    : null;

  return (
    <TileShell
      icon={Calendar}
      label="Events"
      chip={freshN > 0 ? <FreshChip count={freshN} /> : undefined}
      fresh={freshN > 0}
      onOpen={() => { stampReported("events"); setLocation("/search?tab=events"); }}
      testId="tile-events"
      footer={state.status === "unreachable" ? <RetryFooter onRetry={load} testId="button-retry-events" /> : undefined}
    >
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "ready" && next && (
        <>
          <span className="block text-xs font-medium text-foreground/90 truncate" data-testid="events-tile-title">{next.title}</span>
          <span className="block text-xs text-muted-foreground truncate">{when ?? "Upcoming"}</span>
        </>
      )}
      {state.status === "empty" && <span className="block text-xs text-muted-foreground">Nothing scheduled — plan something.</span>}
      {state.status === "unreachable" && unreachableBody("the calendar relays")}
    </TileShell>
  );
}

// ── Videos ───────────────────────────────────────────────────────────────────

function VideosTile() {
  const [, setLocation] = useLocation();
  const [teaser, setTeaser] = useState<Reached<VideoTeaser | null> | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    setTeaser(null);
    fetchVideoTeaser()
      .then((r) => { if (seq.current === id) setTeaser(r); })
      .catch(() => { if (seq.current === id) setTeaser({ data: null, reached: false }); });
  }, []);
  useEffect(() => { load(); return () => { seq.current++; }; }, [load]);

  const state = resolveTile(teaser);
  const video = state.status === "ready" ? state.data : null;
  const freshItems = useMemo<FreshItem[] | null>(
    () => (video ? [{ id: video.id, timeMs: video.timeMs }] : null),
    [video],
  );
  const freshN = useTileFresh("videos", freshItems);

  return (
    <TileShell
      icon={Clapperboard}
      label="Videos"
      chip={freshN > 0 ? <FreshChip count={freshN} /> : undefined}
      fresh={freshN > 0}
      onOpen={() => { stampReported("videos"); setLocation("/search?tab=media&type=videos"); }}
      testId="tile-videos"
      footer={state.status === "unreachable" ? <RetryFooter onRetry={load} testId="button-retry-videos" /> : undefined}
    >
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "ready" && video && (
        <span className="flex items-center gap-2.5">
          {video.poster && <img src={video.poster} alt="" className="w-16 h-10 rounded-md object-cover shrink-0" loading="lazy" />}
          <span className="block text-xs font-medium text-foreground/90 line-clamp-2 min-w-0" data-testid="videos-tile-title">{video.title}</span>
        </span>
      )}
      {state.status === "empty" && <span className="block text-xs text-muted-foreground">Quiet right now — tap to browse.</span>}
      {state.status === "unreachable" && unreachableBody("the video relays")}
    </TileShell>
  );
}

// ── Marketplace shelf ────────────────────────────────────────────────────────

/**
 * A commerce door that shows the goods (ImagesShelf precedent): up to six
 * product thumbnails with price chips, from NIP-99 listings across the
 * network (Conduit's relay leads). Tap → /marketplace.
 */
function MarketplaceShelfTile() {
  const [, setLocation] = useLocation();
  const [teaser, setTeaser] = useState<Reached<MarketTeaser[] | null> | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    setTeaser(null);
    fetchMarketShelf()
      .then((r) => { if (seq.current === id) setTeaser(r); })
      .catch(() => { if (seq.current === id) setTeaser({ data: null, reached: false }); });
  }, []);
  useEffect(() => { load(); return () => { seq.current++; }; }, [load]);

  const state = resolveTile(teaser);
  const items = state.status === "ready" ? state.data : null;
  const freshItems = useMemo<FreshItem[] | null>(
    () => (items && items.length > 0 ? items.map((i) => ({ id: i.id, timeMs: i.timeMs })) : null),
    [items],
  );
  const freshN = useTileFresh("market", freshItems);

  return (
    <TileShell
      icon={Tag}
      label="Marketplace"
      chip={freshN > 0 ? <FreshChip count={freshN} /> : undefined}
      fresh={freshN > 0}
      onOpen={() => { stampReported("market"); setLocation("/marketplace"); }}
      testId="tile-marketplace"
      footer={state.status === "unreachable" ? <RetryFooter onRetry={load} testId="button-retry-marketplace" /> : undefined}
    >
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "ready" && items && items.length > 0 && (
        <span
          className="grid grid-cols-3 sm:grid-cols-6 gap-px -mx-3 sm:-mx-4 -mb-3 sm:-mb-4 mt-1"
          data-testid="marketplace-shelf-strip"
        >
          {items.slice(0, 6).map((it) => (
            <span key={it.id} className="relative block aspect-square bg-muted/30 overflow-hidden" data-testid={`marketplace-shelf-thumb-${it.id.slice(0, 8)}`}>
              <img
                src={it.image}
                alt={it.title}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              {it.priceLine && (
                <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 py-0.5 text-[10px] font-medium text-white tabular-nums">
                  {it.priceLine}
                </span>
              )}
            </span>
          ))}
        </span>
      )}
      {state.status === "empty" && <span className="block text-xs text-muted-foreground">Quiet right now — tap to browse.</span>}
      {state.status === "unreachable" && unreachableBody("the marketplace relays")}
    </TileShell>
  );
}

// ── Images shelf ─────────────────────────────────────────────────────────────

/**
 * The Instagram-shaped door (owner request, 2026-08-18): a wide shelf of
 * actual thumbnails — last-24h images from kind-1 notes AND kind-20 picture
 * posts, one per author (pickImageShelf) — because an images door that shows
 * words instead of images undersells the room behind it. Same reach grammar
 * as every tile: skeleton → thumbnails / quiet / unreachable-with-retry.
 */
function ImagesShelfTile() {
  const [, setLocation] = useLocation();
  const { pubkey, follows } = useNostrAuth();
  const { flaggedPubkeys, wotEnabled } = useGrapeRankScores();
  // HOLD until the shield is known (FeedTile's exact pattern): thumbnails are
  // the highest-stakes teaser on the page, and fetching before the flagged
  // set loads would paint a shield-hidden author's image, then re-filter.
  const shieldReady = !(pubkey && wotEnabled && !flaggedPubkeys);
  const [teaser, setTeaser] = useState<Reached<ShelfImage[]> | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    setTeaser(null);
    fetchImagesTeaser(follows ?? [], flaggedPubkeys ?? new Set())
      .then((r) => { if (seq.current === id) setTeaser(r); })
      .catch(() => { if (seq.current === id) setTeaser({ data: [], reached: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follows, flaggedPubkeys]);
  useEffect(() => { if (shieldReady) load(); return () => { seq.current++; }; }, [load, shieldReady]);

  const state = shieldReady ? resolveTile(teaser) : resolveTile<ShelfImage[]>(null);
  const images = state.status === "ready" ? state.data : null;
  const freshItems = useMemo<FreshItem[] | null>(
    () => (images && images.length > 0 ? images.map((i) => ({ id: i.id, timeMs: i.timeMs })) : null),
    [images],
  );
  const freshN = useTileFresh("images", freshItems);

  return (
    <TileShell
      icon={ImageIcon}
      label="Images"
      chip={freshN > 0 ? <FreshChip count={freshN} /> : undefined}
      fresh={freshN > 0}
      onOpen={() => { stampReported("images"); setLocation("/search?tab=media&type=images"); }}
      testId="tile-images"
      footer={state.status === "unreachable" ? <RetryFooter onRetry={load} testId="button-retry-images" /> : undefined}
    >
      {state.status === "loading" && <TileSkeleton />}
      {state.status === "ready" && images && images.length > 0 && (
        // Full-bleed mosaic (owner call, 2026-08-18): the images ARE the tile
        // body, edge to edge — negative margins cancel TileShell's padding and
        // the Card's overflow-hidden clips the bottom corners. 3-up on mobile
        // (chunky squares), one 6-up row on sm+. Cells keep their aspect via
        // aspect-square + object-cover; a broken image leaves its cell on the
        // muted ground rather than tearing the grid.
        <span
          className="grid grid-cols-3 sm:grid-cols-6 gap-px -mx-3 sm:-mx-4 -mb-3 sm:-mb-4 mt-1"
          data-testid="images-shelf-strip"
        >
          {images.slice(0, 6).map((img) => (
            <span key={`${img.id}-${img.url}`} className="block aspect-square bg-muted/30 overflow-hidden" data-testid={`images-shelf-thumb-${img.id.slice(0, 8)}`}>
              <img
                src={img.url}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            </span>
          ))}
        </span>
      )}
      {(state.status === "empty" || (state.status === "ready" && images && images.length === 0)) && (
        <span className="block text-xs text-muted-foreground">Quiet right now — tap to browse.</span>
      )}
      {state.status === "unreachable" && unreachableBody("the image relays")}
    </TileShell>
  );
}

// ── Topics ───────────────────────────────────────────────────────────────────

/**
 * Additive strip (PeopleToFollowStrip precedent): renders NOTHING unless at
 * least two topics qualified — a trend needs distinct voices, and absence
 * claims nothing, so this surface carries no reach states.
 */
function TopicsStrip() {
  const [, setLocation] = useLocation();
  const { follows } = useNostrAuth();
  const [topics, setTopics] = useState<RankedTopic[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    fetchNetworkTopics(follows ?? [])
      .then((r) => { if (seq.current === id) setTopics(r); })
      .catch(() => {});
    return () => { seq.current++; };
  }, [follows]);

  // ↑ marks against the LAST visit's snapshot; the report also carries the
  // current list so leaving the page becomes the next visit's baseline.
  const risen = useMemo(() => markRising(topics, loadSeen().topics?.topics), [topics]);
  useEffect(() => {
    if (topics.length > 0) freshReports.set("topics", { items: topics.map((t) => ({ id: t.tag })), topics: risen });
  }, [topics, risen]);

  if (topics.length < 2) return null;
  return (
    <Card className="glass-card overflow-hidden">
      <div className="flex items-center gap-2 p-3 sm:p-4 flex-wrap" data-testid="strip-topics">
        <span className="flex items-center gap-2 mr-1">
          <Hash className="w-4 h-4 text-brand/70 shrink-0" />
          <span className="text-sm font-semibold whitespace-nowrap">Talking about</span>
        </span>
        {risen.map((t) => (
          <button
            key={t.tag}
            type="button"
            onClick={() => setLocation(`/search?tab=hashtags&q=${encodeURIComponent(`#${t.tag}`)}`)}
            className={`shrink-0 rounded-full border border-border/40 px-2.5 min-h-[32px] text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors ${FOCUS_RING}`}
            data-testid={`topic-chip-${t.tag}`}
          >
            #{t.tag}
            {t.rising && <span className="ml-0.5 text-brand" aria-label="rising" data-testid={`topic-rising-${t.tag}`}>↑</span>}
            <span className="ml-1 text-[10px] text-muted-foreground/60">{t.authors}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

export default function Discover() {
  useDocumentTitle("Discover");
  const { pubkey } = useNostrAuth();

  // Hard wall (owner decision, 2026-08-14): browse surfaces are membership —
  // the legacy-social model. Shared deep links (a post, an article, an
  // invite, a channel preview) are separate routes and stay open; this page
  // is pure exploration, so guests meet the wall outright, in place, with
  // the URL intact for the post-signup return.
  if (!pubkey) {
    return (
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 pb-24" data-testid="page-discover">
        <div className="max-w-2xl mx-auto pt-8">
          <GuestWall context="Discover is for members" />
        </div>
      </div>
    );
  }

  // The rubber band's stamp: on LEAVE (hide or route-away), everything the
  // tiles reported becomes the next visit's baseline. Never on mount — the
  // chips must survive the visit they are greeting.
  useEffect(() => {
    freshReports.clear();
    const onHide = () => { if (document.visibilityState === "hidden") stampReported(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stampReported();
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 pb-24 space-y-4" data-testid="page-discover">
      {/* No page title — the nav labels this tab (Outposts hub precedent). */}

      <UniversalBar />

      {/* One grid, both breakpoints: mobile stacks hero-then-tiles in DOM
          order; md+ places the hero left (2 cols, 3 rows) with the compact
          tiles filling the right column. No JS layout fork. */}
      <div className="discover-grid grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <NewsHeroTile />
        <FeedTile />
        <CommunitiesTile />
        <ArticlesTile />
        {/* Wide strip under the grid: a ticker-shaped door suits "live". */}
        <div className="md:col-span-3">
          <LiveTile />
        </div>
        {/* Second tile row (owner request, 2026-08-15): more worlds, same
            doors-with-reach-states grammar as row one. */}
        <PodcastsTile />
        <EventsTile />
        <VideosTile />
        {/* Wide strip closing row two (LiveTile precedent for row one): a
            shelf-shaped door suits images — it shows the pictures. */}
        <div className="md:col-span-3">
          <ImagesShelfTile />
        </div>
        {/* Commerce door, same shelf grammar: show the goods, price chips on. */}
        <div className="md:col-span-3">
          <MarketplaceShelfTile />
        </div>
        {/* Additive: renders nothing without two distinct-author topics. */}
        <div className="md:col-span-3 empty:hidden">
          <TopicsStrip />
        </div>
      </div>

      {/* Quiet, below the doors on purpose (plan round 2, #15): a fifth TILE
          would fight the grid; a strip is a bonus. Renders 4-6 cards or
          NOTHING — additive content claims nothing by being absent, which is
          why it carries no reach states (unlike the tiles, which are doors). */}
      <PeopleToFollowStrip />
    </div>
  );
}
