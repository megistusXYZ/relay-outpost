import { useState, useEffect, useMemo, useCallback, useRef, type ChangeEvent } from "react";
import { Link, useSearch, useLocation } from "wouter";
import type { Event as NostrEvent } from "nostr-tools";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageTabs } from "@/components/PageTabs";
import { searchPillClass } from "@/components/SearchPill";
import { FOCUS_RING } from "@/lib/a11y";
import { useBackClosable } from "@/hooks/use-back-closable";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { publishEvent } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { clientTags } from "@/lib/nostr-helpers";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";
import { formatDistanceToNow } from "date-fns";
import {
  buildComment,
  publishComment,
  enrichCommentMentions,
  subscribeDiscussion,
  applyDiscussionTrust,
  getCachedDiscussion,
  cacheDiscussion,
  mergeDiscussionEvents,
  resolveSharedPodcast,
} from "@/lib/external-comments";
import type { SharedPodcast } from "@/lib/podcast-share";
import { normalizeExternalUrl, parseDiscussParam } from "@/lib/external-id";
import { enrichArticleHtml, embedSrcFor } from "@/lib/article-enrich";
import {
  getDisplayName,
  getAvatarUrl,
  formatNpub,
  shortenNpub,
  extractHashtags,
  KIND_METADATA,
} from "@/lib/nostr-helpers";
import { getReadRelays, fetchRelayLists } from "@/lib/outbox";
import { useMention } from "@/hooks/use-mention";
import { MentionSearch, type MentionResult } from "@/components/MentionSearch";
import { MentionHighlightTextarea } from "@/components/MentionHighlightTextarea";
import { OutpostContentRenderer } from "@/components/OutpostContentRenderer";
import { eventStore } from "@/lib/nostr";
import { use$ } from "applesauce-react/hooks";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getSignalTierLabel } from "@/lib/graperank";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { detectPreset } from "@/lib/trust-preset";
import { readReachDepth } from "@/lib/trust-preset";
import { readExcludedTiers } from "@/lib/trust-filter";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Rss,
  ExternalLink,
  Share2,
  Plus,
  ArrowLeft,
  X,
  Trash2,
  RefreshCw,
  ChevronRight,
  Newspaper,
  Globe,
  Zap,
  Send,
  AlertCircle,
  BookOpen,
  MessageSquare,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clock,
  User,
  AudioLines,
  Filter,
  Bookmark,
  BookmarkCheck,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Headphones,
  Search,
  TrendingUp,
  Package,
  Mic,
  ImageIcon,
  Pencil,
  Check,
  MoreVertical,
  ListStart,
  ListEnd,
  BellRing,
  SlidersHorizontal } from "lucide-react";
import { useTTS } from "@/contexts/TextToSpeechContext";
import { useAudioPlayer, getTrackPosition } from "@/contexts/AudioPlayerContext";
import type { MusicTrack } from "@/lib/music";
import {
  type SavedFeed,
  DEFAULT_FEEDS,
  NEWS_STARTER_FEEDS,
  ALL_PODCAST_FEEDS,
  PODCAST_FEED_URLS,
  NEWS_FRONT_PAGE_URLS,
  PRESET_FEED_URLS,
  SUGGESTED_FEEDS,
  EXTRA_DEFAULT_FEEDS,
  loadCustomFeeds,
  saveCustomFeeds,
  loadHiddenDefaults,
  saveHiddenDefaults,
  addFeedToLibrary,
  updateFeedInLibrary } from "@/lib/rss-feeds";
import {
  mergeFeedItems,
  sortMergedItems,
  capPerSource,
  pickHero,
  countUnread,
  interleaveMergedSources,
  type MergedItem,
  type MergeSource,
  type SortMode,
  type DiversifyOptions } from "@/lib/rss-merge";
import {
  articleCategory,
  categoryToBucket,
  NEWS_BUCKETS,
  NEWS_BUCKET_LABELS,
  type NewsBucket } from "@/lib/news-categories";
import { loadEdition, saveEdition, mergeEditions } from "@/lib/news-edition";
import { stripHtml, formatDuration, buildTrendSuggestionsUrl, normalizeShowTitle, type TrendSuggestionItem } from "@/lib/podcast-index";
import {
  scoreNewsItems,
  presetShowTitleKeys,
  ALERTING_TIERS,
  type ScorableNewsItem,
  type ScoredNewsItem } from "@/lib/news-scoring";
import { countPriorityUnread, shouldShowWorthYourTime } from "@/lib/news-unread";
import { buildDigestGroups, digestSummary, type DigestGroup } from "@/lib/news-digest";
import { clusterStories, type StoryCluster } from "@/lib/story-cluster";
import { useNewsAlertPrefs } from "@/lib/news-alert-settings";
import { AddRssFeedDialog } from "@/components/rss/AddRssFeedDialog";
import { GuestWall } from "@/components/GuestWall";
import { RSSMagazineCard } from "@/components/rss/RSSMagazineCard";
import { splitMagazine, diversifyGrid } from "@/lib/news-magazine";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

// The desktop "magazine" front page kicks in at the lg breakpoint (≥1024px).
// Below it — mobile AND tablet — the News reader stays the single centered
// column (unchanged). Matches Tailwind's lg so the JS branch and the CSS grid
// breakpoints agree.
function useIsWide() {
  const [isWide, setIsWide] = useState(false);
  useEffect(() => {
    const check = () => setIsWide(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isWide;
}

// Live magazine-grid column count, mirroring the grid's Tailwind breakpoints
// (grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4): 2 from lg (≥1024) up, 3 at xl
// (≥1280), 4 at 2xl (≥1536). Threaded into the ordering as the vertical "stride"
// so no card sits directly above another from the same source. Below lg the News
// reader is a single column (stride 1) — the linear diversity already covers it.
function useGridColumns(): number {
  const [cols, setCols] = useState(2);
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setCols(w >= 1536 ? 4 : w >= 1280 ? 3 : 2);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return cols;
}

// Source-dominance cap for the "Top" mixed stream: a source appears at most once
// in any 4-card window, so a firehose outlet (e.g. ZeroHedge) can't crowd out the
// mix. Per-topic tabs pass NO cap (that tab is one topic's full firehose). Kept a
// named constant here so the policy is tunable in one place, not buried in logic.
const TOP_SOURCE_CAP: DiversifyOptions = { window: 4, maxPerWindow: 1 };
// Merge/memory guard: newest N items per feed fed into the All-view merge. A
// firehose never surfaces a single feed's deep back-catalog, so this bounds the
// scored/held item set (≤ N × feed-count) and keeps weak devices safe.
const MAX_ITEMS_PER_FEED = 25;

// Persisted News topic tab. "Top" = the full diversified feed; a bucket key
// (News/Business/Tech/…) = that topic's stream. Validated against the canonical
// bucket list on load so a stale/renamed value falls back to Top.
const RSS_TOPIC_KEY = "ro_news_topic_v1";

function useNewsTopic(): [NewsBucket | "Top", (b: NewsBucket | "Top") => void] {
  const [topic, setTopicState] = useState<NewsBucket | "Top">(() => {
    try {
      const stored = localStorage.getItem(RSS_TOPIC_KEY);
      if (stored && (NEWS_BUCKETS as readonly string[]).includes(stored)) {
        return stored as NewsBucket;
      }
    } catch {
      /* ignore */
    }
    return "Top";
  });
  const setTopic = useCallback((b: NewsBucket | "Top") => {
    setTopicState(b);
    try {
      localStorage.setItem(RSS_TOPIC_KEY, b);
    } catch {
      /* ignore */
    }
  }, []);
  return [topic, setTopic];
}

type RssDensity = "comfortable" | "compact";
const RSS_DENSITY_KEY = "ro_rss_density";

function useRssDensity(): [RssDensity, (d: RssDensity) => void] {
  const [density, setDensityState] = useState<RssDensity>(() => {
    try {
      return localStorage.getItem(RSS_DENSITY_KEY) === "compact" ? "compact" : "comfortable";
    } catch {
      return "comfortable";
    }
  });
  const setDensity = useCallback((d: RssDensity) => {
    setDensityState(d);
    try {
      localStorage.setItem(RSS_DENSITY_KEY, d);
    } catch {
      /* ignore */
    }
  }, []);
  return [density, setDensity];
}

// Sort of the merged "thread of releases": pure latest (default — newest at the
// top, the whole-library firehose reads as a live wire) vs unread-first.
const RSS_SORT_KEY = "ro_rss_sort";

function useRssSortMode(): [SortMode, (m: SortMode) => void] {
  const [mode, setModeState] = useState<SortMode>(() => {
    try {
      return localStorage.getItem(RSS_SORT_KEY) === "unread-first" ? "unread-first" : "latest";
    } catch {
      return "latest";
    }
  });
  const setMode = useCallback((m: SortMode) => {
    setModeState(m);
    try {
      localStorage.setItem(RSS_SORT_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);
  return [mode, setMode];
}

// Persisted last selection in the feed picker. "" = the merged "All feeds" view.
const RSS_ACTIVE_FEED_KEY = "ro_rss_active_feed";

const RSS_BOOKMARKS_KEY = "relay_outpost_rss_bookmarks";

function useRssBookmarks() {
  const [bookmarks, setBookmarks] = useState<RSSItem[]>(() => {
    try {
      const stored = localStorage.getItem(RSS_BOOKMARKS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const isRssBookmarked = useCallback((link: string) => bookmarks.some(b => b.link === link), [bookmarks]);

  const toggleRssBookmark = useCallback((item: RSSItem) => {
    setBookmarks(prev => {
      const exists = prev.some(b => b.link === item.link);
      // Don't persist the full extracted article HTML — it can be huge and would
      // bloat localStorage toward the quota (after which writes silently fail and
      // bookmarks stop saving). Keep a trimmed description; full content is
      // re-fetched on open. Cap the list so it can't grow without bound.
      const slim: RSSItem = exists ? item : {
        ...item,
        fullContent: "",
        description: item.description ? item.description.slice(0, 500) : item.description,
      };
      const next = exists
        ? prev.filter(b => b.link !== item.link)
        : [slim, ...prev].slice(0, 200);
      try { localStorage.setItem(RSS_BOOKMARKS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return { rssBookmarks: bookmarks, isRssBookmarked, toggleRssBookmark };
}

// ---- Read / unread tracking -------------------------------------------------
// A localStorage-backed set of "read" item ids. The id is stable per article:
// prefer guid, then id, then link (which the server always sends). We keep the
// set in React state so cards re-render the instant an item is marked read, and
// mirror it to localStorage (capped, most-recent-first) so it survives reloads
// without growing unbounded.
const RSS_READ_KEY = "ro_rss_read_v1";
const RSS_READ_CAP = 2000;

function rssItemId(item: { guid?: string; id?: string; link?: string }): string {
  return (item.guid || item.id || item.link || "").trim();
}

function loadReadIds(): string[] {
  try {
    const stored = localStorage.getItem(RSS_READ_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {}
  return [];
}

function persistReadIds(ids: string[]) {
  try {
    localStorage.setItem(RSS_READ_KEY, JSON.stringify(ids.slice(0, RSS_READ_CAP)));
  } catch {}
}

function useRssReadState() {
  // Most-recent-first order is tracked separately from the Set so we can cap the
  // persisted list without losing recency. The Set drives O(1) isRead lookups.
  const orderRef = useRef<string[]>(loadReadIds());
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(orderRef.current));

  const isRead = useCallback((id: string) => readIds.has(id), [readIds]);

  const markRead = useCallback((id: string) => {
    if (!id) return;
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      orderRef.current = [id, ...orderRef.current.filter((x) => x !== id)].slice(0, RSS_READ_CAP);
      persistReadIds(orderRef.current);
      return next;
    });
  }, []);

  const markAllRead = useCallback((ids: string[]) => {
    const fresh = ids.filter((id) => id && !readIds.has(id));
    if (fresh.length === 0) return;
    setReadIds((prev) => {
      const next = new Set(prev);
      fresh.forEach((id) => next.add(id));
      orderRef.current = [...fresh, ...orderRef.current.filter((x) => !fresh.includes(x))].slice(0, RSS_READ_CAP);
      persistReadIds(orderRef.current);
      return next;
    });
  }, [readIds]);

  return { isRead, markRead, markAllRead };
}

// ---- Source favicon ---------------------------------------------------------
function faviconHost(...urls: (string | undefined)[]): string {
  for (const u of urls) {
    if (!u) continue;
    try {
      return new URL(u).hostname;
    } catch {}
  }
  return "";
}

/** A small rounded source favicon. Prefers the feed's own image, falls back to
 *  Google's favicon service derived from the link/site host; hides on error. */
// Source logos/favicons removed — they rendered detached from the buttons/rows and
// looked off. Kept as a no-op so existing call sites stay valid; feed names + categories
// already identify each source.
function SourceFavicon(_props: {
  feedImage?: string;
  link?: string;
  siteUrl?: string;
  className?: string;
}) {
  return null;
}

const KIND_TEXT_NOTE = 1;

export interface RSSItem {
  title: string;
  link: string;
  guid?: string;
  id?: string;
  description: string;
  fullContent: string;
  pubDate: string;
  author: string;
  categories: string[];
  thumbnail: string;
  comments: string;
  audioUrl?: string;
  duration?: number;
  episode?: string;
  season?: string;
}

interface ArticleContent {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
  siteName: string;
  byline: string;
}

interface HNComment {
  id: number;
  by: string;
  text: string;
  time: number;
  replyCount: number;
  replies?: HNComment[];
}

interface HNCommentsData {
  comments: HNComment[];
  storyId: string | null;
  hnUrl: string | null;
  title: string;
  points: number;
  commentCount: number;
}

interface RSSFeedData {
  title: string;
  description: string;
  link: string;
  image?: string;
  isPodcast?: boolean;
  items: RSSItem[];
}

function migrateOldFeedsStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const OLD_KEY = "relay-outpost-rss-feeds";
  try {
    const old = localStorage.getItem(OLD_KEY);
    if (!old) return;
    const parsed = JSON.parse(old);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(OLD_KEY);
      return;
    }
    const defaultUrls = new Set(DEFAULT_FEEDS.map(f => f.url));
    const custom = parsed.filter((f: SavedFeed) => !defaultUrls.has(f.url));
    if (custom.length > 0) {
      const existing = loadCustomFeeds();
      const existingUrls = new Set(existing.map(f => f.url));
      const merged = [...existing, ...custom.filter((f: SavedFeed) => !existingUrls.has(f.url))];
      saveCustomFeeds(merged);
    }
    localStorage.removeItem(OLD_KEY);
  } catch {}
}

migrateOldFeedsStorage();

function loadAllFeeds(): SavedFeed[] {
  const hidden = loadHiddenDefaults();
  const visibleDefaults = DEFAULT_FEEDS.filter(f => !hidden.has(f.url));
  const custom = loadCustomFeeds();
  return [...visibleDefaults, ...custom];
}

// ---- Smart alerts (priority strip + digest) ---------------------------------
// Scoring/tiers live in lib/news-scoring, grouping in lib/news-digest; this
// page builds the scoring context (saved feeds + read ledger + trending cache
// + user prefs) and renders tier 1–2 items as a compact strip above the merged
// thread. NOTE: "priority" is IN-APP prominence only — the app has no OS/web
// push infrastructure, so nothing here notifies outside the page.

type NewsScorable = ScorableNewsItem & { merged: MergedItem<RSSItem> };
type NewsScored = ScoredNewsItem<NewsScorable>;

// Digest-only mode shows the collapsed digest once per session.
const NEWS_DIGEST_DISMISSED_KEY = "ro_news_digest_dismissed_v1";

function PriorityGroupRow({ group, v4v, onOpen, onMarkGroupRead }: {
  group: DigestGroup<NewsScorable>;
  v4v: boolean;
  onOpen: (item: RSSItem) => void;
  onMarkGroupRead: (group: DigestGroup<NewsScorable>) => void;
}) {
  const top = group.items[0];
  const topItem = top?.item.merged.item;
  // Podcast episodes in this priority strip are playable in place — not all of
  // these are read-me articles, so surface a Play control (via the global audio
  // player) instead of forcing users into the text reader to hunt for it.
  // Hooks must run before the early `return null` below (rules-of-hooks).
  const { play, currentTrack, isPlaying, togglePlay } = useAudioPlayer();
  const podcastTrack: MusicTrack | null = useMemo(() => {
    if (!topItem?.audioUrl) return null;
    return {
      id: `rss-${encodeURIComponent(topItem.audioUrl)}`,
      title: topItem.title || "Untitled Episode",
      artist: topItem.author || group.label || "Podcast",
      artistPubkey: "",
      audioUrl: topItem.audioUrl,
      coverUrl: topItem.thumbnail || "",
      description: topItem.description || "",
      genre: "Podcast",
      duration: topItem.duration || 0,
      createdAt: topItem.pubDate ? Math.floor(new Date(topItem.pubDate).getTime() / 1000) : 0,
      source: "podcast" as const,
      albumTitle: group.label || undefined };
  }, [topItem, group.label]);
  const isCurrentPodcast = !!podcastTrack && currentTrack?.audioUrl === podcastTrack.audioUrl;
  const isThisPlaying = isCurrentPodcast && isPlaying;
  const handlePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!podcastTrack) return;
    isCurrentPodcast ? togglePlay() : play(podcastTrack);
  }, [podcastTrack, isCurrentPodcast, togglePlay, play]);

  if (!top || !topItem) return null;
  const desc = stripHtml(topItem.description || "").slice(0, 140);
  const dur = formatDuration(top.item.durationSec);
  return (
    <div className="flex items-start gap-1.5 px-3 py-2.5">
      <button
        type="button"
        onClick={() => onOpen(topItem)}
        className="flex-1 min-w-0 text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-primary/[0.06] transition-colors"
        data-testid={`row-priority-${group.key}`}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold text-brand truncate max-w-[180px]">{group.label}</span>
          <span className="text-[10px] text-muted-foreground/70 font-mono uppercase tracking-wider">{group.countLabel}</span>
          {v4v && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-medium text-amber-500/90"
              title="Supports Lightning (value for value)"
              data-testid={`badge-v4v-${group.key}`}
            >
              <Zap className="w-2.5 h-2.5 fill-current" />
              V4V
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-foreground/90 line-clamp-1 mt-0.5">{topItem.title}</p>
        {(desc || dur) && (
          <p className="text-[11px] text-muted-foreground/70 line-clamp-1 mt-0.5">
            {dur && (
              <span className="inline-flex items-center gap-0.5 mr-1.5 tabular-nums text-muted-foreground/60">
                <Clock className="w-2.5 h-2.5" />
                {dur}
              </span>
            )}
            {desc}
          </p>
        )}
      </button>
      {podcastTrack && (
        <button
          type="button"
          onClick={handlePlay}
          className="shrink-0 w-9 h-9 mt-0.5 flex items-center justify-center rounded-full bg-brand/15 text-brand hover:bg-brand/25 transition-colors"
          aria-label={isThisPlaying ? "Pause episode" : "Play episode"}
          title={isThisPlaying ? "Pause episode" : "Play episode"}
          data-testid={`button-play-priority-${group.key}`}
        >
          {isThisPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
      )}
      <button
        type="button"
        onClick={() => onMarkGroupRead(group)}
        className="shrink-0 w-8 h-8 mt-0.5 flex items-center justify-center rounded-lg text-muted-foreground/60 hover:text-brand hover:bg-brand/10 transition-colors"
        aria-label={`Mark ${group.label} read`}
        title="Mark group read"
        data-testid={`button-mark-group-read-${group.key}`}
      >
        <Check className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * The alerts surface above the merged thread. Two presentations:
 *  - Default: a calm "Worth your time" cluster listing tier 1–2 groups. It is
 *    shown ONLY when the priority scorer flagged fresh items (alertCount > 0);
 *    with nothing fresh flagged it hides entirely — no zero-state, no running
 *    total of everything-unread. News is a firehose, not an inbox to clear.
 *  - Digest-only (user setting): one collapsed digest card, shown once per
 *    session (dismiss hides it until the next session; counts are unaffected).
 */
function NewsAlertsPanel({ groups, alertCount, digestOnly, showWorthYourTime, isV4v, onOpen, onMarkGroupRead }: {
  groups: DigestGroup<NewsScorable>[];
  alertCount: number;
  digestOnly: boolean;
  /** The "Worth your time" strip is opt-in (off by default); the compact digest
   *  bar is unaffected. */
  showWorthYourTime: boolean;
  isV4v: (sourceUrl?: string) => boolean;
  onOpen: (item: RSSItem) => void;
  onMarkGroupRead: (group: DigestGroup<NewsScorable>) => void;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(NEWS_DIGEST_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState(false);
  // Hide entirely when the priority scorer flagged nothing fresh — no empty
  // "0" zero-state (this is the exact case behind an all-stale backlog).
  if (groups.length === 0 || !shouldShowWorthYourTime(alertCount)) return null;

  const settingsLink = (
    <Link
      href="/settings#news-alerts"
      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground/60 hover:text-brand hover:bg-brand/10 transition-colors"
      aria-label="News alert settings"
      title="News alert settings"
      data-testid="link-news-alert-settings"
    >
      <SlidersHorizontal className="w-3.5 h-3.5" />
    </Link>
  );

  const rows = (
    <div className="divide-y divide-primary/10">
      {groups.slice(0, 4).map((g) => (
        <PriorityGroupRow
          key={g.key}
          group={g}
          v4v={isV4v(g.items[0]?.item.sourceUrl)}
          onOpen={onOpen}
          onMarkGroupRead={onMarkGroupRead}
        />
      ))}
    </div>
  );

  if (digestOnly) {
    if (dismissed) return null;
    const summary = digestSummary(groups);
    return (
      <div className="rounded-xl border border-primary/25 bg-primary/[0.06] overflow-hidden" data-testid="news-digest-card">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <BellRing className="w-3.5 h-3.5 text-brand shrink-0" />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex-1 min-w-0 flex items-center gap-2 text-left"
            aria-expanded={expanded}
            data-testid="button-digest-toggle"
          >
            <span className="text-xs font-brand uppercase tracking-widest text-brand shrink-0">Digest</span>
            <span className="text-sm text-foreground/85 truncate">{summary.headline}</span>
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
            )}
          </button>
          {settingsLink}
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              try {
                sessionStorage.setItem(NEWS_DIGEST_DISMISSED_KEY, "1");
              } catch {}
            }}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Dismiss digest for this session"
            data-testid="button-digest-dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {expanded && <div className="border-t border-primary/15">{rows}</div>}
      </div>
    );
  }

  // The full "Worth your time" strip is opt-in (Settings → News). Off by default
  // so the News page opens clean; power users can switch it on.
  if (!showWorthYourTime) return null;
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.06] overflow-hidden" data-testid="news-priority-strip">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/15">
        <span className="text-xs font-brand uppercase tracking-widest text-brand">Worth your time</span>
        <Badge variant="default" className="text-[10px] tabular-nums h-4 min-w-4 px-1" data-testid="badge-priority-count">
          {alertCount}
        </Badge>
        <span className="flex-1" />
        {settingsLink}
      </div>
      {rows}
    </div>
  );
}

function proxyContentImages(html: string): string {
  return html.replace(
    /(<img[^>]+src=)(["'])([^"']+)\2/gi,
    (_match, prefix, quote, url) => {
      if (url.startsWith('data:') || url.includes('/api/rss/image-proxy')) return _match;
      return `${prefix}${quote}/api/rss/image-proxy?url=${encodeURIComponent(url)}${quote}`;
    }
  );
}

// Single-URL flavour of the same proxy mapping, handed to enrichArticleHtml so
// bare-image upgrades AND YouTube facade thumbnails load through our server
// (no direct third-party request from the reader).
function proxyRssImage(url: string): string {
  if (url.startsWith("data:") || url.includes("/api/rss/image-proxy")) return url;
  return `/api/rss/image-proxy?url=${encodeURIComponent(url)}`;
}

interface ShareContext {
  item: RSSItem;
  feedTitle?: string;
  feedImage?: string;
}

function ShareToNostrDialog({ item, onClose, feedTitle, feedImage }: { item: RSSItem; onClose: () => void; feedTitle?: string; feedImage?: string }) {
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [isPublishing, setIsPublishing] = useState(false);
  const isPodcast = !!item.audioUrl;

  const imageUrl = item.thumbnail || feedImage || "";

  // NIP-73 anchor this link's discussion is keyed to. The shared note both
  // deep-links to the in-app discussion AND references the anchor with a
  // lowercase `i` tag, so the kind-1 (feed reach) funnels into the portable
  // cross-client conversation.
  // TODO(PR-C): podcast:item:guid anchor for episodes (separate PR). For PR-A
  // the anchor is uniformly the normalized page URL.
  const discussAnchor = useMemo(() => {
    try { return normalizeExternalUrl(item.link); } catch { return ""; }
  }, [item.link]);
  const defaultContent = useMemo(() => {
    const cleanTitle = (item.title || "").replace(/[\r\n]+/g, " ").trim();
    const parts: string[] = [];

    if (isPodcast && imageUrl) {
      parts.push(imageUrl, "");
    }

    parts.push(cleanTitle);

    if (isPodcast && feedTitle) {
      parts.push(`🎙️ ${feedTitle}`);
    }

    // NO "Discuss on Relay Outpost" line, and no link back to our own site.
    //
    // It used to lead the body, on every single share. Two things make it
    // unnecessary rather than merely wordy. The discussion is anchored by the
    // NIP-73 `["i", discussAnchor]` TAG pushed below — the thread exists, and
    // stays joinable, whether or not the body advertises it. And the article
    // link is already in the post, so a reader who wants the conversation has
    // the subject in hand either way.
    //
    // What it did add was an ad for us in the middle of someone else's share,
    // repeated every time. A share should read as the thing being shared.

    if (item.link) {
      parts.push("", item.link);
    }

    if (isPodcast && item.audioUrl) {
      parts.push("", item.audioUrl);
    }

    if (isPodcast && item.description) {
      const snippet = stripHtml(item.description).slice(0, 200).trim();
      if (snippet) {
        parts.push("", snippet + (stripHtml(item.description).length > 200 ? "…" : ""));
      }
    }
    return parts.join("\n");
  }, [item, isPodcast, feedTitle, imageUrl]);

  const [content, setContent] = useState(defaultContent);

  const handleShare = async () => {
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in to share.", variant: "destructive" });
      return;
    }
    if (!content.trim()) return;

    setIsPublishing(true);
    try {
      const tags: string[][] = [];
      // NIP-73 reference: point the note at the external anchor (lowercase `i`),
      // so clients can associate this kind-1 with the link's discussion.
      if (discussAnchor) tags.push(["i", discussAnchor]);
      if (item.link) tags.push(["r", item.link]);
      if (item.audioUrl) {
        tags.push(["r", item.audioUrl]);
        const imetaAudioParts = ["imeta", `url ${item.audioUrl}`, "m audio/mpeg"];
        if (item.duration) {
          imetaAudioParts.push(`duration ${item.duration}`);
        }
        tags.push(imetaAudioParts);
      }
      if (imageUrl) {
        tags.push(["r", imageUrl]);
        let imgMime = "image/jpeg";
        try {
          const ext = new URL(imageUrl).pathname.split(".").pop()?.toLowerCase();
          if (ext === "png") imgMime = "image/png";
          else if (ext === "webp") imgMime = "image/webp";
          else if (ext === "gif") imgMime = "image/gif";
          else if (ext === "avif") imgMime = "image/avif";
        } catch {}
        tags.push(["imeta", `url ${imageUrl}`, `m ${imgMime}`]);
      }
      tags.push(...clientTags());

      const eventTemplate = {
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: content.trim() };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      await publishEvent(signedEvent, userRelays, undefined, isUserSelected);
      toast({ title: "Shared", description: isPodcast ? "Episode posted with playable audio." : "Article shared successfully." });
      onClose();
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to share:", err);
        toast({ title: "Failed to share", description: "Something went wrong.", variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const durationStr = useMemo(() => {
    if (!item.duration) return null;
    const m = Math.floor(item.duration / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m}m`;
  }, [item.duration]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-primary/10 border border-border p-3 overflow-hidden">
        {isPodcast ? (
          <div className="flex gap-3">
            {(item.thumbnail || feedImage) && (
              <img
                src={`/api/rss/image-proxy?url=${encodeURIComponent(item.thumbnail || feedImage || "")}`}
                alt=""
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover flex-shrink-0 border border-white/10"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Headphones className="w-3 h-3 text-brand flex-shrink-0" />
                <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider">Podcast Episode</p>
              </div>
              <p className="text-sm font-medium text-foreground/90 line-clamp-2 break-words leading-snug">{item.title}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {feedTitle && (
                  <span className="text-[11px] text-muted-foreground/70">{feedTitle}</span>
                )}
                {durationStr && (
                  <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {durationStr}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <div className="flex items-center gap-1">
                  <AudioLines className="w-3 h-3 text-green-800/70 dark:text-green-400/70" />
                  <span className="text-[10px] text-green-800/60 dark:text-green-400/60 font-mono uppercase tracking-wider">Audio</span>
                </div>
                {imageUrl && (
                  <div className="flex items-center gap-1">
                    <ImageIcon className="w-3 h-3 text-blue-700/70 dark:text-blue-400/70" />
                    <span className="text-[10px] text-blue-700/60 dark:text-blue-400/60 font-mono uppercase tracking-wider">Artwork</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider mb-1.5">Sharing Article</p>
            <p className="text-sm font-medium text-foreground/90 line-clamp-2 break-words">{item.title}</p>
            {feedTitle && (
              <p className="text-[11px] text-muted-foreground/60 mt-1">{feedTitle}</p>
            )}
            <p className="text-[11px] text-muted-foreground/40 mt-1 break-all line-clamp-1">{item.link}</p>
          </>
        )}
      </div>

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        className="text-sm resize-none bg-muted border-input focus:border-primary/30 focus:bg-muted/70 rounded-lg break-words dark:bg-white/[0.04] dark:border-white/[0.08] dark:focus:bg-white/[0.06]"
        style={{ fontSize: 16, wordBreak: "break-word", overflowWrap: "break-word" }}
        placeholder="Add your thoughts..."
        autoComplete="off"
        data-testid="textarea-share-content"
      />

      <p className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider leading-relaxed">
        {isPodcast
          ? `Posts publicly to your feed with the episode artwork and playable audio, plus a Discuss link into the in-app conversation about it.`
          : "Posts publicly to your feed with a Discuss link into the in-app conversation about this article."}
      </p>

      <div className="flex gap-2.5 pt-1">
        <Button
          variant="outline"
          onClick={onClose}
          className="flex-1 font-brand uppercase tracking-widest text-xs border-border text-muted-foreground dark:border-white/10"
          data-testid="button-cancel-share"
        >
          Cancel
        </Button>
        <Button
          onClick={handleShare}
          disabled={isPublishing || !content.trim()}
          className="flex-1 bg-primary text-primary-foreground font-brand uppercase tracking-widest text-xs border-0"
          data-testid="button-confirm-share"
        >
          {isPublishing ? (
            <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
          ) : (
            <MessageSquare className="w-3.5 h-3.5 mr-2" />
          )}
          {isPublishing ? "Posting..." : "Discuss"}
        </Button>
      </div>
    </div>
  );
}

function HNCommentThread({ comment, depth = 0, isMobile = false }: { comment: HNComment; depth?: number; isMobile?: boolean }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const timeAgo = useMemo(() => {
    if (!comment.time) return "";
    try {
      return formatDistanceToNow(new Date(comment.time * 1000), { addSuffix: true });
    } catch { return ""; }
  }, [comment.time]);

  const cappedDepth = isMobile ? Math.min(depth, 3) : depth;
  const indent = cappedDepth > 0
    ? isMobile ? "ml-2 pl-2 border-l border-border/30" : "ml-4 pl-3 border-l border-border/30"
    : "";

  return (
    <div className={`${indent} min-w-0`} data-testid={`hn-comment-${comment.id}`}>
      <div className="py-2.5">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-xs font-semibold text-foreground/80" data-testid={`text-hn-author-${comment.id}`}>{comment.by}</span>
          <span className="text-[11px] text-muted-foreground/70">{timeAgo}</span>
        </div>
        <div
          className="text-xs text-foreground/70 leading-relaxed break-words [&_a]:text-foreground/90 [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-all [&_p]:mb-2 [&_p]:break-words [&_pre]:bg-muted/30 [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-[11px] [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_code]:text-[11px] [&_code]:break-all"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(comment.text, { ALLOWED_TAGS: ['a', 'p', 'i', 'b', 'em', 'strong', 'code', 'pre', 'br'], ALLOWED_ATTR: ['href', 'rel'] }) }}
          data-testid={`text-hn-comment-body-${comment.id}`}
        />
        {comment.replies && comment.replies.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground/80 font-mono uppercase tracking-wider"
            data-testid={`button-toggle-replies-${comment.id}`}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
            {comment.replyCount > comment.replies.length && ` of ${comment.replyCount}`}
          </button>
        )}
      </div>
      {expanded && comment.replies && comment.replies.map((reply) => (
        <HNCommentThread key={reply.id} comment={reply} depth={depth + 1} isMobile={isMobile} />
      ))}
    </div>
  );
}

// ── NIP-73 external-URL Nostr discussion ─────────────────────────────────────
// The portable, cross-client conversation ABOUT this page, keyed to its URL via
// kind-1111 comments. Rendered BESIDE (never merged into) any native thread
// (e.g. Hacker News): these are real Nostr identities with WoT tiers, and a
// reply here is a public Nostr note — it never reaches HN.

function NostrCommentRow({ comment }: { comment: NostrEvent }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, comment.pubkey), [comment.pubkey]);
  const { getAuthorTier, isAuthorFlagged, wotEnabled, scores } = useGrapeRankScores();
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(comment.pubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  const npub = useMemo(() => formatNpub(comment.pubkey), [comment.pubkey]);
  const tier = isAuthorFlagged(comment.pubkey) ? ("flagged" as const) : getAuthorTier(comment.pubkey);
  const timeAgo = useMemo(() => {
    try { return formatDistanceToNow(comment.created_at * 1000, { addSuffix: true }); }
    catch { return ""; }
  }, [comment.created_at]);

  return (
    <div className="py-2.5" data-testid={`nostr-comment-${comment.id}`}>
      <div className="flex items-center gap-2 mb-1.5 min-w-0">
        <Link href={`/profile/${npub}`}>
          <Avatar className="w-6 h-6 shrink-0 cursor-pointer">
            {avatar && <AvatarImage src={avatar} alt={name} />}
            <AvatarFallback className="text-[8px] bg-brand/10 text-brand">
              {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>
        <Link href={`/profile/${npub}`}>
          <span className="text-xs font-semibold text-foreground/80 truncate cursor-pointer hover:underline" data-testid={`text-nostr-author-${comment.id}`}>
            {name}
          </span>
        </Link>
        {wotEnabled && scores && (
          <TrustTierGlyph tier={tier} size="w-2.5 h-2.5" title={getSignalTierLabel(tier)} />
        )}
        <span className="text-[11px] text-muted-foreground/70 shrink-0">{timeAgo}</span>
      </div>
      {/* Rich body — same shared renderer the feed uses: nostr: refs become
          clickable profiles, #hashtags become searchable, links/media embed.
          `compact` keeps it at the dense comment-row text size. */}
      <div className="text-xs text-foreground/70 leading-relaxed break-words" data-testid={`text-nostr-comment-body-${comment.id}`}>
        <OutpostContentRenderer event={comment} compact />
      </div>
    </div>
  );
}

function NostrDiscussion({ url, isMobile, onCountChange }: { url: string; isMobile?: boolean; onCountChange?: (n: number) => void }) {
  const { pubkey, signer, follows, attemptReconnect } = useNostrAuth();
  const { scores, requestScoresBulk, flaggedPubkeys } = useGrapeRankScores();
  const { toast } = useToast();
  // Raw, deduped kind-1111 set (pre-trust). Seeded from the SWR cache so a
  // re-open paints instantly; the live subscription streams fresh comments on
  // top. Trust is applied reactively below — it never blocks the composer.
  const [rawEvents, setRawEvents] = useState<NostrEvent[]>(() => getCachedDiscussion(url) ?? []);
  // "Settled" flips once the live path has emitted OR a short grace window
  // elapsed. Drives skeleton → empty-state only; the composer is always live.
  const [settled, setSettled] = useState(false);
  const [showFiltered, setShowFiltered] = useState(false);
  const [text, setText] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [posting, setPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reuse the SAME @-mention typeahead + tokenizer the main post composer uses
  // (useMention → MentionSearch → resolveContent/getMentionTags), so a
  // discussion comment gets true post-parity mentions rather than a bespoke UI.
  const {
    mentionActive, mentionQuery, detectMention, insertMention, closeMention,
    resolveContent, getMentionTags, clearMentionTags,
  } = useMention();

  const handleTextChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (pendingConfirm) setPendingConfirm(false);
    detectMention(val, e.target.selectionStart ?? val.length);
  }, [pendingConfirm, detectMention]);

  const handleMentionSelect = useCallback((result: MentionResult) => {
    setText((cur) => insertMention(result, cur, textareaRef));
    if (pendingConfirm) setPendingConfirm(false);
    // Warm the mentioned user's NIP-65 relay list so, by publish time, we have
    // an inbox relay to hint in the p-tag / nprofile AND to outbox-route to.
    fetchRelayLists([result.pubkey]);
  }, [insertMention, pendingConfirm]);

  const followSet = useMemo(() => new Set(follows), [follows]);
  // Same Open/Balanced/Strict dial the For You feed reads — derived from the
  // shared reach + excluded-tier settings, not a discussion-local invention.
  const preset = useMemo(() => detectPreset(readReachDepth(), readExcludedTiers()), []);

  // Apply the shared trust pipeline over the streamed raw set. Reactive to the
  // strictness dial + follows + score arrivals, so a late GrapeRank score
  // re-partitions the thread without any re-fetch.
  const result = useMemo(
    () =>
      applyDiscussionTrust(rawEvents, {
        preset,
        follows: followSet,
        selfPubkey: pubkey,
        scoreGetter: (pk) => scores?.get(pk),
        flaggedPubkeys: flaggedPubkeys ?? undefined,
      }),
    [rawEvents, preset, followSet, pubkey, scores, flaggedPubkeys],
  );

  // Live subscription: stale-while-revalidate. The cache paints instantly; the
  // pool subscription revalidates so comments appear <1s as they arrive — never
  // the old 4s one-shot block.
  useEffect(() => {
    setShowFiltered(false);
    setSettled(false);
    setRawEvents(getCachedDiscussion(url) ?? []);
    // Empty threads never emit — settle the skeleton after a short grace window.
    const settleTimer = setTimeout(() => setSettled(true), 2500);
    const unsub = subscribeDiscussion(url, { pubkey, langs: [] }, (events) => {
      setRawEvents(events);
      setSettled(true);
    });
    return () => {
      clearTimeout(settleTimer);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Report the total count + hydrate author scores when the partition changes.
  useEffect(() => {
    onCountChange?.(result.comments.length + result.filteredCount);
    const authors = [...result.comments, ...result.filtered].map((c) => c.pubkey);
    if (authors.length) requestScoresBulk(authors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const doPublish = useCallback(async () => {
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in to post to the discussion.", variant: "destructive" });
      return;
    }
    const body = text.trim();
    if (!body) return;
    setPosting(true);
    try {
      // Extraction (same helpers as the post composer): picked @-mentions →
      // p-tags, #hashtags → t-tags, typed tokens → nostr: refs in the body.
      const mentionPubkeys = getMentionTags(body).map((t) => t[1]);
      const resolved = resolveContent(body);
      const { content, pTags } = enrichCommentMentions(
        resolved,
        mentionPubkeys,
        (pk) => getReadRelays(pk, [])[0],
      );
      const hashtagTags = extractHashtags(body);
      const template = buildComment(url, content, { mentionTags: pTags, hashtagTags });
      const signed = await signWithTimeout(signer, template);
      // Interop delivery: outbox-route to each mentioned user's NIP-65 inbox on
      // top of the discussion superset, so the mention reaches them in any client.
      const mentionInboxRelays = mentionPubkeys.flatMap((pk) => getReadRelays(pk, []).slice(0, 2));
      const ok = await publishComment(signed as NostrEvent, pubkey, mentionInboxRelays);
      if (!ok) {
        toast({ title: "Couldn't publish", description: "No relay accepted your comment. Try again.", variant: "destructive" });
        return;
      }
      setText("");
      clearMentionTags();
      setPendingConfirm(false);
      // Optimistic insert: fold my own comment into the raw set + the SWR cache
      // so it shows immediately and survives a re-open (my own pubkey is always
      // in-network, so applyDiscussionTrust admits it).
      setRawEvents((prev) => {
        const next = mergeDiscussionEvents(prev, [signed as NostrEvent]);
        cacheDiscussion(url, next);
        return next;
      });
      toast({ title: "Posted to Nostr", description: "Your public note about this link is live." });
    } catch (err) {
      // toast cast mirrors the existing share-flow call site; handleSignerError's
      // param type predates the current toast return shape (known baseline typing).
      if (isSignerError(err)) { await handleSignerError(err, toast as any, attemptReconnect); }
      else { toast({ title: "Failed to post", variant: "destructive" }); }
    } finally {
      setPosting(false);
    }
  }, [signer, pubkey, text, url, toast, attemptReconnect, getMentionTags, resolveContent, clearMentionTags]);

  const nostrCount = result.comments.length;

  return (
    <div data-testid="container-nostr-discussion">
      <div
        className="flex items-center gap-2 mb-3 pb-2 border-b border-border/20 flex-wrap"
        title="A public conversation about this link, powered by Nostr (an open network) — so the same discussion shows up in other apps too, not just here."
      >
        <Globe className="w-3.5 h-3.5 text-brand/80" />
        <span className="text-xs font-semibold">Discussion</span>
        <span className="text-[11px] text-muted-foreground/70">
          {nostrCount} {nostrCount === 1 ? "comment" : "comments"} · public
        </span>
      </div>

      {/* Composer — explicitly a public Nostr note about the link, NOT an HN reply.
          Same @-mention typeahead + #hashtag tokenizer as the main post composer. */}
      <div className="mb-4">
        {mentionActive && (
          <div className="relative z-20 mb-1">
            <MentionSearch
              query={mentionQuery}
              visible={mentionActive}
              onSelect={handleMentionSelect}
              onClose={closeMention}
              position="static"
            />
          </div>
        )}
        <MentionHighlightTextarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          placeholder="Share your take on this…"
          className="w-full rounded-xl px-3.5 py-3 bg-muted/40 border border-border/50 text-sm text-foreground/90 placeholder:text-muted-foreground/50 resize-none min-h-[76px] focus-visible:ring-0 focus-visible:border-primary/45 focus-visible:bg-muted/50 transition-colors"
          data-testid="input-nostr-comment"
        />
        <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
            <Globe className="w-3 h-3" />
            Public — and visible in any Nostr app, not just here. It stays on Nostr, not the original site.
          </span>
          {pendingConfirm ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setPendingConfirm(false)} disabled={posting} data-testid="button-nostr-cancel">
                Cancel
              </Button>
              <Button size="sm" className="text-xs gap-1.5" onClick={doPublish} disabled={posting} data-testid="button-nostr-confirm">
                {posting ? <RelayOutpostInlineLoader /> : <Send className="w-3.5 h-3.5" />}
                Post publicly
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="text-xs gap-1.5 shrink-0"
              onClick={() => setPendingConfirm(true)}
              disabled={!text.trim() || posting}
              data-testid="button-nostr-post"
            >
              <Send className="w-3.5 h-3.5" />
              Post
            </Button>
          )}
        </div>
      </div>

      {result.comments.length > 0 ? (
        <div className="divide-y divide-border/20" data-testid="container-nostr-comments">
          {result.comments.map((c) => (
            <NostrCommentRow key={c.id} comment={c} />
          ))}
        </div>
      ) : !settled && rawEvents.length === 0 ? (
        // Skeleton — shown instantly beside the always-live composer while the
        // subscription warms up (never a blocking spinner on the whole panel).
        <div className="space-y-3 py-2" data-testid="container-nostr-loading" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-6 h-6 rounded-full bg-muted/50" />
                <div className="h-2.5 w-24 rounded bg-muted/50" />
              </div>
              <div className="h-2.5 w-full rounded bg-muted/40 mb-1" />
              <div className="h-2.5 w-2/3 rounded bg-muted/40" />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/70 py-4" data-testid="text-nostr-empty">
          No comments yet — be the first to discuss this link.
        </p>
      )}

      {result.filteredCount > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowFiltered((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/80 font-mono uppercase tracking-wider"
            data-testid="button-nostr-show-filtered"
          >
            {showFiltered ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showFiltered ? "Hide" : "Show"} {result.filteredCount} filtered {result.filteredCount === 1 ? "reply" : "replies"}
          </button>
          {showFiltered && (
            <div className="divide-y divide-border/20 mt-1 opacity-70" data-testid="container-nostr-filtered">
              {result.filtered.map((c) => (
                <NostrCommentRow key={c.id} comment={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const articleContentCache = new Map<string, ArticleContent>();
const ARTICLE_CACHE_MAX = 50;
// Bounded insert: evict the oldest entry once full so a long reading session
// can't grow the in-memory article cache without limit (each entry is full
// extracted HTML).
function setArticleCache(link: string, data: ArticleContent) {
  if (articleContentCache.size >= ARTICLE_CACHE_MAX && !articleContentCache.has(link)) {
    const oldest = articleContentCache.keys().next().value;
    if (oldest !== undefined) articleContentCache.delete(oldest);
  }
  articleContentCache.set(link, data);
}

function ArticleReaderDialog({ item, onClose, onShare, isMobile: isMobileProp, isBookmarked, onToggleBookmark, initialTab = "article" }: { item: RSSItem; onClose: () => void; onShare: (item: RSSItem) => void; isMobile?: boolean; isBookmarked?: boolean; onToggleBookmark?: () => void; initialTab?: "article" | "comments" }) {
  const isMobile = isMobileProp ?? false;
  const tts = useTTS();
  // `initialTab` lets the ?discuss= deep-link open straight to the Discussion tab.
  const [activeTab, setActiveTab] = useState<"article" | "comments">(initialTab);
  const cached = articleContentCache.get(item.link);
  const [articleData, setArticleData] = useState<ArticleContent | null>(cached || null);
  const [isLoadingArticle, setIsLoadingArticle] = useState(!cached);
  const [articleError, setArticleError] = useState(false);
  const [hnData, setHnData] = useState<HNCommentsData | null>(null);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [commentsChecked, setCommentsChecked] = useState(false);
  const [nostrCount, setNostrCount] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);
  const scrollThreshold = 20;

  // ── Shared-podcast recovery ────────────────────────────────────────────────
  // A "Discuss on Relay Outpost" link only carries the page URL, so a shared
  // PODCAST would otherwise open as a dead article ("can't be shown here") with
  // no way to play it. Recover the episode audio from the shared note's standard
  // tags (imeta / r) so the reader can offer a real Listen tab — which also
  // un-breaks every podcast link already shared.
  const { play, currentTrack, isPlaying, togglePlay } = useAudioPlayer();
  const [sharedPodcast, setSharedPodcast] = useState<SharedPodcast | null>(null);
  useEffect(() => {
    if (item.audioUrl || !item.link) return; // already has audio, or nothing to look up
    let cancelled = false;
    resolveSharedPodcast(item.link)
      .then((p) => { if (!cancelled && p) setSharedPodcast(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.audioUrl, item.link]);

  const podcastAudioUrl = item.audioUrl || sharedPodcast?.audioUrl;
  const isPodcastReader = !!podcastAudioUrl;
  const podcastTrack = useMemo<MusicTrack | null>(() => {
    if (!podcastAudioUrl) return null;
    return {
      id: `rss-${encodeURIComponent(podcastAudioUrl)}`,
      title: sharedPodcast?.title || item.title || "Podcast Episode",
      artist: item.author || "Podcast",
      artistPubkey: "",
      audioUrl: podcastAudioUrl,
      coverUrl: sharedPodcast?.image || item.thumbnail || "",
      description: item.description || "",
      genre: "Podcast",
      duration: sharedPodcast?.duration || item.duration || 0,
      createdAt: 0,
      source: "podcast",
    };
  }, [podcastAudioUrl, sharedPodcast, item]);
  const isCurrentEpisode = !!podcastTrack && currentTrack?.audioUrl === podcastTrack.audioUrl;
  const playEpisode = useCallback(() => {
    if (!podcastTrack) return;
    if (isCurrentEpisode) togglePlay();
    else play(podcastTrack);
  }, [podcastTrack, isCurrentEpisode, togglePlay, play]);

  // When a site blocks content extraction there is no article to show — but the
  // link ALWAYS carries a portable Nostr discussion, which is what a shared
  // link's opener usually wants anyway. Rather than dead-end on a bleak error,
  // auto-open the Discussion once (guarded so a manual return to Article sticks).
  // A PODCAST instead jumps to its Listen tab (below), not the discussion.
  const autoDiscussRef = useRef(false);
  useEffect(() => {
    if (isPodcastReader) return;
    if (articleError && activeTab === "article" && !autoDiscussRef.current) {
      autoDiscussRef.current = true;
      setActiveTab("comments");
    }
  }, [isPodcastReader, articleError, activeTab]);
  // Once the episode is recovered, surface the Listen tab (the person opened a
  // podcast — put the player in front of them), unless they've already navigated.
  const autoListenRef = useRef(false);
  useEffect(() => {
    if (isPodcastReader && !autoListenRef.current) {
      autoListenRef.current = true;
      setActiveTab("article"); // the "article" tab renders the Listen panel for podcasts
    }
  }, [isPodcastReader]);

  const isHN = useMemo(() =>
    item.link.includes("news.ycombinator.com") ||
    item.link.includes("hnrss.org") ||
    item.comments?.includes("news.ycombinator.com"),
  [item.link, item.comments]);

  const hasRssContent = useMemo(() => {
    const fc = item.fullContent || "";
    return fc.length > 50;
  }, [item.fullContent]);

  // Sanitize FIRST, then enrich: everything the enrichment pass injects is
  // built from DOM APIs + regex-validated URL parts, so it must not be fed
  // back through DOMPurify (which would strip the click-to-play facades).
  const articleContent = articleData?.content;
  const enrichedArticleHtml = useMemo(() => {
    if (!articleContent) return "";
    return enrichArticleHtml(
      DOMPurify.sanitize(articleContent, { ADD_TAGS: ['figure', 'figcaption', 'picture', 'source', 'iframe', 'video'], ADD_ATTR: ['loading', 'srcset', 'sizes', 'allow', 'allowfullscreen', 'frameborder'] }),
      { imageProxy: proxyRssImage },
    );
  }, [articleContent]);
  const enrichedDescriptionHtml = useMemo(() => {
    if (!item.description) return "";
    return enrichArticleHtml(DOMPurify.sanitize(item.description), { imageProxy: proxyRssImage });
  }, [item.description]);

  // Click-to-play: the facade only carries {provider, id}; embedSrcFor
  // re-validates the id shape and builds the iframe URL from a hardcoded
  // template (sanitized article HTML may carry attacker-chosen data-* attrs —
  // they must never be trusted as URLs). The iframe is created ONLY here, on
  // an explicit user activation — no Google/Vimeo request before that.
  const activateEmbed = useCallback((from: HTMLElement) => {
    const facade = from.closest("[data-embed]") as HTMLElement | null;
    if (!facade || facade.querySelector("iframe")) return;
    const src = embedSrcFor(facade.getAttribute("data-embed"), facade.getAttribute("data-embed-id"));
    if (!src) return;
    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.title = "Embedded video";
    iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
    iframe.setAttribute("allowfullscreen", "");
    iframe.className = "absolute inset-0 w-full h-full !my-0 !rounded-none border-0";
    facade.replaceChildren(iframe);
    facade.classList.remove("cursor-pointer");
    facade.removeAttribute("role");
    facade.removeAttribute("tabindex");
  }, []);
  const handleEmbedClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.closest("[data-embed]")) return;
    e.preventDefault();
    e.stopPropagation();
    activateEmbed(target);
  }, [activateEmbed]);
  const handleEmbedKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as HTMLElement;
    if (!target.closest("[data-embed]")) return;
    e.preventDefault();
    activateEmbed(target);
  }, [activateEmbed]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleClose]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let rafId = 0;
    const handleScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const currentY = el.scrollTop;
        const delta = currentY - lastScrollY.current;
        if (Math.abs(delta) < scrollThreshold) return;
        if (delta > 0 && currentY > 80) {
          setHeaderVisible(false);
        } else if (delta < -scrollThreshold) {
          setHeaderVisible(true);
        }
        lastScrollY.current = currentY;
      });
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setArticleError(false);

    if (articleContentCache.has(item.link)) {
      setArticleData(articleContentCache.get(item.link)!);
      setIsLoadingArticle(false);
      return;
    }

    if (hasRssContent) {
      const rssData = {
        title: item.title,
        content: proxyContentImages(item.fullContent),
        textContent: stripHtml(item.fullContent),
        excerpt: item.description,
        siteName: "",
        byline: item.author };
      setArticleData(rssData);
      setArticleCache(item.link, rssData);
      setIsLoadingArticle(false);
      return;
    }

    async function fetchArticle() {
      setIsLoadingArticle(true);
      setArticleError(false);
      try {
        const res = await fetch(`/api/rss/article?url=${encodeURIComponent(item.link)}`);
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        if (!cancelled) {
          if (data.content && data.content.length > 100) {
            setArticleData(data);
            setArticleCache(item.link, data);
          } else {
            setArticleError(true);
          }
        }
      } catch {
        if (!cancelled) {
          setArticleError(true);
        }
      } finally {
        if (!cancelled) setIsLoadingArticle(false);
      }
    }

    fetchArticle();
    return () => { cancelled = true; };
  }, [item.link, item.fullContent, hasRssContent, item.title, item.description, item.author]);

  useEffect(() => {
    if (commentsChecked) return;
    let cancelled = false;

    async function fetchComments() {
      setIsLoadingComments(true);
      try {
        const searchUrl = isHN ? item.link : item.link;
        const res = await fetch(`/api/rss/hn-comments?url=${encodeURIComponent(searchUrl)}`);
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        if (!cancelled && data.comments && data.comments.length > 0) {
          setHnData(data);
        }
      } catch {}
      finally {
        if (!cancelled) {
          setIsLoadingComments(false);
          setCommentsChecked(true);
        }
      }
    }

    fetchComments();
    return () => { cancelled = true; };
  }, [item.link, isHN, commentsChecked]);

  const timeAgo = useMemo(() => {
    if (!item.pubDate) return "";
    try { return formatDistanceToNow(new Date(item.pubDate), { addSuffix: true }); }
    catch { return ""; }
  }, [item.pubDate]);

  const scrollToTop = () => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleClose} data-testid="overlay-article-reader">
      <div
        className="relative bg-background w-full sm:border sm:border-border/50 sm:rounded-lg sm:max-w-3xl sm:mx-4 sm:max-h-[90vh] h-full sm:h-auto flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="dialog-article-reader"
      >
        <div
          className={`flex items-center gap-2 px-4 py-3 border-b border-border/40 shrink-0 bg-background transition-[opacity,transform] duration-200 ${
            headerVisible ? "opacity-100 translate-y-0" : "sm:opacity-0 sm:-translate-y-2 sm:pointer-events-none opacity-100 translate-y-0"
          }`}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            data-testid="button-close-reader"
          >
            <X className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate" data-testid="text-reader-title">{item.title || "Article"}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {item.author && <span className="text-[11px] text-muted-foreground/80 truncate max-w-[150px]">{item.author}</span>}
              {timeAgo && <span className="text-[11px] text-muted-foreground/60">{timeAgo}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (tts.isReading) {
                  tts.stop();
                } else {
                  const text = articleData
                    ? articleData.textContent
                    : stripHtml(item.fullContent || item.description);
                  if (text) tts.startReading(text, item.title, "/rss");
                }
              }}
              disabled={isLoadingArticle && !item.fullContent}
              data-testid="button-listen-rss"
            >
              <AudioLines className={`w-4 h-4 ${tts.isReading ? "text-brand" : ""}`} />
            </Button>
            <a href={item.link} target="_blank" rel="noopener noreferrer" data-testid="button-open-original">
              <Button variant="ghost" size="icon">
                <ExternalLink className="w-4 h-4" />
              </Button>
            </a>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onShare(item)}
              data-testid="button-share-from-reader"
            >
              <Share2 className="w-4 h-4" />
            </Button>
            {onToggleBookmark && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleBookmark}
                className={isBookmarked ? "text-primary" : ""}
                data-testid="button-bookmark-from-reader"
              >
                {isBookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>

        {tts.isReading && (
          <div className="flex flex-col shrink-0 bg-background border-b border-primary/20 animate-in fade-in slide-in-from-top-2 duration-200" data-testid="inline-tts-player">
            <div className="flex items-center gap-1 px-3 py-1.5">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {tts.isLoading ? (
                  <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand/70 shrink-0" />
                ) : (
                  <AudioLines className="w-3.5 h-3.5 text-brand/70 shrink-0" />
                )}
                <span className="text-[11px] font-medium text-foreground/80 truncate">{tts.title || "Listening..."}</span>
              </div>
              <div className="flex items-center shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={tts.skipBack} disabled={tts.isLoading} data-testid="inline-tts-back">
                  <SkipBack className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={tts.togglePause} disabled={tts.isLoading} data-testid="inline-tts-toggle">
                  {tts.isLoading ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : tts.isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={tts.skipForward} disabled={tts.isLoading} data-testid="inline-tts-forward">
                  <SkipForward className="w-3 h-3" />
                </Button>
                <button
                  className="h-7 px-1 text-[10px] font-bold tabular-nums text-brand/70 hover:text-brand transition-colors rounded"
                  onClick={() => {
                    const rates = [1, 1.25, 1.5, 1.75, 2];
                    const idx = rates.indexOf(tts.rate);
                    tts.setRate(rates[(idx + 1) % rates.length]);
                  }}
                  data-testid="inline-tts-speed"
                >
                  {tts.rate}x
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-700/80 dark:text-red-400/80" onClick={tts.stop} data-testid="inline-tts-stop">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="w-full h-[2px] bg-primary/10">
              <div
                className="h-full bg-primary/50 transition-[width] duration-150 ease-out"
                style={{ width: `${tts.progress}%` }}
              />
            </div>
          </div>
        )}

        {!headerVisible && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 hidden sm:flex">
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full bg-background/90 border border-border/40 flex items-center justify-center backdrop-blur-sm shadow-lg"
              data-testid="button-close-reader-floating"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setHeaderVisible(true); contentRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="w-8 h-8 rounded-full bg-background/90 border border-border/40 flex items-center justify-center backdrop-blur-sm shadow-lg"
              data-testid="button-show-header-floating"
            >
              <ChevronRight className="w-4 h-4 -rotate-90" />
            </button>
          </div>
        )}

        {/* Discussion is always reachable: even a plain blog/RSS item with no HN
            thread carries a portable Nostr discussion keyed to its URL. The tab
            count is deliberately NOT a blend of HN + Nostr — it hints the native
            count when present, else the Nostr count; the two streams are counted
            separately inside the panel. */}
        <div className="px-4 pb-2 shrink-0 border-b border-border/30">
          <PageTabs
            ariaLabel="Reader views"
            active={activeTab}
            onChange={(key) => { setActiveTab(key as "article" | "comments"); scrollToTop(); }}
            tabs={[
              isPodcastReader
                ? { key: "article", label: "Listen", icon: Headphones, testId: "tab-listen" }
                : { key: "article", label: "Article", icon: BookOpen, testId: "tab-article" },
              {
                key: "comments",
                label: "Discussion",
                icon: MessageSquare,
                testId: "tab-comments",
                count: hnData ? (hnData.commentCount || hnData.comments.length) : (nostrCount || undefined),
              },
            ]}
          />
        </div>

        <div ref={contentRef} className="flex-1 overflow-y-auto">
          {activeTab === "article" && isPodcastReader && podcastTrack && (
            <div className="px-4 py-8 sm:px-8 flex flex-col items-center text-center gap-5" data-testid="container-listen">
              {podcastTrack.coverUrl && (
                <img
                  src={podcastTrack.coverUrl}
                  alt=""
                  className="w-56 h-56 sm:w-64 sm:h-64 rounded-2xl object-cover shadow-lg shadow-black/10"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    if (!img.src.includes("/api/rss/image-proxy")) {
                      img.src = `/api/rss/image-proxy?url=${encodeURIComponent(podcastTrack.coverUrl)}`;
                    } else {
                      img.style.display = "none";
                    }
                  }}
                />
              )}
              <div className="space-y-1 max-w-md">
                <h1 className="text-lg sm:text-xl font-bold leading-snug" data-testid="text-listen-title">{podcastTrack.title}</h1>
                {podcastTrack.artist && podcastTrack.artist !== "Podcast" && (
                  <p className="text-sm text-muted-foreground">{podcastTrack.artist}</p>
                )}
              </div>
              <Button
                size="lg"
                className="gap-2 rounded-full px-8 font-brand uppercase tracking-widest"
                onClick={playEpisode}
                data-testid="button-play-episode"
              >
                {isCurrentEpisode && isPlaying
                  ? (<><Pause className="w-5 h-5" /> Pause</>)
                  : (<><Play className="w-5 h-5" /> Play episode</>)}
              </Button>
              {podcastTrack.description && (
                <p className="text-sm text-foreground/70 max-w-md leading-relaxed text-left">
                  {stripHtml(podcastTrack.description).slice(0, 500)}
                </p>
              )}
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground/70 underline underline-offset-2"
                data-testid="link-episode-page"
              >
                Open the episode page
              </a>
            </div>
          )}
          {activeTab === "article" && !isPodcastReader && (
            <div className="px-4 py-4 sm:px-8 sm:py-6">
              {isLoadingArticle ? (
                <div className="flex flex-col items-center justify-center py-16" data-testid="container-article-loading">
                  <RelayOutpostLoader size="md" label="Loading article..." />
                </div>
              ) : articleError ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3" data-testid="container-article-error">
                  {item.description && item.description.length > 20 ? (
                    <div className="w-full max-w-lg mb-4">
                      <h2 className="text-lg font-bold mb-3" data-testid="text-fallback-title">{item.title}</h2>
                      {(item.author || timeAgo) && (
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          {item.author && <span className="text-xs text-muted-foreground">{item.author}</span>}
                          {timeAgo && <span className="text-[11px] text-muted-foreground/60">{timeAgo}</span>}
                        </div>
                      )}
                      {item.thumbnail && (
                        <img
                          src={item.thumbnail}
                          alt=""
                          className="w-full rounded-md mb-4 max-h-64 object-cover"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (!img.src.includes('/api/rss/image-proxy')) {
                              img.src = `/api/rss/image-proxy?url=${encodeURIComponent(item.thumbnail)}`;
                            } else {
                              img.style.display = "none";
                            }
                          }}
                        />
                      )}
                      <div
                        className="text-sm text-foreground/80 leading-relaxed mb-4 [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-words"
                        onClick={handleEmbedClick}
                        onKeyDown={handleEmbedKeyDown}
                        dangerouslySetInnerHTML={{ __html: enrichedDescriptionHtml }}
                      />
                      <div className="border-t border-border/30 pt-4 flex flex-col items-center gap-2">
                        <p className="text-xs text-muted-foreground/70">Full article available on the original site</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {item.title && <h2 className="text-lg font-bold text-center max-w-lg mb-1" data-testid="text-fallback-title">{item.title}</h2>}
                      <p className="text-sm text-muted-foreground text-center">This article can’t be shown here.</p>
                      <p className="text-xs text-muted-foreground/70 text-center max-w-xs">The site doesn’t allow in-app reading — but the conversation lives on Relay Outpost.</p>
                    </>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <Button size="sm" className="font-brand uppercase tracking-widest text-xs gap-1.5" onClick={() => setActiveTab("comments")} data-testid="button-see-discussion-fallback">
                      <MessageSquare className="w-3.5 h-3.5" />
                      See the discussion
                    </Button>
                    <a href={item.link} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="font-brand uppercase tracking-widest text-xs" data-testid="button-open-original-fallback">
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        Open Original
                      </Button>
                    </a>
                  </div>
                </div>
              ) : articleData ? (
                <div data-testid="container-article-content">
                  {articleData.siteName && (
                    <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70 mb-2">{articleData.siteName}</p>
                  )}
                  <h1 className="text-lg sm:text-xl font-bold leading-snug mb-3" data-testid="text-article-title">
                    {articleData.title || item.title}
                  </h1>
                  {(articleData.byline || item.author) && (
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <User className="w-3.5 h-3.5 text-muted-foreground/70" />
                      <span className="text-xs text-muted-foreground">{articleData.byline || item.author}</span>
                      {timeAgo && (
                        <>
                          <span className="text-muted-foreground/50 text-[11px]">/</span>
                          <Clock className="w-3 h-3 text-muted-foreground/60" />
                          <span className="text-[11px] text-muted-foreground/70">{timeAgo}</span>
                        </>
                      )}
                    </div>
                  )}
                  <div
                    className="rss-article-content prose prose-sm dark:prose-invert max-w-none text-foreground/80 leading-relaxed [&_img]:rounded-md [&_img]:max-w-full [&_img]:h-auto [&_img]:my-4 [&_img]:block [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-words [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:mb-3 [&_p]:text-sm [&_p]:break-words [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:text-sm [&_li]:mb-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border/50 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_pre]:bg-muted/30 [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:max-w-full [&_code]:text-xs [&_code]:break-words [&_figure]:my-4 [&_figure]:max-w-full [&_figcaption]:text-xs [&_figcaption]:text-muted-foreground/80 [&_figcaption]:mt-2 [&_table]:w-full [&_table]:text-xs [&_table]:block [&_table]:overflow-x-auto [&_th]:text-left [&_th]:p-2 [&_th]:border-b [&_th]:border-border/40 [&_td]:p-2 [&_td]:border-b [&_td]:border-border/20 [&_iframe]:max-w-full [&_iframe]:rounded-md [&_video]:max-w-full [&_video]:rounded-md"
                    onClick={handleEmbedClick}
                    onKeyDown={handleEmbedKeyDown}
                    dangerouslySetInnerHTML={{ __html: enrichedArticleHtml }}
                    data-testid="text-article-body"
                  />
                </div>
              ) : null}
            </div>
          )}

          {activeTab === "comments" && (
            <div className="px-4 py-4 sm:px-8 sm:py-6">
              {/* HN thread — read-only, kept exactly as-is and stacked ABOVE the
                  Nostr discussion. HN usernames are plain text (not Nostr
                  identities): no avatar, no profile link. Only rendered when an
                  HN thread exists; a Nostr reply below never reaches HN. */}
              {isLoadingComments ? (
                <div className="flex flex-col items-center justify-center py-10" data-testid="container-comments-loading">
                  <RelayOutpostLoader size="md" label="Loading comments..." />
                </div>
              ) : hnData && hnData.comments.length > 0 ? (
                <div className="mb-8" data-testid="container-hn-comments">
                  <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border/30 flex-wrap">
                    <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground/70">On Hacker News · read-only</span>
                    <div className="flex items-center gap-1.5">
                      <ArrowUp className="w-3.5 h-3.5 text-muted-foreground/80" />
                      <span className="text-xs font-semibold">{hnData.points} points</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/80" />
                      <span className="text-xs text-muted-foreground" data-testid="text-hn-count">{hnData.commentCount} on HN</span>
                    </div>
                    {hnData.hnUrl && (
                      <a href={hnData.hnUrl} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0">
                        <Badge variant="outline" className="text-[11px] no-default-active-elevate gap-1">
                          <ExternalLink className="w-2.5 h-2.5" />
                          View on HN
                        </Badge>
                      </a>
                    )}
                  </div>
                  <div className="divide-y divide-border/20 overflow-hidden" data-testid="container-comments-list">
                    {hnData.comments.map((comment) => (
                      <HNCommentThread key={comment.id} comment={comment} isMobile={isMobile} />
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Nostr discussion — always present (HN and non-HN alike). One
                  code path; degrades gracefully to Nostr-only when there is no
                  native thread. Counts are shown separately, never blended. */}
              <NostrDiscussion url={item.link} isMobile={isMobile} onCountChange={setNostrCount} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function RSSArticleCard({ item, onShare, onRead, isBookmarked, onToggleBookmark, feedTitle, feedImage, sourceName, sourceSiteUrl, isRead, onMarkRead, onFilterSource, density = "comfortable" }: { item: RSSItem; onShare: (item: RSSItem) => void; onRead: (item: RSSItem) => void; isBookmarked: boolean; onToggleBookmark: () => void; feedTitle?: string; feedImage?: string; sourceName?: string; sourceSiteUrl?: string; isRead?: boolean; onMarkRead?: (item: RSSItem) => void; onFilterSource?: (author: string) => void; density?: RssDensity }) {
  const isCompact = density === "compact";
  const cleanDescription = useMemo(() => stripHtml(item.description).slice(0, 250), [item.description]);
  const { play, currentTrack, isPlaying, togglePlay, playNext, addToQueue, currentTime: playerTime, duration: playerDuration } = useAudioPlayer();
  const timeAgo = useMemo(() => {
    if (!item.pubDate) return "";
    try {
      return formatDistanceToNow(new Date(item.pubDate), { addSuffix: true });
    } catch {
      return "";
    }
  }, [item.pubDate]);

  const podcastTrack: MusicTrack | null = useMemo(() => {
    if (!item.audioUrl) return null;
    return {
      id: `rss-${encodeURIComponent(item.audioUrl)}`,
      title: item.title || "Untitled Episode",
      artist: item.author || feedTitle || "Podcast",
      artistPubkey: "",
      audioUrl: item.audioUrl,
      coverUrl: item.thumbnail || feedImage || "",
      description: item.description || "",
      genre: "Podcast",
      duration: item.duration || 0,
      createdAt: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : 0,
      source: "podcast" as const,
      albumTitle: feedTitle || undefined };
  }, [item, feedTitle, feedImage]);

  const isCurrentPodcast = podcastTrack && currentTrack?.audioUrl === podcastTrack.audioUrl;

  const savedPosition = useMemo(() => {
    if (!podcastTrack) return null;
    if (isCurrentPodcast && !isPlaying && playerTime > 5) {
      return { time: playerTime, duration: playerDuration || item.duration || 0 };
    }
    if (isCurrentPodcast) return null;
    return getTrackPosition(podcastTrack.id);
  }, [podcastTrack, isCurrentPodcast, isPlaying, playerTime, playerDuration, item.duration]);

  const resumeLabel = useMemo(() => {
    if (!savedPosition || savedPosition.time < 5) return null;
    const t = Math.floor(savedPosition.time);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }, [savedPosition]);

  const progressPct = useMemo(() => {
    if (!savedPosition || !savedPosition.duration || savedPosition.duration <= 0) return 0;
    return Math.min(100, Math.max(0, (savedPosition.time / savedPosition.duration) * 100));
  }, [savedPosition]);

  // Queue actions for podcast episodes — reused in the compact kebab + the comfortable bar.
  const queueMenuItems = podcastTrack ? (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); playNext(podcastTrack); }}
        className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        data-testid={`button-play-next-${item.link}`}
      >
        <ListStart className="w-3.5 h-3.5" />
        Play next
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); addToQueue(podcastTrack); }}
        className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
        data-testid={`button-add-queue-${item.link}`}
      >
        <ListEnd className="w-3.5 h-3.5" />
        Add to queue
      </button>
    </>
  ) : null;

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("a") || target.closest("button[data-action]")) return;
    onRead(item);
  }, [item, onRead]);

  return (
    <Card
      className={`group glass-card hover-elevate cursor-pointer overflow-hidden transition-opacity ${isCompact ? "p-2 sm:p-2.5" : "p-3 sm:p-4"} ${isRead ? "opacity-60" : ""}`}
      onClick={handleCardClick}
      data-read={isRead ? "true" : "false"}
      data-testid={`card-rss-item-${item.link}`}
    >
      <div className={`flex ${isCompact ? "gap-2.5" : "gap-3"}`}>
        {(item.thumbnail || feedImage) && (
          <div className={`rounded-md overflow-hidden shrink-0 bg-muted/30 ${isCompact ? "w-12 h-12 sm:w-14 sm:h-14" : "w-20 h-16 sm:w-24 sm:h-18"}`}>
            <img
              src={item.thumbnail || feedImage || ""}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                const currentSrc = item.thumbnail || feedImage || "";
                if (!img.src.includes('/api/rss/image-proxy')) {
                  img.src = `/api/rss/image-proxy?url=${encodeURIComponent(currentSrc)}`;
                } else if (feedImage && item.thumbnail && img.src.includes(encodeURIComponent(item.thumbnail))) {
                  img.src = `/api/rss/image-proxy?url=${encodeURIComponent(feedImage)}`;
                } else {
                  img.style.display = "none";
                }
              }}
            />
          </div>
        )}
        <div className={`flex-1 min-w-0 ${isCompact ? "space-y-1" : "space-y-1.5"}`}>
          <h3
            className={`text-sm leading-snug flex items-start gap-1.5 ${isCompact ? "line-clamp-1" : "line-clamp-2"} ${isRead ? "font-medium text-muted-foreground" : "font-bold text-foreground"}`}
            data-testid={`link-rss-item-${item.link}`}
          >
            {!isRead && (
              <span
                className="mt-1 w-[7px] h-[7px] rounded-full bg-primary shrink-0"
                aria-label="Unread"
                data-testid={`indicator-unread-${item.link}`}
              />
            )}
            <span className="min-w-0">{item.title || "Untitled"}</span>
          </h3>

          {!isCompact && cleanDescription && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {cleanDescription}
            </p>
          )}

          <div className="flex items-center gap-1.5 flex-wrap">
            <SourceFavicon feedImage={feedImage} link={item.link} siteUrl={sourceSiteUrl} />
            {sourceName && (
              <span className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider truncate max-w-[140px]">
                {sourceName}
              </span>
            )}
            {!isCompact && item.author && (
              <>
                <span className="text-muted-foreground/40 text-[11px]">/</span>
                {onFilterSource ? (
                  <button
                    type="button"
                    data-action="filter-source"
                    onClick={(e) => { e.stopPropagation(); onFilterSource(item.author); }}
                    className="text-[11px] text-muted-foreground hover:text-brand font-mono uppercase tracking-wider truncate max-w-[120px] underline-offset-2 hover:underline transition-colors"
                    title={`Filter by ${item.author}`}
                    data-testid={`button-filter-author-${item.link}`}
                  >
                    {item.author}
                  </button>
                ) : (
                  <span className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider truncate max-w-[120px]">
                    {item.author}
                  </span>
                )}
              </>
            )}
            {timeAgo && (
              <>
                <span className="text-muted-foreground/40 text-[11px]">/</span>
                <span className="text-[11px] text-muted-foreground/80 font-mono">
                  {timeAgo}
                </span>
              </>
            )}
          </div>

          {!isCompact && item.categories.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {item.categories.slice(0, 3).map((cat, i) => (
                <Badge key={i} variant="outline" className="text-[11px] px-1.5 py-0">
                  {typeof cat === "string" ? cat : ""}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {isCompact && (
          <div className="flex items-center gap-0.5 shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
            {podcastTrack && (
              <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 sm:h-8 sm:w-8 ${isCurrentPodcast && isPlaying ? "text-brand" : resumeLabel ? "text-brand/80" : "text-muted-foreground"}`}
                data-action="play"
                onClick={(e) => { e.stopPropagation(); onMarkRead?.(item); isCurrentPodcast ? togglePlay() : play(podcastTrack); }}
                aria-label={isCurrentPodcast && isPlaying ? "Pause" : resumeLabel ? `Resume at ${resumeLabel}` : "Play"}
                title={isCurrentPodcast && isPlaying ? "Pause" : resumeLabel ? `Resume at ${resumeLabel}` : "Play"}
                data-testid={`button-play-podcast-${item.link}`}
              >
                {isCurrentPodcast && isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground"
                  data-action="more"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="More actions"
                  title="More actions"
                  data-testid={`button-more-rss-${item.link}`}
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1" onClick={(e) => e.stopPropagation()}>
                {queueMenuItems && (
                  <>
                    {queueMenuItems}
                    <div className="my-1 h-px bg-border/40" />
                  </>
                )}
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                  data-testid={`button-open-article-${item.link}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Original
                </a>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onShare(item); }}
                  className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                  data-testid={`button-share-rss-${item.link}`}
                >
                  <Share2 className="w-3.5 h-3.5" />
                  Share
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleBookmark(); }}
                  className={`flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm hover:bg-muted/50 transition-colors ${isBookmarked ? "text-brand" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid={`button-bookmark-rss-${item.link}`}
                >
                  {isBookmarked ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
                  {isBookmarked ? "Saved" : "Save"}
                </button>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {progressPct > 0 && (
        <div className={`mx-0 h-[2px] rounded-full bg-border/30 overflow-hidden ${isCompact ? "mt-1.5" : "mt-2"}`}>
          <div className="h-full rounded-full bg-primary/60 transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {!isCompact && (
      <div className="flex items-center gap-0.5 sm:gap-1 mt-2.5 sm:mt-3 pt-2 sm:pt-2.5 border-t border-border/30 flex-wrap">
        {podcastTrack && (
          <Button
            variant="ghost"
            size="sm"
            className={`text-xs font-brand uppercase tracking-widest h-7 px-1.5 sm:px-2 ${isCurrentPodcast && isPlaying ? "text-brand" : resumeLabel ? "text-brand/80" : "text-muted-foreground"}`}
            data-action="play"
            onClick={(e) => { e.stopPropagation(); onMarkRead?.(item); isCurrentPodcast ? togglePlay() : play(podcastTrack); }}
            aria-label={isCurrentPodcast && isPlaying ? "Pause" : resumeLabel ? `Resume at ${resumeLabel}` : "Play"}
            data-testid={`button-play-podcast-${item.link}`}
          >
            {isCurrentPodcast && isPlaying ? <Pause className="w-3.5 h-3.5 sm:mr-1.5" /> : <Play className="w-3.5 h-3.5 sm:mr-1.5" />}
            <span className="hidden sm:inline">{isCurrentPodcast && isPlaying ? "Playing" : resumeLabel ? "Resume" : "Play"}</span>
            {resumeLabel ? <span className="ml-1 opacity-70 text-[10px] sm:text-xs">{resumeLabel}</span> : item.duration ? <span className="ml-1 opacity-60 text-[10px] sm:text-xs">{item.duration >= 3600 ? `${Math.floor(item.duration / 3600)}h ${Math.floor((item.duration % 3600) / 60)}m` : `${Math.floor(item.duration / 60)}m`}</span> : null}
          </Button>
        )}
        {queueMenuItems && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-7 px-1.5 sm:px-2"
                data-action="more"
                onClick={(e) => e.stopPropagation()}
                aria-label="Queue actions"
                title="Queue actions"
                data-testid={`button-queue-rss-${item.link}`}
              >
                <ListEnd className="w-3.5 h-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-1" onClick={(e) => e.stopPropagation()}>
              {queueMenuItems}
            </PopoverContent>
          </Popover>
        )}
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          data-testid={`button-open-article-${item.link}`}
        >
          <Button variant="ghost" size="sm" className="text-xs font-brand uppercase tracking-widest text-muted-foreground h-7 px-1.5 sm:px-2" aria-label="Open original">
            <ExternalLink className="w-3.5 h-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Original</span>
          </Button>
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs font-brand uppercase tracking-widest text-muted-foreground h-7 px-1.5 sm:px-2"
          aria-label="Share"
          data-action="share"
          onClick={(e) => { e.stopPropagation(); onShare(item); }}
          data-testid={`button-share-rss-${item.link}`}
        >
          <Share2 className="w-3.5 h-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Share</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`text-xs font-brand uppercase tracking-widest ml-auto h-7 px-1.5 sm:px-2 ${isBookmarked ? "text-brand" : "text-muted-foreground"}`}
          aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
          data-action="bookmark"
          onClick={(e) => { e.stopPropagation(); onToggleBookmark(); }}
          data-testid={`button-bookmark-rss-${item.link}`}
        >
          {isBookmarked ? <BookmarkCheck className="w-3.5 h-3.5 sm:mr-1.5" /> : <Bookmark className="w-3.5 h-3.5 sm:mr-1.5" />}
          <span className="hidden sm:inline">{isBookmarked ? "Saved" : "Save"}</span>
        </Button>
      </div>
      )}
    </Card>
  );
}


// Editorial "Top story" card — the newest unread article, given full width and
// a large image. Tapping the body opens the reader (which marks it read). When
// the item is a podcast (has an audio/video enclosure) it gets a full playback
// treatment: a large play/pause button over the artwork, a Play/Resume pill with
// duration, and a resume-progress bar — same engine as the list cards.
// ── Stacked story card (multi-outlet cluster) ────────────────────────────────
// The cluster's lead article keeps its normal card treatment; a subtle stack
// visual + an "N sources" chip collapse the other outlets' versions of the
// SAME story behind a tap-to-expand list of compact rows. "N sources" is
// breadth of coverage, never a truth claim ("verified"/"confirmed" is banned
// copy). Unread math counts the cluster once (lead's read state); the expanded
// rows surface each member's own read state.
function memberTimeAgo(pubDate?: string): string {
  if (!pubDate) return "";
  try {
    return formatDistanceToNow(new Date(pubDate), { addSuffix: true });
  } catch {
    return "";
  }
}

function StackedStoryCard({
  leadCard,
  members,
  outletCount,
  isRead,
  onOpenMember,
}: {
  /** The lead item's normal card (rendered unchanged). */
  leadCard: React.ReactNode;
  /** The cluster's non-lead members, earliest → latest. */
  members: MergedItem<RSSItem>[];
  outletCount: number;
  isRead: (id: string) => boolean;
  onOpenMember: (item: RSSItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const chipLabel =
    outletCount > 1
      ? `${outletCount} sources`
      : `${members.length + 1} versions`;
  return (
    <div data-testid="stacked-story">
      <div className="relative">
        {/* Stack peek layers under the lead card. */}
        <div aria-hidden className="absolute inset-x-2 -bottom-1 h-2 rounded-b-lg border border-border/40 bg-card/60" />
        <div aria-hidden className="absolute inset-x-4 -bottom-2 h-2 rounded-b-lg border border-border/30 bg-card/40" />
        <div className="relative z-[1]">{leadCard}</div>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/70 hover:text-foreground transition-colors"
        data-testid="button-stack-toggle"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {chipLabel}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1" data-testid="stack-members">
          {members.map((m) => {
            const id = rssItemId(m.item);
            const read = isRead(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onOpenMember(m.item)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md border border-border/30 bg-card/40 text-left hover:bg-muted/40 transition-colors ${read ? "opacity-60" : ""}`}
                data-testid={`stack-member-${id}`}
              >
                {!read && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                <span className="text-[11px] font-medium text-muted-foreground shrink-0 max-w-[7rem] truncate">
                  {m.source.name || "Source"}
                </span>
                <span className={`text-xs flex-1 min-w-0 truncate ${read ? "text-muted-foreground" : "text-foreground"}`}>
                  {m.item.title}
                </span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0 hidden sm:inline">
                  {memberTimeAgo(m.item.pubDate)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RSSHeroCard({
  item, feedImage, feedTitle, sourceName, sourceSiteUrl, onRead, onMarkRead, onShare, isBookmarked, onToggleBookmark, feature = false,
}: {
  item: RSSItem;
  feedImage?: string;
  feedTitle?: string;
  sourceName?: string;
  sourceSiteUrl?: string;
  onRead: (item: RSSItem) => void;
  onMarkRead?: (item: RSSItem) => void;
  onShare: (item: RSSItem) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  /** Desktop "lead story" treatment: bigger headline/dek/padding via lg: classes
   *  only — off (the default) leaves the mobile + single-column hero unchanged. */
  feature?: boolean;
}) {
  const imageUrl = item.thumbnail || feedImage || "";
  const timeAgo = useMemo(() => {
    if (!item.pubDate) return "";
    try { return formatDistanceToNow(new Date(item.pubDate), { addSuffix: true }); }
    catch { return ""; }
  }, [item.pubDate]);
  const cleanDescription = useMemo(() => stripHtml(item.description).slice(0, 180), [item.description]);

  // ── Podcast playback (mirrors RSSArticleCard) ──
  const { play, currentTrack, isPlaying, togglePlay, currentTime: playerTime, duration: playerDuration } = useAudioPlayer();
  const podcastTrack: MusicTrack | null = useMemo(() => {
    if (!item.audioUrl) return null;
    return {
      id: `rss-${encodeURIComponent(item.audioUrl)}`,
      title: item.title || "Untitled Episode",
      artist: item.author || feedTitle || "Podcast",
      artistPubkey: "",
      audioUrl: item.audioUrl,
      coverUrl: item.thumbnail || feedImage || "",
      description: item.description || "",
      genre: "Podcast",
      duration: item.duration || 0,
      createdAt: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : 0,
      source: "podcast" as const,
      albumTitle: feedTitle || undefined };
  }, [item, feedTitle, feedImage]);
  const isCurrentPodcast = !!podcastTrack && currentTrack?.audioUrl === podcastTrack.audioUrl;
  const isThisPlaying = isCurrentPodcast && isPlaying;

  const savedPosition = useMemo(() => {
    if (!podcastTrack) return null;
    if (isCurrentPodcast && !isPlaying && playerTime > 5) {
      return { time: playerTime, duration: playerDuration || item.duration || 0 };
    }
    if (isCurrentPodcast) return null;
    return getTrackPosition(podcastTrack.id);
  }, [podcastTrack, isCurrentPodcast, isPlaying, playerTime, playerDuration, item.duration]);

  const resumeLabel = useMemo(() => {
    if (!savedPosition || savedPosition.time < 5) return null;
    const t = Math.floor(savedPosition.time);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }, [savedPosition]);

  const progressPct = useMemo(() => {
    if (!savedPosition || !savedPosition.duration || savedPosition.duration <= 0) return 0;
    return Math.min(100, Math.max(0, (savedPosition.time / savedPosition.duration) * 100));
  }, [savedPosition]);

  const durationLabel = useMemo(() => {
    if (!item.duration) return null;
    return item.duration >= 3600
      ? `${Math.floor(item.duration / 3600)}h ${Math.floor((item.duration % 3600) / 60)}m`
      : `${Math.floor(item.duration / 60)}m`;
  }, [item.duration]);

  const handlePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!podcastTrack) return;
    onMarkRead?.(item);
    isCurrentPodcast ? togglePlay() : play(podcastTrack);
  }, [podcastTrack, isCurrentPodcast, togglePlay, play, onMarkRead, item]);

  const playTitle = isThisPlaying ? "Pause" : resumeLabel ? `Resume at ${resumeLabel}` : "Play";

  return (
    <article
      className="group glass-card relative overflow-hidden rounded-2xl border transition-colors cursor-pointer"
      onClick={() => onRead(item)}
      data-testid="card-rss-hero"
    >
      {imageUrl && (
        <div className="relative w-full aspect-[16/9] overflow-hidden bg-muted/30">
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent pointer-events-none" />
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-primary/90 text-primary-foreground text-[10px] font-brand uppercase tracking-widest px-2.5 py-1 shadow-sm">
            {podcastTrack ? <Headphones className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
            Top story
          </span>
          {/* Large tap-to-play control over the artwork for podcast episodes. */}
          {podcastTrack && (
            <button
              type="button"
              onClick={handlePlay}
              className="absolute inset-0 flex items-center justify-center focus:outline-none"
              aria-label={playTitle}
              title={playTitle}
              data-testid="button-hero-play-overlay"
            >
              <span className="flex items-center justify-center w-16 h-16 rounded-full bg-black/45 backdrop-blur-sm border border-white/25 text-white shadow-lg transition-transform group-hover:scale-105 hover:bg-black/60">
                {isThisPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-0.5" />}
              </span>
            </button>
          )}
          {progressPct > 0 && (
            <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          )}
        </div>
      )}
      <div className={`p-4 sm:p-5 ${feature ? "lg:p-7" : ""}`}>
        <div className="flex items-center gap-2 mb-2 text-[11px] text-muted-foreground/80 min-w-0">
          <SourceFavicon feedImage={feedImage} link={item.link} siteUrl={sourceSiteUrl} className="w-4 h-4 shrink-0" />
          <span className="font-mono uppercase tracking-wider truncate">{sourceName || item.author || "Feed"}</span>
          {timeAgo && <span className="shrink-0">· {timeAgo}</span>}
        </div>
        <h2 className={`text-lg sm:text-xl font-semibold leading-snug text-foreground line-clamp-3 ${feature ? "lg:text-3xl lg:leading-[1.15] lg:font-bold" : ""}`} data-testid="text-rss-hero-title">
          {item.title || "Untitled"}
        </h2>
        {cleanDescription && (
          <p className={`mt-2 text-sm text-muted-foreground/85 line-clamp-2 ${feature ? "lg:text-base lg:line-clamp-3 lg:mt-3" : ""}`}>{cleanDescription}</p>
        )}
        <div className="mt-3 flex items-center gap-1">
          {podcastTrack && (
            <button
              type="button"
              onClick={handlePlay}
              className={`inline-flex items-center gap-2 h-9 pl-3 pr-4 rounded-full font-brand uppercase tracking-widest text-xs transition-colors ${
                isThisPlaying
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/15 text-primary hover:bg-primary/25"
              }`}
              aria-label={playTitle}
              title={playTitle}
              data-testid="button-hero-play"
            >
              {isThisPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isThisPlaying ? "Playing" : resumeLabel ? "Resume" : "Play"}</span>
              {(resumeLabel || durationLabel) && (
                <span className="opacity-70 normal-case tracking-normal font-mono text-[11px]">
                  {resumeLabel || durationLabel}
                </span>
              )}
            </button>
          )}
          <div className={podcastTrack ? "ml-auto flex items-center gap-1" : "flex items-center gap-1"}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleBookmark(); }}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground/70 hover:text-brand hover:bg-muted/50 transition-colors"
              aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
              data-testid="button-hero-bookmark"
            >
              {isBookmarked ? <BookmarkCheck className="w-4 h-4 text-brand" /> : <Bookmark className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onShare(item); }}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground/70 hover:text-brand hover:bg-muted/50 transition-colors"
              aria-label="Share"
              data-testid="button-hero-share"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

// ── Popular-podcasts shelf ───────────────────────────────────────────────────
// A horizontal showcase of each podcast show in the mix, rendered with the
// show's rich artwork. Tapping the card opens that SHOW's feed (all its
// episodes); the artwork's play button jumps straight into the latest episode.
// Lives at the top of the All/Top view so the popular shows are the first thing
// users see, across every category, alongside the trending-news thread below.
function PodcastShelfCard({ m, onOpenShow }: { m: MergedItem<RSSItem>; onOpenShow: (sourceUrl: string) => void }) {
  const item = m.item;
  const { play, currentTrack, isPlaying, togglePlay } = useAudioPlayer();
  // Prefer the SHOW cover (curated 600×600 preset artwork) over per-episode
  // thumbnails, which are spottier — the shelf is a recognizable-shows showcase.
  const art = m.source.feedImage || item.thumbnail || "";
  const track: MusicTrack | null = useMemo(() => {
    if (!item.audioUrl) return null;
    return {
      id: `rss-${encodeURIComponent(item.audioUrl)}`,
      title: item.title || "Untitled Episode",
      artist: item.author || m.source.name || "Podcast",
      artistPubkey: "",
      audioUrl: item.audioUrl,
      coverUrl: art,
      description: item.description || "",
      genre: "Podcast",
      duration: item.duration || 0,
      createdAt: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : 0,
      source: "podcast" as const,
      albumTitle: m.source.name || undefined,
    };
  }, [item, m.source.name, art]);
  const isCurrent = !!track && currentTrack?.audioUrl === track.audioUrl;
  const isThisPlaying = isCurrent && isPlaying;
  const onPlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!track) return;
    if (isCurrent) togglePlay(); else play(track);
  };
  return (
    <button
      type="button"
      onClick={() => onOpenShow(m.source.url)}
      className="group/pod shrink-0 w-[136px] sm:w-[150px] text-left snap-start"
      data-testid="podcast-shelf-card"
    >
      <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-muted/30 border border-border/40 shadow-sm">
        {art ? (
          <img
            src={art}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover/pod:scale-[1.03]"
            onError={(e) => {
              // Podcast CDN art hotlinks fine; if a host blocks it, retry once
              // through the image proxy, then give up gracefully.
              const el = e.currentTarget as HTMLImageElement;
              if (!el.dataset.proxied) { el.dataset.proxied = "1"; el.src = `/api/rss/image-proxy?url=${encodeURIComponent(art)}`; }
              else { el.style.visibility = "hidden"; }
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><Mic className="w-8 h-8 text-muted-foreground/30" /></div>
        )}
        <span
          role="button"
          tabIndex={0}
          onClick={onPlay}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPlay(e as unknown as React.MouseEvent); } }}
          className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center text-white shadow-md opacity-100 sm:opacity-0 sm:group-hover/pod:opacity-100 transition-opacity"
          aria-label={isThisPlaying ? "Pause" : "Play latest episode"}
          data-testid="podcast-shelf-play"
        >
          {isThisPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] font-semibold text-foreground/90 truncate">{m.source.name}</p>
      <p className="text-[11px] text-muted-foreground/60 leading-tight line-clamp-2">{item.title}</p>
    </button>
  );
}

function PodcastShelf({ items, onOpenShow }: { items: MergedItem<RSSItem>[]; onOpenShow: (sourceUrl: string) => void }) {
  if (items.length === 0) return null;
  return (
    <section data-testid="podcast-shelf">
      <div className="flex items-center gap-1.5 mb-2">
        <Headphones className="w-3.5 h-3.5 text-brand" />
        <span className="text-xs font-brand uppercase tracking-widest text-brand">Popular podcasts</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((m) => <PodcastShelfCard key={m.source.url} m={m} onOpenShow={onOpenShow} />)}
      </div>
    </section>
  );
}

/**
 * One compact row in the single-feed "playlist" view. A feed's own view no
 * longer uses the magazine spread (every podcast episode shares the same show
 * art, so it looked like a repetitive wall) — instead each item is a tight row:
 * play/number · title · date · duration. Tapping the row opens the reader (which
 * has a Listen tab for podcasts); the play chip plays the episode inline.
 */
function PlaylistEpisodeRow({ item, index, feedImage, feedTitle, isPodcast, read, onOpen, onMarkRead }: {
  item: RSSItem;
  index: number;
  feedImage?: string;
  feedTitle?: string;
  isPodcast: boolean;
  read: boolean;
  onOpen: (item: RSSItem) => void;
  onMarkRead: (item: RSSItem) => void;
}) {
  const { play, currentTrack, isPlaying, togglePlay } = useAudioPlayer();
  const track = useMemo<MusicTrack | null>(() => {
    if (!item.audioUrl) return null;
    return {
      id: `rss-${encodeURIComponent(item.audioUrl)}`,
      title: item.title || "Untitled Episode",
      artist: item.author || feedTitle || "Podcast",
      artistPubkey: "",
      audioUrl: item.audioUrl,
      coverUrl: item.thumbnail || feedImage || "",
      description: item.description || "",
      genre: "Podcast",
      duration: item.duration || 0,
      createdAt: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : 0,
      source: "podcast" as const,
      albumTitle: feedTitle || undefined,
    };
  }, [item, feedTitle, feedImage]);
  const isCurrent = !!track && currentTrack?.audioUrl === track.audioUrl;
  const dur = item.duration ? formatDuration(item.duration) : "";
  const when = useMemo(() => {
    try { return item.pubDate ? formatDistanceToNow(new Date(item.pubDate), { addSuffix: true }) : ""; } catch { return ""; }
  }, [item.pubDate]);

  return (
    <button
      type="button"
      onClick={() => { onMarkRead(item); onOpen(item); }}
      className={`group w-full flex items-center gap-3 py-2.5 text-left transition-colors hover:bg-muted/30 rounded-lg px-1 ${read ? "opacity-55" : ""}`}
      data-testid={`playlist-row-${index}`}
    >
      {isPodcast && track ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onMarkRead(item); isCurrent ? togglePlay() : play(track); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onMarkRead(item); isCurrent ? togglePlay() : play(track); } }}
          className="shrink-0 w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center hover:bg-brand/20 transition-colors"
          aria-label={isCurrent && isPlaying ? "Pause" : "Play"}
          data-testid={`playlist-play-${index}`}
        >
          {isCurrent && isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </span>
      ) : (
        <span className="shrink-0 w-9 text-right text-xs tabular-nums text-muted-foreground/40 pr-1">{index + 1}</span>
      )}
      <span className="flex-1 min-w-0">
        <span className={`block text-sm leading-snug line-clamp-2 ${read ? "" : "font-medium"}`}>{item.title || "Untitled"}</span>
        {/* Podcasts show the duration on the right; news items (no right slot)
            fold it into the meta line so it isn't lost. */}
        {(when || (!isPodcast && dur)) && (
          <span className="block text-[11px] text-muted-foreground/60 mt-0.5">
            {when}{when && !isPodcast && dur ? " · " : ""}{!isPodcast ? dur : ""}
          </span>
        )}
      </span>
      {isPodcast && dur && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">{dur}</span>
      )}
    </button>
  );
}

// News single-feed + All-feed stabilization helpers.
// Stable-order keys (module-level so they don't churn the memos below).
const bySourceUrl = (m: MergedItem<RSSItem>) => m.source.url;
const byMergedItemId = (m: MergedItem<RSSItem>) => rssItemId(m.item);

/**
 * Pin already-rendered items in place as more stream in. The merged feed
 * re-sorts on EVERY backfill arrival (~75 feeds trickle in over several seconds),
 * which visibly reshuffled the podcast shelf and the cards below it — "they load,
 * then start changing and replacing others." This freezes each item's slot the
 * first time it's seen; genuinely-new items append in arrival order, and items
 * that drop out are removed. So nothing that's already on screen jumps around.
 */
function useStableOrder<T>(items: T[], keyFn: (t: T) => string, resetKey: string = ""): T[] {
  const orderRef = useRef<Map<string, number>>(new Map());
  const nextRef = useRef(0);
  const lastResetRef = useRef(resetKey);
  return useMemo(() => {
    // A deliberate re-sort (sort mode / topic tab switch) SHOULD reorder; streaming
    // backfill should not. Reset the frozen order only when the resetKey changes.
    if (resetKey !== lastResetRef.current) {
      orderRef.current = new Map();
      nextRef.current = 0;
      lastResetRef.current = resetKey;
    }
    for (const it of items) {
      const k = keyFn(it);
      if (!orderRef.current.has(k)) orderRef.current.set(k, nextRef.current++);
    }
    const order = orderRef.current;
    return [...items].sort((a, b) => (order.get(keyFn(a)) ?? 0) - (order.get(keyFn(b)) ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, resetKey]);
}

/** Freeze the hero once chosen — a better story arriving in the backfill must not
 *  swap the lead card out from under the reader. Re-picks only if it disappears
 *  or the resetKey (sort/tab) changes. */
function useStableHero(hero: MergedItem<RSSItem> | null, present: MergedItem<RSSItem>[], resetKey: string = ""): MergedItem<RSSItem> | null {
  const ref = useRef<MergedItem<RSSItem> | null>(null);
  const lastResetRef = useRef(resetKey);
  return useMemo(() => {
    if (resetKey !== lastResetRef.current) { ref.current = null; lastResetRef.current = resetKey; }
    if (ref.current) {
      const id = rssItemId(ref.current.item);
      if (present.some((m) => rssItemId(m.item) === id)) return ref.current;
    }
    ref.current = hero;
    return hero;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero, present, resetKey]);
}

export default function RSSFeed({ embedded = false }: { embedded?: boolean } = {}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const isWide = useIsWide();
  // Desktop "magazine" front page (hero + secondary rail + card grid). Below lg
  // the reader stays the single centered column — mobile is unchanged. News is
  // always rendered embedded (inside Search's media hub), so we do NOT gate on
  // `embedded`; the width comes from a rail-aware full-bleed breakout below.
  const useMagazine = isWide;
  const { rssBookmarks, isRssBookmarked, toggleRssBookmark } = useRssBookmarks();
  const [, navigate] = useLocation();
  const { isRead, markRead, markAllRead } = useRssReadState();
  useDocumentTitle("News");
  const [feeds, setFeeds] = useState<SavedFeed[]>(loadAllFeeds);
  // "" = the merged "All feeds" thread (the default view); a url = single-source drill-in.
  const [activeFeedUrl, setActiveFeedUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(RSS_ACTIVE_FEED_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [shareCtx, setShareCtx] = useState<ShareContext | null>(null);
  const [readerItem, setReaderItem] = useState<RSSItem | null>(null);
  // The article reader is a full-screen overlay: Back must close IT, not the
  // News page under it (modal-back contract, lib/modal-history.ts).
  useBackClosable(!!readerItem, () => setReaderItem(null));
  // Which reader tab to open on. Normal card opens land on "article"; the
  // ?discuss= deep-link opens straight to "comments" (the Discussion tab).
  const [readerInitialTab, setReaderInitialTab] = useState<"article" | "comments">("article");
  // Reactive query string — drives the ?discuss= deep-link on both cold open and
  // in-app navigation (e.g. tapping a reply-alert notification).
  const discussSearch = useSearch();
  const [markAllConfirmOpen, setMarkAllConfirmOpen] = useState(false);
  const articlesRef = useRef<HTMLDivElement>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  // Source filter: narrows the active feed's items to a single author/source.
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  // Reader density: "comfortable" (rich cards) vs "compact" (dense inbox list).
  const [density, setDensity] = useRssDensity();
  // Merged-thread sort: unread-first (default) vs pure latest.
  const [sortMode] = useRssSortMode();
  // Selected News topic tab (All-feeds view only). "Top" = the full diversified
  // feed; a bucket key filters to that topic. Persisted across reloads.
  const [selectedBucket, setSelectedBucket] = useNewsTopic();
  // Live magazine-grid column count — the vertical diversity stride.
  const gridCols = useGridColumns();
  // Merged thread is the default when no single source is chosen.
  const isAllMode = activeFeedUrl === "";
  // How many cards of the merged thread to render (paginated so a 30-feed
  // library doesn't paint thousands of cards at once). Reset when inputs change.
  const MERGED_PAGE = 25;
  // Desktop magazine: how many stories sit in the secondary column beside the
  // lead hero (the rest flow into the card grid below).
  const MAGAZINE_RAIL = 3;
  const [mergedVisibleCount, setMergedVisibleCount] = useState(MERGED_PAGE);
  const [editingFeedUrl, setEditingFeedUrl] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");

  const feedParamHandledRef = useRef<string>("");

  useEffect(() => {
    if (feeds.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const feedParam = params.get("feed");

    if (feedParam && feedParam !== feedParamHandledRef.current) {
      feedParamHandledRef.current = feedParam;
      const allKnown = [...DEFAULT_FEEDS, ...EXTRA_DEFAULT_FEEDS, ...SUGGESTED_FEEDS];
      const match = feeds.find(f => f.url === feedParam) || allKnown.find(f => f.url === feedParam);
      if (match) {
        if (!feeds.some(f => f.url === match.url)) {
          addFeedToLibrary(match);
          setFeeds(loadAllFeeds());
        }
        setActiveFeedUrl(match.url);
        return;
      }
      const newFeed: SavedFeed = { name: feedParam.split("/").pop() || "Feed", url: feedParam, category: "Podcast" };
      addFeedToLibrary(newFeed);
      setFeeds(loadAllFeeds());
      setActiveFeedUrl(feedParam);
      return;
    }
    // No ?feed= param: leave activeFeedUrl as-is. "" keeps the merged "All feeds"
    // thread (the default); a persisted url reopens that single source.
  }, [feeds, activeFeedUrl]);

  // Persist the last picker choice ("" = All feeds) so News reopens where it was.
  useEffect(() => {
    try {
      localStorage.setItem(RSS_ACTIVE_FEED_KEY, activeFeedUrl);
    } catch {
      /* ignore */
    }
  }, [activeFeedUrl]);

  const [feedPopoverOpen, setFeedPopoverOpen] = useState(false);

  const handleSelectFeed = useCallback((url: string) => {
    setActiveFeedUrl(url);
    setFeedPopoverOpen(false);
    if (isMobile) {
      setTimeout(() => {
        articlesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [isMobile]);

  const existingUrls = useMemo(() => new Set(feeds.map(f => f.url)), [feeds]);

  const activeFeed = useMemo(() => feeds.find(f => f.url === activeFeedUrl), [feeds, activeFeedUrl]);

  // Clear any active source filter when switching feeds (the authors differ per feed).
  useEffect(() => { setSourceFilter(null); }, [activeFeedUrl]);

  const { data: feedData, isLoading, error, refetch, isFetching } = useQuery<RSSFeedData>({
    queryKey: ["/api/rss", activeFeedUrl],
    queryFn: async () => {
      if (!activeFeedUrl) throw new Error("No feed selected");
      const res = await fetch(`/api/rss?url=${encodeURIComponent(activeFeedUrl)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to fetch" }));
        throw new Error(err.error || "Failed to fetch feed");
      }
      return res.json();
    },
    enabled: !isAllMode && !!activeFeedUrl,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1 });

  // The merged "All feeds" firehose = QUALITY only: the audited rich news
  // flagships (NEWS_STARTER_FEEDS — full-text + images, never teasers) mixed with
  // the WHOLE popular-podcast library (ALL_PODCAST_FEEDS — every show carries good
  // artwork + copy), plus the user's own adds. Deliberately NOT the full news
  // library — the demoted teaser feeds (Variety, NPR World, Rolling Stone, CBS
  // Sports, Guardian World…) stay in discovery and never clutter the All view.
  // The feed picker still lists only `feeds` (the calm subscribed set).
  const allFeedSources = useMemo<SavedFeed[]>(() => {
    const hidden = loadHiddenDefaults();
    const byUrl = new Map<string, SavedFeed>();
    for (const f of NEWS_STARTER_FEEDS) if (!hidden.has(f.url)) byUrl.set(f.url, f);
    for (const f of ALL_PODCAST_FEEDS) if (!hidden.has(f.url)) byUrl.set(f.url, f);
    for (const f of feeds) if (!byUrl.has(f.url)) byUrl.set(f.url, f);
    return [...byUrl.values()];
  }, [feeds]);

  // ── Staged loading (perf) ───────────────────────────────────────────────────
  // The All view can source ~70 feeds. Fanning them all out on first paint is
  // slow and hammers weaker devices (70 /api/rss round-trips + scoring hundreds
  // of items at once). So fetch the CALM subscribed set first — the news
  // flagships + the flagship podcasts (`feeds`), the ~35 that always loaded
  // fast — then backfill the rest of the podcast library once the page is
  // interactive/idle. Everything still lands; it just streams in two waves.
  // Rolling backfill frontier: feeds in `allFeedSources` at an index below this
  // get fetched. Starts at 0 (only the front page + primed tabs load) and climbs
  // in small batches on an interval — so the ~75-feed long-tail streams in gently
  // instead of a single burst that hammered /api/rss (and starved sibling APIs).
  const [backfillLimit, setBackfillLimit] = useState(0);
  // Wave 1 (first paint) = the curated FRONT PAGE (~12: one marquee feed per
  // topic tab + flagship podcasts) PLUS the user's OWN custom subscriptions (so
  // their adds are never delayed). The rest of the ~90-feed default library
  // backfills on idle — this is what cut first paint from a ~36-request stampede.
  const primaryFeedUrls = useMemo(() => {
    const s = new Set<string>(NEWS_FRONT_PAGE_URLS);
    for (const f of feeds) if (!PRESET_FEED_URLS.has(f.url)) s.add(f.url);
    return s;
  }, [feeds]);
  // Each feed's topic bucket, for lazy per-tab priming.
  const bucketByUrl = useMemo(() => {
    const m = new Map<string, NewsBucket | null>();
    for (const f of allFeedSources) m.set(f.url, categoryToBucket(f.category));
    return m;
  }, [allFeedSources]);
  // Tapping a topic tab primes THAT bucket's feeds immediately (ahead of the
  // idle backfill), so a tab opened early fills fast instead of waiting ~2.5s.
  const [primedBuckets, setPrimedBuckets] = useState<Set<NewsBucket>>(new Set());
  useEffect(() => {
    if (selectedBucket && selectedBucket !== "Top") {
      setPrimedBuckets((prev) => (prev.has(selectedBucket) ? prev : new Set(prev).add(selectedBucket)));
    }
  }, [selectedBucket]);
  useEffect(() => {
    if (!isAllMode) return;
    const total = allFeedSources.length;
    const BATCH = 6;          // feeds added to the frontier per tick
    const INTERVAL_MS = 400;  // ≈15 feeds/sec — gentle vs. the old ~75 at once
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let intervalId: number | undefined;
    const startRamp = () => {
      intervalId = window.setInterval(() => {
        setBackfillLimit((n) => {
          if (n >= total) {
            if (intervalId !== undefined) { window.clearInterval(intervalId); intervalId = undefined; }
            return n;
          }
          const next = n + BATCH;
          if (next >= total && intervalId !== undefined) { window.clearInterval(intervalId); intervalId = undefined; }
          return next;
        });
      }, INTERVAL_MS);
    };
    // Only start ramping once the page is interactive so first paint stays fast.
    const t = window.setTimeout(startRamp, 2500);
    let idleId: number | undefined;
    if (w.requestIdleCallback) {
      idleId = w.requestIdleCallback(() => { window.clearTimeout(t); startRamp(); }, { timeout: 2500 });
    }
    return () => {
      window.clearTimeout(t);
      if (idleId !== undefined && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [isAllMode, allFeedSources.length]);

  // ── Merged "All feeds" thread ──────────────────────────────────────────────
  // Fetch every news feed in PARALLEL, each with the SAME per-feed query key as
  // the single-source view above so the cache is shared: a feed fetched here is
  // instant when the user drills into it (and vice-versa). Only enabled in All
  // mode so a single-source drill-in doesn't fan out the whole library.
  const feedQueries = useQueries({
    queries: allFeedSources.map((f, i) => {
      const bucket = bucketByUrl.get(f.url);
      // A feed fetches when it's on the front page (wave 1), OR its topic tab has
      // been tapped (lazy prime), OR the rolling backfill frontier has reached it.
      // This keeps first paint to ~12 requests and streams the long-tail gently.
      const shouldFetch = primaryFeedUrls.has(f.url) || (!!bucket && primedBuckets.has(bucket)) || i < backfillLimit;
      return {
        queryKey: ["/api/rss", f.url],
        queryFn: async () => {
          const res = await fetch(`/api/rss?url=${encodeURIComponent(f.url)}`);
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Failed to fetch" }));
            throw new Error(err.error || "Failed to fetch feed");
          }
          return res.json() as Promise<RSSFeedData>;
        },
        enabled: isAllMode && !!f.url && shouldFetch,
        staleTime: 10 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 1,
      };
    }),
  });

  // The remembered "latest edition" — read synchronously on mount so the News
  // page paints its last screen instantly instead of waiting on the network.
  const [restoredEdition] = useState<MergedItem<RSSItem>[]>(() => loadEdition() as MergedItem<RSSItem>[]);

  // Flatten + dedup the feeds that have resolved so far (renders progressively).
  const liveMergedItems = useMemo(() => {
    if (!isAllMode) return [] as MergedItem<RSSItem>[];
    const perFeed = allFeedSources.map((f, i) => {
      const data = feedQueries[i]?.data as RSSFeedData | undefined;
      const source: MergeSource = {
        url: f.url,
        name: f.name || data?.title,
        feedImage: f.feedImage || data?.image,
        siteUrl: f.siteUrl || data?.link,
      };
      // Cap each feed to its NEWEST items before merging. In a newest-first
      // firehose a single feed's deep back-catalog never surfaces, so keeping
      // all of it just bloats the merge/score/cluster passes and memory — a
      // real risk on weaker devices. Sort desc by date so the cap keeps the
      // freshest regardless of the feed's own ordering.
      const items = (data?.items ?? []) as RSSItem[];
      const capped = items.length > MAX_ITEMS_PER_FEED
        ? [...items].sort((a, b) => (Date.parse(b.pubDate || "") || 0) - (Date.parse(a.pubDate || "") || 0)).slice(0, MAX_ITEMS_PER_FEED)
        : items;
      return { source, items: capped };
    });
    return mergeFeedItems(perFeed);
    // feedQueries identity changes each render; key off the resolved data + sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllMode, allFeedSources, feedQueries.map((q) => q.dataUpdatedAt).join(",")]);

  // "Latest edition": overlay the remembered snapshot UNDER the live feeds so the
  // page is instant on open and never flashes empty / shrinks while feeds stream
  // in. Converges to pure live once the feeds are a superset of what was stored.
  const mergedItems = useMemo(
    () => (isAllMode ? mergeEditions(liveMergedItems, restoredEdition) : liveMergedItems),
    [isAllMode, liveMergedItems, restoredEdition],
  );

  // Persist the live edition (debounced) whenever it meaningfully updates, so the
  // NEXT open paints instantly. Only the live set is stored — never the restored
  // overlay — so old items age out instead of accumulating forever.
  useEffect(() => {
    if (!isAllMode || liveMergedItems.length === 0) return;
    const t = window.setTimeout(() => saveEdition(liveMergedItems), 1500);
    return () => window.clearTimeout(t);
  }, [isAllMode, liveMergedItems]);

  const mergedLoading = isAllMode && feedQueries.some((q) => q.isLoading);

  // ── Story clustering (lib/story-cluster) ──────────────────────────────────
  // Multi-outlet coverage of the same story collapses into ONE stacked card.
  // Pure local computation over the already-merged list; clusterStories memoizes
  // on the item-id set, so refreshes that deliver the same items are free (the
  // useMemo below re-runs on refetch ticks but hits that memo).
  const storyClusters = useMemo<StoryCluster[]>(() => {
    if (!isAllMode || mergedItems.length === 0) return [];
    return clusterStories(
      mergedItems.map((m) => ({
        id: rssItemId(m.item),
        title: m.item.title,
        description: m.item.description,
        sourceUrl: m.source.url,
        pubDate: m.item.pubDate,
      }))
    );
  }, [isAllMode, mergedItems]);

  // Per-item cluster lookup + the set of non-lead members of multi-item
  // clusters ("stacked members") — those render inside their lead's stack, not
  // as standalone cards, and never count toward unread (cluster counts ONCE,
  // read = lead read).
  const { clusterByItemId, stackedMemberIds } = useMemo(() => {
    const byId = new Map<string, StoryCluster>();
    const memberIds = new Set<string>();
    for (const c of storyClusters) {
      for (const id of c.itemIds) {
        byId.set(id, c);
        if (c.itemIds.length > 1 && id !== c.leadItemId) memberIds.add(id);
      }
    }
    return { clusterByItemId: byId, stackedMemberIds: memberIds };
  }, [storyClusters]);

  const mergedItemById = useMemo(() => {
    const map = new Map<string, MergedItem<RSSItem>>();
    for (const m of mergedItems) map.set(rssItemId(m.item), m);
    return map;
  }, [mergedItems]);

  // The thread's working list: clusters collapsed to their lead item.
  const mergedCollapsedItems = useMemo(
    () => mergedItems.filter((m) => !stackedMemberIds.has(rssItemId(m.item))),
    [mergedItems, stackedMemberIds]
  );

  // Raw unread total — counts each story CLUSTER once (lead's read state).
  const mergedTotalUnread = useMemo(
    () => countUnread(mergedCollapsedItems, (it) => isRead(rssItemId(it))),
    [mergedCollapsedItems, isRead]
  );

  // ── Smart alert scoring (tier 1–2 = alerts; tier 4 = source-view only) ────
  const alertPrefs = useNewsAlertPrefs();

  // Currently-trending shows (Podcast Index trend cache). Degrades to nothing
  // when the proxy is unconfigured/erroring — scoring just skips the factor.
  const { data: trendingData } = useQuery<{ suggestions: TrendSuggestionItem[] }>({
    queryKey: ["/api/podcastindex/trend-suggestions", "news-alerts"],
    queryFn: async () => {
      try {
        const res = await fetch(buildTrendSuggestionsUrl(null, 10));
        if (!res.ok) return { suggestions: [] };
        return (await res.json()) as { suggestions: TrendSuggestionItem[] };
      } catch {
        return { suggestions: [] };
      }
    },
    enabled: isAllMode,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const feedByUrl = useMemo(() => new Map(allFeedSources.map((f) => [f.url, f])), [allFeedSources]);

  // Score every collapsed story once per input change (cluster leads stand in
  // for their stacks and carry the corroboration boost). Index-free: results
  // carry their MergedItem so the strip can open/mark the underlying article.
  const scoredMerged = useMemo<NewsScored[]>(() => {
    if (!isAllMode || mergedCollapsedItems.length === 0) return [];
    // Followed individual creators: user-added podcasts + curated preset shows.
    const presetKeys = presetShowTitleKeys();
    const followed: string[] = [];
    for (const f of allFeedSources) {
      if (f.category === "Podcast" || presetKeys.has(normalizeShowTitle(f.name))) followed.push(f.url);
    }
    // Prior engagement from the read ledger: a source counts as engaged when
    // any of its currently-loaded items has been read.
    const engaged = new Set<string>();
    for (const m of mergedItems) {
      if (isRead(rssItemId(m.item))) engaged.add(m.source.url);
    }
    const trendingKeys = (trendingData?.suggestions ?? [])
      .map((s) => normalizeShowTitle(s.title))
      .filter(Boolean);
    const scorables: NewsScorable[] = mergedCollapsedItems.map((m) => {
      const id = rssItemId(m.item);
      return {
        id,
        title: m.item.title,
        description: m.item.description,
        sourceUrl: m.source.url,
        sourceName: m.source.name,
        sourceCategory: feedByUrl.get(m.source.url)?.category,
        author: m.item.author,
        isPodcast: !!m.item.audioUrl,
        durationSec: m.item.duration,
        outletCount: clusterByItemId.get(id)?.outletCount ?? 1,
        merged: m,
      };
    });
    return scoreNewsItems(scorables, {
      savedCategoryKeys: allFeedSources.map((f) => f.category),
      followedCreatorUrls: followed,
      trendingSourceKeys: trendingKeys,
      engagedSourceUrls: engaged,
      mutedSourceUrls: alertPrefs.mutedSources,
      mutedKeywords: alertPrefs.mutedKeywords,
      onlyPresets: alertPrefs.onlyPresets,
      onlyFollowedCreators: alertPrefs.onlyCreators,
    });
    // Depend on the individual pref fields (stable refs from the prefs store)
    // so re-renders don't re-score the whole thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAllMode,
    mergedItems,
    mergedCollapsedItems,
    clusterByItemId,
    allFeedSources,
    feedByUrl,
    trendingData,
    isRead,
    alertPrefs.mutedSources,
    alertPrefs.mutedKeywords,
    alertPrefs.onlyPresets,
    alertPrefs.onlyCreators,
  ]);

  const scoredById = useMemo(() => {
    const map = new Map<string, NewsScored>();
    for (const s of scoredMerged) map.set(s.item.id, s);
    return map;
  }, [scoredMerged]);

  // Tier-4 filtering: low-priority items live only in their source's own feed
  // view. Cold-start guard: with zero read history there is no engagement
  // signal yet, so nothing is hidden until the user has actually used News.
  const hasReadHistory = useMemo(
    () => mergedItems.some((m) => isRead(rssItemId(m.item))),
    [mergedItems, isRead]
  );
  const mergedVisibleItems = useMemo(() => {
    if (!isAllMode || scoredById.size === 0) return mergedCollapsedItems;
    return mergedCollapsedItems.filter((m) => {
      const s = scoredById.get(rssItemId(m.item));
      if (!s || s.tier !== "low") return true;
      // Muted/thin items always hide; other low scorers hide once the user has
      // read history (before that, hiding would empty a fresh account's feed).
      return !(s.muted || s.factors.includes("thinContent") || hasReadHistory);
    });
  }, [isAllMode, mergedCollapsedItems, scoredById, hasReadHistory]);

  // Popular-podcasts shelf: the freshest episode from each show currently in the
  // mix (podcast presets carry rich artwork + copy), newest show first, capped.
  // A guaranteed, always-visible showcase at the top of the All/Top view — the
  // scoring boost surfaces some inline, but the shelf makes the top shows
  // impossible to miss regardless of when their latest episode dropped.
  const podcastShelfRaw = useMemo<MergedItem<RSSItem>[]>(() => {
    if (!isAllMode) return [];
    const byShow = new Map<string, MergedItem<RSSItem>>();
    for (const m of mergedItems) {
      // Actual podcast SHOWS only (a curated podcast preset) — not news outlets
      // that happen to attach an audio version to an article.
      if (!m.item.audioUrl || !PODCAST_FEED_URLS.has(m.source.url)) continue;
      // Skip sub-3-min clips/trailers — the shelf should headline real episodes.
      const dur = m.item.duration || 0;
      if (dur > 0 && dur < 180) continue;
      const prev = byShow.get(m.source.url);
      const t = Date.parse(m.item.pubDate || "") || 0;
      const pt = prev ? (Date.parse(prev.item.pubDate || "") || 0) : -1;
      if (!prev || t > pt) byShow.set(m.source.url, m);
    }
    return [...byShow.values()]
      .sort((a, b) => (Date.parse(b.item.pubDate || "") || 0) - (Date.parse(a.item.pubDate || "") || 0))
      .slice(0, 14);
  }, [isAllMode, mergedItems]);
  // Freeze the shelf order so shows don't reshuffle as podcast feeds stream in.
  // (Shelf is Top-only + always "freshest per show", so it never needs a re-sort.)
  const podcastShelf = useStableOrder(podcastShelfRaw, bySourceUrl);

  // ── News topic tabs (canonical taxonomy) ──────────────────────────────────
  // Map each source url → its feed's category, then fold that onto a canonical
  // bucket (lib/news-categories). The tab bar shows "Top" plus only the buckets
  // that currently have ≥1 article; a stale/renamed selection falls back to Top.
  const feedCatByUrl = useMemo(
    () => new Map(allFeedSources.map((f) => [f.url, f.category])),
    [allFeedSources]
  );
  const presentBuckets = useMemo(() => {
    if (!isAllMode) return [] as NewsBucket[];
    const present = new Set<NewsBucket>();
    for (const m of mergedVisibleItems) {
      const b = articleCategory(m, feedCatByUrl);
      if (b) present.add(b);
    }
    return NEWS_BUCKETS.filter((b) => present.has(b));
  }, [isAllMode, mergedVisibleItems, feedCatByUrl]);
  // The bucket actually in effect: the selection if it still has articles, else
  // Top (so the view never gets stuck on an empty/vanished topic).
  const effectiveBucket: NewsBucket | "Top" =
    selectedBucket !== "Top" && presentBuckets.includes(selectedBucket)
      ? selectedBucket
      : "Top";
  // The tab-filtered universe fed into the hero/sort/diversify/split pipeline so
  // every downstream surface (hero, grid, read-dimming, Caught-up) works per tab.
  // "Top" = the full set (the diversifier balances sources); a bucket = only its
  // articles.
  const categoryItems = useMemo(() => {
    if (!isAllMode) return mergedVisibleItems;
    // "Top" firehose: show ONE card per source so a prolific show (e.g. 3 fresh
    // podcast episodes) or wire feed can't repeat down the feed. The list is
    // already in best-first order, so the survivor is each source's top item.
    if (effectiveBucket === "Top") return capPerSource(mergedVisibleItems, (m) => m.source.url, 1);
    return mergedVisibleItems.filter((m) => articleCategory(m, feedCatByUrl) === effectiveBucket);
  }, [isAllMode, mergedVisibleItems, effectiveBucket, feedCatByUrl]);

  // Tier 1–2 unread — the alerting slice that feeds the "Worth your time"
  // cluster's digest groups. There is no aggregate "everything-unread" total
  // anywhere on the page; only this bounded priority slice surfaces.
  const alertScored = useMemo(
    () =>
      scoredMerged.filter(
        (s) => ALERTING_TIERS.includes(s.tier) && !isRead(s.item.id)
      ),
    [scoredMerged, isRead]
  );
  // THE News unread count (the fatigue fix): tier 1–2 AND inside the shared
  // 72h freshness window (news-unread.ts — same policy as the Stories menu).
  // Older priority items stay readable in the strip; they just stop counting.
  const newsAlertUnread = useMemo(
    () =>
      countPriorityUnread(
        alertScored.map((s) => ({
          id: s.item.id,
          tier: s.tier,
          timeMs: Date.parse(s.item.merged.item.pubDate || ""),
          title: s.item.title,
        })),
        (id) => isRead(id),
        Date.now(),
      ).count,
    [alertScored, isRead]
  );
  const alertGroups = useMemo(() => buildDigestGroups(alertScored), [alertScored]);

  const handleMarkGroupRead = useCallback(
    (group: DigestGroup<NewsScorable>) => {
      markAllRead(group.items.map((s) => s.item.id));
    },
    [markAllRead]
  );

  // Hero + ordered thread for the merged view (over the tier-filtered slice,
  // then narrowed to the selected topic). Story stacks are excluded from hero
  // candidacy: the stack's expand UI lives on the in-list card, so a
  // multi-version story always renders there.
  const mergedHeroRaw = useMemo(
    () =>
      pickHero(
        categoryItems.filter(
          (m) => (clusterByItemId.get(rssItemId(m.item))?.itemIds.length ?? 1) === 1
        ),
        (it) => isRead(rssItemId(it))
      ),
    [categoryItems, clusterByItemId, isRead]
  );
  // Keep the lead story fixed once picked — don't swap it as the backfill arrives.
  const mergedHero = useStableHero(mergedHeroRaw, categoryItems, `${sortMode}|${effectiveBucket}`);
  const mergedSorted = useMemo(
    () => sortMergedItems(categoryItems, sortMode, (it) => isRead(rssItemId(it))),
    [categoryItems, sortMode, isRead]
  );
  // Everything below the hero, in the chosen order (hero pulled out to lead),
  // then a source-diversity pass so one outlet never runs back-to-back while
  // other outlets have stories waiting (read/unread segments kept separate).
  // The "Top" mixed stream additionally caps each source's share so a firehose
  // outlet can't dominate; a single topic's tab keeps only the linear diversity.
  const mergedRestRaw = useMemo(
    () =>
      interleaveMergedSources(
        mergedSorted.filter((m) => m.item !== mergedHero?.item),
        sortMode,
        (it) => isRead(rssItemId(it)),
        effectiveBucket === "Top" ? TOP_SOURCE_CAP : undefined,
      ),
    [mergedSorted, mergedHero, sortMode, isRead, effectiveBucket]
  );
  // Freeze card positions so streaming backfill doesn't reshuffle the list; new
  // items append instead of re-sorting into what's already visible. A sort/tab
  // switch (resetKey) re-orders deliberately.
  const mergedRest = useStableOrder(mergedRestRaw, byMergedItemId, `${sortMode}|${effectiveBucket}`);
  // Index of the first read card, so unread-first mode can show a "Caught up"
  // divider (latest mode is a flat chronological list, no divider).
  const mergedReadBoundary = useMemo(() => {
    if (sortMode !== "unread-first") return -1;
    return mergedRest.findIndex((m) => isRead(rssItemId(m.item)));
  }, [mergedRest, sortMode, isRead]);
  // Paginate the rendered slice.
  const mergedVisible = useMemo(
    () => mergedRest.slice(0, mergedVisibleCount),
    [mergedRest, mergedVisibleCount]
  );

  // Reset pagination only when the thread's FILTER context changes (source
  // mode, sort mode, topic bucket) — NOT when the item count changes. The
  // merged feed streams in over several seconds (feeds resolve on a backfill
  // ramp) and pull-to-refresh rebuilds it; keying the reset on
  // `mergedVisibleItems.length` snapped the visible slice back to page 1 on
  // every one of those ticks, truncating cards out from under a user who had
  // scrolled or hit "Load more". Excluding length keeps their position stable
  // while new items append below.
  useEffect(() => {
    setMergedVisibleCount(MERGED_PAGE);
  }, [isAllMode, sortMode, effectiveBucket]);

  // Refresh: All mode re-fetches every feed; single mode re-fetches the one.
  const mergedFetching = isAllMode && feedQueries.some((q) => q.isFetching);
  const handleRefresh = useCallback(() => {
    if (isAllMode) {
      feedQueries.forEach((q) => q.refetch());
    } else {
      refetch();
    }
  }, [isAllMode, feedQueries, refetch]);

  // Items actually shown, after applying the source (author) filter.
  const visibleItems = useMemo(() => {
    const items = feedData?.items ?? [];
    if (!sourceFilter) return items;
    return items.filter((it) => (it.author || "") === sourceFilter);
  }, [feedData, sourceFilter]);

  const visibleUnreadCount = useMemo(
    () => visibleItems.reduce((n, it) => (isRead(rssItemId(it)) ? n : n + 1), 0),
    [visibleItems, isRead]
  );

  // Editorial split: newest unread (with an image) becomes the "Top story" hero;
  // remaining unread flow beneath; read items sink below a "caught up" divider,
  // dimmed in place. Feed order is preserved within each group (feeds arrive
  // newest-first). A hero only exists when there is something unread — it's
  // always a NEW story, never an already-read one.
  const { heroItem, unreadRest, readItems } = useMemo(() => {
    const unread: RSSItem[] = [];
    const read: RSSItem[] = [];
    for (const it of visibleItems) {
      (isRead(rssItemId(it)) ? read : unread).push(it);
    }
    const hero = unread.length ? (unread.find((it) => !!it.thumbnail) ?? unread[0]) : null;
    return {
      heroItem: hero,
      unreadRest: hero ? unread.filter((it) => it !== hero) : unread,
      readItems: read,
    };
  }, [visibleItems, isRead]);

  // Distinct authors in the active feed, for the source-filter dropdown.
  const feedAuthors = useMemo(() => {
    const seen = new Set<string>();
    for (const it of feedData?.items ?? []) {
      const a = (it.author || "").trim();
      if (a) seen.add(a);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [feedData]);

  const handleMarkAllVisibleRead = useCallback(() => {
    // A visible cluster lead marks its whole stack read (members included).
    const ids = isAllMode
      ? mergedVisibleItems.flatMap((m) => {
          const id = rssItemId(m.item);
          const c = clusterByItemId.get(id);
          return c && c.leadItemId === id ? c.itemIds : [id];
        })
      : visibleItems.map((it) => rssItemId(it));
    markAllRead(ids);
  }, [isAllMode, mergedVisibleItems, clusterByItemId, visibleItems, markAllRead]);

  // Opening an article in the reader marks it read. Normal card opens always
  // land on the Article tab (the ?discuss= deep-link overrides this to comments).
  const handleOpenReader = useCallback((item: RSSItem) => {
    markRead(rssItemId(item));
    setReaderInitialTab("article");
    setReaderItem(item);
  }, [markRead]);

  // ?item=<rssItemId> deep-link (the Stories menu's News card teases a specific
  // headline — tapping it must land ON that article, not just the News page).
  // Handled once per param value, when the merged list has loaded enough to
  // resolve the id; the param is then stripped so back/refresh don't re-open.
  const itemParamHandledRef = useRef<string>("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const itemParam = params.get("item");
    if (!itemParam || itemParam === itemParamHandledRef.current) return;
    // A persisted single-feed pick would leave the merged map empty (the
    // article can live in ANY saved feed) — force the All-feeds thread first.
    if (activeFeedUrl !== "") {
      setActiveFeedUrl("");
      return; // resolution retries once merged mode has built its map
    }
    const match = mergedItemById.get(itemParam);
    if (!match) return; // feeds still loading — retry on the next mergedItems change
    itemParamHandledRef.current = itemParam;
    handleOpenReader(match.item);
    try {
      params.delete("item");
      const qs = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    } catch {}
    // discussSearch (wouter's reactive query string) is what makes an IN-APP
    // navigation to /news?item=… work when the page is ALREADY mounted — the
    // OrbitMenu news card now points here instead of the search-embedded copy,
    // and window.location.search alone is read-once. Same dependency the
    // ?discuss= effect below has always carried.
  }, [mergedItemById, handleOpenReader, activeFeedUrl, discussSearch]);

  // ?discuss=<anchor> deep-link (the Discuss-share funnel + reply-alert links):
  // open the link's Discussion tab directly. The param is validated (decode →
  // http(s) → normalize; junk ignored). We synthesize a MINIMAL item from the
  // anchor — the reader fetches the link's OWN data for the preview, never
  // trusting an author-supplied tag, so the funnel is phishing-safe. Reacts to
  // URL changes (cold open AND in-app navigation), handled once per param value,
  // then the param is stripped so back/refresh don't re-open.
  const discussParamHandledRef = useRef<string>("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawParam = params.get("discuss");
    if (!rawParam || rawParam === discussParamHandledRef.current) return;
    discussParamHandledRef.current = rawParam;
    const anchor = parseDiscussParam(rawParam);
    if (anchor) {
      const synthetic: RSSItem = {
        title: "", link: anchor, description: "", fullContent: "", pubDate: "",
        author: "", categories: [], thumbnail: "", comments: "",
      };
      markRead(rssItemId(synthetic));
      setReaderInitialTab("comments");
      setReaderItem(synthetic);
    }
    // Strip the param regardless (valid opened, junk ignored) so back/refresh
    // don't re-open and the URL doesn't linger with the anchor.
    try {
      params.delete("discuss");
      const qs = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    } catch {}
  }, [discussSearch, markRead]);

  // One card renderer shared by the unread + read groups (read cards dim in place).
  const renderArticle = useCallback((item: RSSItem, idx: number, dimmed: boolean) => (
    <div key={item.link} className={dimmed ? "opacity-55 transition-opacity" : ""}>
      <RSSArticleCard
        density={density}
        item={item}
        onShare={(it) => setShareCtx({ item: it, feedTitle: feedData?.title, feedImage: activeFeed?.feedImage || feedData?.image })}
        onRead={handleOpenReader}
        isBookmarked={isRssBookmarked(item.link)}
        onToggleBookmark={() => toggleRssBookmark(item)}
        feedTitle={feedData?.title}
        feedImage={activeFeed?.feedImage || feedData?.image}
        sourceName={activeFeed?.name || feedData?.title}
        sourceSiteUrl={activeFeed?.siteUrl || feedData?.link}
        isRead={isRead(rssItemId(item))}
        onMarkRead={(it) => markRead(rssItemId(it))}
        onFilterSource={(author) => setSourceFilter(author)}
      />
    </div>
  ), [density, feedData, activeFeed, handleOpenReader, isRssBookmarked, toggleRssBookmark, isRead, markRead]);

  // Card renderer for the merged thread: each card is labelled with ITS OWN
  // source, and tapping the source drills into that single feed.
  const renderMergedArticle = useCallback((m: MergedItem<RSSItem>, idx: number, dimmed: boolean) => (
    <div key={`${m.source.url}-${m.item.link}`} className={dimmed ? "opacity-55 transition-opacity" : ""}>
      <RSSArticleCard
        density={density}
        item={m.item}
        onShare={(it) => setShareCtx({ item: it, feedTitle: m.source.name, feedImage: m.source.feedImage })}
        onRead={handleOpenReader}
        isBookmarked={isRssBookmarked(m.item.link)}
        onToggleBookmark={() => toggleRssBookmark(m.item)}
        feedTitle={m.source.name}
        feedImage={m.source.feedImage}
        sourceName={m.source.name}
        sourceSiteUrl={m.source.siteUrl}
        isRead={isRead(rssItemId(m.item))}
        onMarkRead={(it) => markRead(rssItemId(it))}
        onFilterSource={() => handleSelectFeed(m.source.url)}
      />
    </div>
  ), [density, handleOpenReader, isRssBookmarked, toggleRssBookmark, isRead, markRead, handleSelectFeed]);

  // Stacked renderer for multi-version story clusters: the lead keeps the
  // normal card treatment; the other outlets' versions collapse behind the
  // "N sources" chip. Falls back to the plain card when members are missing.
  const renderStackedStory = useCallback(
    (m: MergedItem<RSSItem>, cluster: StoryCluster, idx: number, dimmed: boolean) => {
      const members = cluster.itemIds
        .filter((id) => id !== cluster.leadItemId)
        .map((id) => mergedItemById.get(id))
        .filter((mm): mm is MergedItem<RSSItem> => !!mm);
      if (members.length === 0) return renderMergedArticle(m, idx, dimmed);
      return (
        <div key={`stack-${cluster.clusterId}`} className={dimmed ? "opacity-55 transition-opacity" : ""}>
          <StackedStoryCard
            leadCard={renderMergedArticle(m, idx, false)}
            members={members}
            outletCount={cluster.outletCount}
            isRead={isRead}
            onOpenMember={handleOpenReader}
          />
        </div>
      );
    },
    [mergedItemById, renderMergedArticle, isRead, handleOpenReader]
  );

  // ── Desktop "magazine" card renderer ───────────────────────────────────────
  // One renderer for both the secondary rail and the card grid. It reuses the
  // shared RSSMagazineCard tile and the SAME StackedStoryCard used on mobile, so
  // multi-outlet clusters keep their "N sources" expand + testids. Source labels
  // and v4v come from the merged item's own source (single-feed items carry the
  // active feed as their source, so this works unchanged in both modes).
  const renderMagCard = useCallback((m: MergedItem<RSSItem>, variant: "grid" | "rail") => {
    const id = rssItemId(m.item);
    const cluster = clusterByItemId.get(id);
    const isStack = !!cluster && cluster.itemIds.length > 1 && cluster.leadItemId === id;
    const card = (
      <RSSMagazineCard
        variant={variant}
        item={m.item}
        onRead={handleOpenReader}
        onMarkRead={(it) => markRead(rssItemId(it))}
        onShare={(it) => setShareCtx({ item: it, feedTitle: m.source.name, feedImage: m.source.feedImage })}
        isBookmarked={isRssBookmarked(m.item.link)}
        onToggleBookmark={() => toggleRssBookmark(m.item)}
        feedTitle={m.source.name}
        feedImage={m.source.feedImage}
        sourceName={m.source.name}
        isRead={isRead(id)}
        outletCount={cluster?.outletCount}
        v4v={!!feedByUrl.get(m.source.url)?.v4v}
      />
    );
    if (!isStack || !cluster) return card;
    const members = cluster.itemIds
      .filter((x) => x !== cluster.leadItemId)
      .map((x) => mergedItemById.get(x))
      .filter((mm): mm is MergedItem<RSSItem> => !!mm);
    if (members.length === 0) return card;
    return (
      <StackedStoryCard
        leadCard={card}
        members={members}
        outletCount={cluster.outletCount}
        isRead={isRead}
        onOpenMember={handleOpenReader}
      />
    );
  }, [clusterByItemId, mergedItemById, feedByUrl, handleOpenReader, markRead, isRssBookmarked, toggleRssBookmark, isRead]);

  const handleAddFeed = useCallback((feed: SavedFeed) => {
    setFeeds(prev => {
      if (prev.some(f => f.url === feed.url)) return prev;
      const isHiddenDefault = DEFAULT_FEEDS.some(d => d.url === feed.url);
      if (isHiddenDefault) {
        const hidden = loadHiddenDefaults();
        hidden.delete(feed.url);
        saveHiddenDefaults(hidden);
      } else {
        const custom = loadCustomFeeds();
        custom.push(feed);
        saveCustomFeeds(custom);
      }
      return [...prev, feed];
    });
  }, []);

  const handleRemoveFeed = useCallback((url: string) => {
    const isDefault = DEFAULT_FEEDS.some(d => d.url === url);
    if (isDefault) {
      const hidden = loadHiddenDefaults();
      hidden.add(url);
      saveHiddenDefaults(hidden);
    } else {
      const custom = loadCustomFeeds().filter(f => f.url !== url);
      saveCustomFeeds(custom);
    }
    setFeeds(prev => {
      const next = prev.filter(f => f.url !== url);
      if (activeFeedUrl === url && next.length > 0) {
        handleSelectFeed(next[0].url);
      }
      return next;
    });
  }, [activeFeedUrl, toast, handleSelectFeed]);

  const handleStartEdit = useCallback((feed: SavedFeed) => {
    setEditingFeedUrl(feed.url);
    setEditName(feed.name);
    setEditCategory(feed.category);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingFeedUrl || !editName.trim()) return;
    const trimmedName = editName.trim();
    const trimmedCategory = editCategory.trim() || "Custom";
    updateFeedInLibrary(editingFeedUrl, { name: trimmedName, category: trimmedCategory });
    setFeeds(prev => prev.map(f =>
      f.url === editingFeedUrl ? { ...f, name: trimmedName, category: trimmedCategory } : f
    ));
    setEditingFeedUrl(null);
    setEditName("");
    setEditCategory("");
  }, [editingFeedUrl, editName, editCategory]);

  const handleCancelEdit = useCallback(() => {
    setEditingFeedUrl(null);
    setEditName("");
    setEditCategory("");
  }, []);

  const handleResetDefaults = useCallback(() => {
    saveCustomFeeds([]);
    saveHiddenDefaults(new Set());
    const defaults = [...DEFAULT_FEEDS];
    setFeeds(defaults);
    setActiveFeedUrl(""); // back to the merged "All feeds" thread
  }, [toast]);

  const categories = useMemo(() => {
    const cats = new Set(feeds.map(f => f.category));
    return Array.from(cats).sort();
  }, [feeds]);


  const mobileFilteredFeeds = useMemo(() => {
    if (selectedCategories.size === 0) return feeds;
    return feeds.filter(f => selectedCategories.has(f.category));
  }, [feeds, selectedCategories]);

  useEffect(() => {
    // Only re-target when already drilled into a single source; never yank the
    // user out of the merged "All feeds" thread.
    if (activeFeedUrl !== "" && selectedCategories.size > 0 && mobileFilteredFeeds.length > 0 && !mobileFilteredFeeds.some(f => f.url === activeFeedUrl)) {
      setActiveFeedUrl(mobileFilteredFeeds[0].url);
    }
  }, [mobileFilteredFeeds, activeFeedUrl, selectedCategories]);

  // ── Desktop magazine buckets (only rendered when useMagazine) ──────────────
  // Split the ordered below-hero list into the secondary rail + the card grid.
  // Cheap shallow slices; when there is no hero, everything flows into the grid
  // (no rail). Single-feed items are normalised to the shared MergedItem shape
  // (source = the active feed) so the ONE magazine renderer serves both modes.
  const magAll = mergedHero
    ? splitMagazine(mergedVisible, MAGAZINE_RAIL, (m) => isRead(rssItemId(m.item)))
    : { rail: [] as MergedItem<RSSItem>[], grid: mergedVisible, gridReadStart: mergedVisible.findIndex((m) => isRead(rssItemId(m.item))) };

  const singleSource: MergeSource = {
    url: activeFeedUrl,
    name: activeFeed?.name || feedData?.title,
    feedImage: activeFeed?.feedImage || feedData?.image,
    siteUrl: activeFeed?.siteUrl || feedData?.link,
  };
  const singleRest: MergedItem<RSSItem>[] = [...unreadRest, ...readItems].map((it) => ({ item: it, source: singleSource }));
  const magSingle = heroItem
    ? splitMagazine(singleRest, MAGAZINE_RAIL, (m) => isRead(rssItemId(m.item)))
    : { rail: [] as MergedItem<RSSItem>[], grid: singleRest, gridReadStart: singleRest.findIndex((m) => isRead(rssItemId(m.item))) };

  // Column-aware diversity: reorder each grid so no card sits directly above
  // another from the same source (positions i and i+gridCols differ). The
  // unread/read halves are diversified independently, so gridReadStart — and the
  // "Caught up" divider it drives — is unchanged. Single-feed grids are one
  // source, so this is a no-op there.
  const magAllGrid = diversifyGrid(magAll.grid, magAll.gridReadStart, gridCols, (m) => m.source.url);
  const magSingleGrid = diversifyGrid(magSingle.grid, magSingle.gridReadStart, gridCols, (m) => m.source.url);

  // Shared "Caught up" divider (spans all grid columns) between fresh + read cards.
  const caughtUpDivider = (
    <div className="col-span-full flex items-center gap-3 pt-1 pb-1" data-testid="divider-caught-up">
      <span className="h-px flex-1 bg-border/40" />
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/50">Caught up</span>
      <span className="h-px flex-1 bg-border/40" />
    </div>
  );

  // Hard wall (owner decision, 2026-08-14): News is a browse surface, so
  // guests meet the wall outright — the reader, the feeds, and the trending
  // machinery behind them are membership. All hooks above have run; this
  // gates the RENDER only.
  if (!pubkey) {
    return (
      <div className={embedded ? "" : "max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6"} data-testid="page-rss-feed">
        <div className="max-w-2xl mx-auto pt-8">
          <GuestWall context="News is for members" />
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "" : "max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6"} data-testid="page-rss-feed">
      {/* Desktop "magazine" front page: break out of Search's max-w-2xl wrapper
          to fill the space right of the rail (main is flex-1, so centering on
          the box's center == centering in that space), capped at 1400px so it
          doesn't sprawl on ultrawide. Width is viewport-derived (rail ≈ 4.25rem
          + gutters); main's overflow-x-hidden guards the edges. Below lg the
          reader stays the mobile single centered column — untouched. The
          reader/share/alert dialogs render OUTSIDE this div, so the transform's
          containing block never traps their `position: fixed`. (The title
          header lives INSIDE it so title, control row, and content share one
          left edge at every width — it used to sit in the page's max-w-5xl
          box while the content sat in this one, and the two edges never
          lined up. Its own dialog is portal-based, so the transform is safe.) */}
      <div
        className={useMagazine ? "w-full" : "max-w-2xl mx-auto w-full"}
        style={useMagazine ? { position: "relative", left: "50%", transform: "translateX(-50%)", width: "min(1400px, calc(100vw - 6.5rem))" } : undefined}
      >
      {/* Title header: only on the standalone page. On the focused News view
          (embedded) it's redundant — refresh + Add Feed are relocated into
          Row A (mobile) and a slim desktop action bar below. */}
      {!embedded && (
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-2">
            {/* No "← Discover" back here (owner call, 2026-08-14): the bottom
                bar's Discover tab already returns to the bento in one tap, so
                a header back was a second way to say the same thing. News's
                only in-page arrow is the feed-level back-to-all below. */}
            {/* nowrap: with "← Discover" beside it on a 375px screen the title
                used to shrink and break into two lines. The decorative RSS
                badge is the thing that yields on the smallest screens. */}
            <h1 className="text-lg font-semibold text-foreground whitespace-nowrap" data-testid="text-rss-title">
              News Feeds
            </h1>
            <Badge variant="secondary" className="text-[11px] hidden sm:inline-flex">
              RSS
            </Badge>
            {/* All-mode header count = bounded tier 1–2 priority slice only (the
                fatigue fix); there is no aggregate everything-unread total. */}
            {(isAllMode ? newsAlertUnread : (feedData && feedData.items.length > 0 ? visibleUnreadCount : 0)) > 0 && (
              // hidden < sm: the feed pill one row down shows the same count,
              // and dropping the duplicate keeps the title on one line beside
              // "← Discover" + refresh + Add.
              <Badge variant="default" className="text-[11px] tabular-nums hidden sm:inline-flex" data-testid="badge-header-unread">
                {isAllMode ? newsAlertUnread : visibleUnreadCount} unread
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isAllMode ? mergedFetching : isFetching}
              data-testid="button-refresh-feed"
            >
              <RefreshCw className={`w-4 h-4 ${(isAllMode ? mergedFetching : isFetching) ? "animate-spin" : ""}`} />
            </Button>
            <AddRssFeedDialog onAdd={handleAddFeed} existingUrls={existingUrls} onOpenFeed={handleSelectFeed} />
          </div>
        </div>
      )}

        {/* Control bar: search + "All feeds" picker + ⋮. Stacked on mobile
            (unchanged); one full-width bar on desktop. */}
        <div className={useMagazine ? "mb-4 flex flex-row items-center gap-2" : "mb-4 space-y-2.5"}>
        {/* Search FIRST (owner redesign 2026-08-30): the app's canonical search
            pill — identical to the Search page — opens the discover-and-add
            dialog. On desktop the pill (flex-1) and the feed picker share ONE
            line, search left / picker right; on mobile they stack. The old
            density/layout overflow (⋮) and the sort toggle are gone; mark-all
            plus the contextual source filter sit inline beside the picker. */}
        <AddRssFeedDialog
          onAdd={handleAddFeed}
          existingUrls={existingUrls}
          onOpenFeed={handleSelectFeed}
          autoFocusSearch
          trigger={
            <button
              type="button"
              className={`${searchPillClass} relative flex items-center pl-10 pr-4 text-muted-foreground/60 ${useMagazine ? "flex-1 min-w-0 !h-10" : ""}`}
              aria-label="Search news, blogs & podcasts"
              data-testid="button-open-feed-search"
            >
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <span className="truncate">Search news, blogs &amp; podcasts…</span>
            </button>
          }
        />
        {/* Filter row: feed picker · sort · mark-all · source · visit-site */}
        <div className={`flex items-center gap-2 ${useMagazine ? "shrink-0" : ""}`} data-testid="container-feed-selector-mobile">
          {!isAllMode && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 -ml-1"
              onClick={() => handleSelectFeed("")}
              aria-label="Back to all feeds"
              title="Back to all feeds"
              data-testid="button-back-to-all"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
          )}
          <Drawer open={feedPopoverOpen} onOpenChange={setFeedPopoverOpen}>
            <DrawerTrigger asChild>
              <Button variant="outline" size="sm" className={`justify-between h-10 ${useMagazine ? "w-56 flex-none" : "flex-1 min-w-0"}`} data-testid="button-feed-dropdown">
                <span className="flex items-center gap-1.5 truncate">
                  <SourceFavicon
                    feedImage={activeFeed?.feedImage || feedData?.image}
                    link={feedData?.link}
                    siteUrl={activeFeed?.siteUrl || feedData?.link}
                    className="w-4 h-4 shrink-0"
                  />
                  <span className="truncate">{isAllMode ? "All feeds" : (activeFeed?.name || "Select feed")}</span>
                  {(isAllMode ? newsAlertUnread : (feedData && feedData.items.length > 0 ? visibleUnreadCount : 0)) > 0 && (
                    <span className="text-muted-foreground/70 tabular-nums shrink-0" data-testid="text-picker-unread">
                      · {isAllMode ? newsAlertUnread : visibleUnreadCount} unread
                    </span>
                  )}
                </span>
                <ChevronDown className="w-3.5 h-3.5 ml-2 text-muted-foreground shrink-0" />
              </Button>
            </DrawerTrigger>
            <DrawerContent className="border-border/20 bg-background/95 backdrop-blur-xl max-h-[80dvh] overflow-hidden flex flex-col">
              {/* Opaque backing: iOS WebKit can drop the composited background of a transform-animated
                  fixed container with a scrollable descendant (PRs #321/#322). */}
              <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 rounded-t-[10px] bg-background" data-testid="switch-feed-backing" />
              <DrawerHeader className="pb-2 border-b border-border/15 shrink-0">
                <DrawerTitle className="text-sm font-brand uppercase tracking-widest flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
                    <Rss className="w-3.5 h-3.5 text-brand" />
                  </div>
                  Switch feed
                </DrawerTitle>
              </DrawerHeader>
              <div
                className="flex-1 min-h-0 px-3 pb-8 pt-2 overflow-y-auto overflow-x-hidden overscroll-contain"
                style={{ WebkitOverflowScrolling: "touch" }}
                data-vaul-no-drag
              >
                {/* "All feeds" — the merged thread of releases; the default view. */}
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => { handleSelectFeed(""); setFeedPopoverOpen(false); }}
                    className={`w-full flex items-center gap-2.5 pl-3 pr-2 py-2.5 min-h-[44px] rounded-xl text-left transition-colors ${
                      isAllMode ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted/50"
                    }`}
                    data-testid="button-select-feed-all"
                  >
                    <div className="w-5 h-5 rounded-md bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                      <Newspaper className="w-3 h-3 text-brand" />
                    </div>
                    <span className={`truncate ${isAllMode ? "font-medium" : ""}`}>All feeds</span>
                    {newsAlertUnread > 0 && (
                      <span className="text-xs text-muted-foreground/70 tabular-nums shrink-0">{newsAlertUnread}</span>
                    )}
                    {isAllMode && <Check className="w-4 h-4 text-brand shrink-0 ml-auto" />}
                  </button>
                  {/* Saved articles — the bookmark icon on cards/reader saves
                      here, but the collection itself lives on the Bookmarks
                      page; this is the News-side door to it. */}
                  <button
                    type="button"
                    onClick={() => { setFeedPopoverOpen(false); navigate("/account?tab=bookmarks"); }}
                    className="w-full flex items-center gap-2.5 pl-3 pr-2 py-2.5 min-h-[44px] rounded-xl text-left text-foreground hover:bg-muted/50 transition-colors"
                    data-testid="button-news-saved-articles"
                  >
                    <div className="w-5 h-5 rounded-md bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                      <Bookmark className="w-3 h-3 text-brand" />
                    </div>
                    <span className="truncate">Saved articles</span>
                    {rssBookmarks.length > 0 && (
                      <span className="text-xs text-muted-foreground/70 tabular-nums shrink-0" data-testid="text-saved-articles-count">{rssBookmarks.length}</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0 ml-auto" />
                  </button>
                </div>
                {(selectedCategories.size > 0 ? categories.filter(c => selectedCategories.has(c)) : categories).map(cat => {
                  const catFeeds = mobileFilteredFeeds.filter(f => f.category === cat);
                  if (catFeeds.length === 0) return null;
                  return (
                    <div key={cat} className="mb-3">
                      <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/50 px-2 py-1.5">{cat}</p>
                      <div className="space-y-1">
                        {catFeeds.map(feed => {
                          const isActive = feed.url === activeFeedUrl;
                          const isEditing = editingFeedUrl === feed.url;
                          if (isEditing) {
                            return (
                              <div key={feed.url} className="px-3 py-3 rounded-xl bg-muted/30 border border-border/30 space-y-2.5" onClick={(e) => e.stopPropagation()}>
                                <Input
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  placeholder="Feed name"
                                  className="h-11 text-base px-3 bg-background/50"
                                  autoFocus
                                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") handleCancelEdit(); }}
                                  data-testid={`input-edit-feed-name-mobile-${feed.url}`}
                                />
                                <Input
                                  value={editCategory}
                                  onChange={(e) => setEditCategory(e.target.value)}
                                  placeholder="Category"
                                  className="h-11 text-base px-3 bg-background/50"
                                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") handleCancelEdit(); }}
                                  data-testid={`input-edit-feed-category-mobile-${feed.url}`}
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <button onClick={handleCancelEdit} className="h-11 px-4 rounded-lg text-sm text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors flex items-center gap-1.5" data-testid={`button-cancel-edit-mobile-${feed.url}`}>
                                    <X className="w-4 h-4" /> Cancel
                                  </button>
                                  <button onClick={handleSaveEdit} className="h-11 px-4 rounded-lg text-sm text-brand hover:bg-brand/10 transition-colors flex items-center gap-1.5" data-testid={`button-save-edit-mobile-${feed.url}`}>
                                    <Check className="w-4 h-4" /> Save
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={feed.url}
                              className={`w-full flex items-center gap-2 rounded-xl transition-colors ${
                                isActive ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted/50"
                              }`}
                              data-testid={`feed-selector-mobile-${feed.url}`}
                            >
                              <button
                                type="button"
                                onClick={() => { handleSelectFeed(feed.url); setFeedPopoverOpen(false); }}
                                className="flex-1 min-w-0 flex items-center gap-2.5 pl-3 pr-1 py-2.5 min-h-[44px] text-left"
                                data-testid={`button-select-feed-mobile-${feed.url}`}
                              >
                                <SourceFavicon
                                  feedImage={feed.feedImage}
                                  siteUrl={feed.siteUrl || feed.url}
                                  className="w-5 h-5 shrink-0"
                                />
                                <span className={`truncate ${isActive ? "font-medium" : ""}`}>{feed.name}</span>
                                {isActive && visibleUnreadCount > 0 && (
                                  <span className="text-xs text-muted-foreground/70 tabular-nums shrink-0">{visibleUnreadCount}</span>
                                )}
                                {isActive && (
                                  <Check className="w-4 h-4 text-brand shrink-0 ml-auto" />
                                )}
                              </button>
                              <div className="flex items-center shrink-0 pr-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartEdit(feed);
                                  }}
                                  className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground/60 hover:text-brand hover:bg-muted/50 transition-colors"
                                  aria-label="Edit feed"
                                  data-testid={`button-edit-feed-mobile-${feed.url}`}
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveFeed(feed.url);
                                  }}
                                  className="w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground/60 hover:text-destructive hover:bg-muted/50 transition-colors"
                                  aria-label="Remove feed"
                                  data-testid={`button-remove-feed-mobile-${feed.url}`}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {feeds.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground">No feeds added yet</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { handleResetDefaults(); setFeedPopoverOpen(false); }}
                      className="mt-3 font-brand uppercase tracking-widest text-xs"
                      data-testid="button-reset-defaults"
                    >
                      Restore default feeds
                    </Button>
                  </div>
                )}
              </div>
            </DrawerContent>
          </Drawer>
          {sourceFilter && (
            <button
              type="button"
              onClick={() => setSourceFilter(null)}
              className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/10 text-brand text-[11px] font-mono uppercase tracking-wider pl-2.5 pr-1.5 h-10 shrink-0 hover:bg-brand/20 transition-colors max-w-[140px]"
              title="Clear source filter"
              data-testid="chip-source-filter"
            >
              <span className="truncate">{sourceFilter}</span>
              <X className="w-3 h-3 shrink-0" />
            </button>
          )}
          {/* Mark all read — only when there's something unread to clear. */}
          {(isAllMode ? mergedTotalUnread > 0 : (feedData && visibleUnreadCount > 0)) && (
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 h-10 w-10"
              onClick={() => setMarkAllConfirmOpen(true)}
              title="Mark all read"
              aria-label="Mark all read"
              data-testid="button-mark-all-read"
            >
              <Check className="w-4 h-4" />
            </Button>
          )}
          {/* Filter by source — only when a feed aggregates multiple sources. */}
          {feedAuthors.length > 1 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 h-10 w-10" title="Filter by source" aria-label="Filter by source" data-testid="button-source-filter">
                  <Filter className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="glass-dropdown w-56 rounded-lg p-1">
                <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/50 px-2 py-1">Filter by source</p>
                <div className="max-h-48 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => setSourceFilter(null)}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-[13px] transition-colors ${!sourceFilter ? "text-brand bg-brand/10" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                    data-testid="option-source-all"
                  >
                    All sources
                  </button>
                  {feedAuthors.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setSourceFilter(a)}
                      className={`w-full text-left px-2 py-1.5 rounded-md text-[13px] truncate transition-colors ${sourceFilter === a ? "text-brand bg-brand/10" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                      data-testid={`option-source-${a}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          {/* Visit the feed's own website (single-feed view). */}
          {!isAllMode && (activeFeed?.siteUrl || feedData?.link) && (
            <a
              href={activeFeed?.siteUrl || feedData!.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center shrink-0 h-10 w-10 rounded-md border [border-color:var(--button-outline)] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Visit site"
              aria-label="Visit site"
              data-testid="link-visit-site"
            >
              <Globe className="w-4 h-4" />
            </a>
          )}
        </div>
        </div>

        {/* Category tabs removed (2026-07): the per-topic buckets read
            inconsistently across users' feed mixes; topic discovery lives in
            Search, where categories are curated. The All-feeds view is now a
            single "Top" stream. */}

        <div ref={articlesRef} className="min-w-0 space-y-3" data-testid="container-feed-content">
          {/* ── Merged "All feeds" thread (the default view) ── */}
          {isAllMode && (
            <div data-testid="container-merged-thread">
              {mergedLoading && mergedItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <RelayOutpostLoader />
                  <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                    Gathering your feeds…
                  </p>
                </div>
              )}

              {!mergedLoading && mergedVisibleItems.length === 0 && (
                <Card className="glass-card p-6">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Newspaper className="w-8 h-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">Nothing to read yet</p>
                    <p className="text-xs text-muted-foreground">
                      {feeds.length === 0
                        ? "Add a feed to start your thread."
                        : mergedItems.length > 0
                          ? "Everything here is muted or low-priority — check individual feeds or your alert settings."
                          : "Your feeds returned no articles."}
                    </p>
                  </div>
                </Card>
              )}

              {mergedVisibleItems.length > 0 && (
                <div className={useMagazine ? "space-y-5" : "space-y-2"}>
                  {/* DIGEST / "Worth your time" panel removed (2026-07) — the
                      collapsed digest banner cluttered the top of the feed; the
                      feed itself already surfaces what's new. */}
                  {effectiveBucket === "Top" && <PodcastShelf items={podcastShelf} onOpenShow={(url) => { setActiveFeedUrl(url); window.scrollTo({ top: 0 }); }} />}
                  {useMagazine ? (
                    <>
                      {/* Lead block: feature hero (2/3) + secondary rail (1/3). */}
                      {mergedHero && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="container-magazine-lead">
                          <div className="lg:col-span-2">
                            <RSSHeroCard
                              feature
                              item={mergedHero.item}
                              feedImage={mergedHero.source.feedImage}
                              feedTitle={mergedHero.source.name}
                              sourceName={mergedHero.source.name}
                              sourceSiteUrl={mergedHero.source.siteUrl}
                              onRead={handleOpenReader}
                              onMarkRead={(it) => markRead(rssItemId(it))}
                              onShare={(it) => setShareCtx({ item: it, feedTitle: mergedHero.source.name, feedImage: mergedHero.source.feedImage })}
                              isBookmarked={isRssBookmarked(mergedHero.item.link)}
                              onToggleBookmark={() => toggleRssBookmark(mergedHero.item)}
                            />
                          </div>
                          {magAll.rail.length > 0 && (
                            <div className="lg:col-span-1 flex flex-col gap-3" data-testid="container-magazine-rail">
                              {magAll.rail.map((m, idx) => (
                                <div key={`rail-${m.source.url}-${m.item.link}`}>{renderMagCard(m, "rail")}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Card grid: the remaining stories, 2→3→4 columns with width. */}
                      {magAllGrid.length > 0 && (
                        <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start" data-testid="container-magazine-grid">
                          {magAllGrid.flatMap((m, idx) => {
                            const cells: React.ReactNode[] = [];
                            if (sortMode === "unread-first" && idx === magAll.gridReadStart && magAll.gridReadStart > 0) {
                              cells.push(<div key="caught-up-grid" className="contents">{caughtUpDivider}</div>);
                            }
                            cells.push(
                              <div key={`grid-${m.source.url}-${m.item.link}`}>{renderMagCard(m, "grid")}</div>
                            );
                            return cells;
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {mergedHero && (
                        <RSSHeroCard
                          item={mergedHero.item}
                          feedImage={mergedHero.source.feedImage}
                          feedTitle={mergedHero.source.name}
                          sourceName={mergedHero.source.name}
                          sourceSiteUrl={mergedHero.source.siteUrl}
                          onRead={handleOpenReader}
                          onMarkRead={(it) => markRead(rssItemId(it))}
                          onShare={(it) => setShareCtx({ item: it, feedTitle: mergedHero.source.name, feedImage: mergedHero.source.feedImage })}
                          isBookmarked={isRssBookmarked(mergedHero.item.link)}
                          onToggleBookmark={() => toggleRssBookmark(mergedHero.item)}
                        />
                      )}
                      <div className={density === "compact" ? "space-y-1 divide-y divide-border/20" : "space-y-2"}>
                        {mergedVisible.flatMap((m, idx) => {
                          const itemId = rssItemId(m.item);
                          const cluster = clusterByItemId.get(itemId);
                          const isStack = !!cluster && cluster.itemIds.length > 1 && cluster.leadItemId === itemId;
                          const card = isStack
                            ? renderStackedStory(m, cluster, idx, isRead(itemId))
                            : renderMergedArticle(m, idx, isRead(itemId));
                          // Insert a "Caught up" divider before the first read card in
                          // unread-first mode (latest mode is a flat chronological list).
                          const showDivider =
                            sortMode === "unread-first" &&
                            idx > 0 &&
                            isRead(rssItemId(m.item)) &&
                            !isRead(rssItemId(mergedVisible[idx - 1].item));
                          if (!showDivider) return [card];
                          return [
                            <div key={`caught-up-${idx}`} className="flex items-center gap-3 pt-3 pb-1" data-testid="divider-caught-up">
                              <span className="h-px flex-1 bg-border/40" />
                              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/50">Caught up</span>
                              <span className="h-px flex-1 bg-border/40" />
                            </div>,
                            card,
                          ];
                        })}
                      </div>
                    </>
                  )}
                  {mergedRest.length > mergedVisibleCount && (
                    <div className="flex justify-center pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMergedVisibleCount((n) => n + MERGED_PAGE)}
                        className="font-brand uppercase tracking-widest text-xs"
                        data-testid="button-load-more-merged"
                      >
                        <ChevronDown className="w-3.5 h-3.5 mr-1.5" />
                        Load more
                      </Button>
                    </div>
                  )}
                  {mergedLoading && (
                    <div className="flex items-center justify-center gap-2 pt-3 text-muted-foreground/60">
                      <RelayOutpostInlineLoader />
                      <span className="text-[11px] font-mono uppercase tracking-wider">Loading more feeds…</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!isAllMode && isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <RelayOutpostLoader />
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                Fetching feed...
              </p>
            </div>
          )}

          {error && !isLoading && (
            <Card className="glass-card p-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-muted-foreground/60" />
                <div>
                  <p className="text-sm font-medium">Failed to load feed</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(error as Error).message || "The feed might be unavailable or the URL may be incorrect."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  className="font-brand uppercase tracking-widest text-xs"
                  data-testid="button-retry-feed"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Retry
                </Button>
              </div>
            </Card>
          )}

          {feedData && !isLoading && feedData.items.length === 0 && (
            <Card className="glass-card p-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <Newspaper className="w-8 h-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">No articles found</p>
                <p className="text-xs text-muted-foreground">This feed appears to be empty.</p>
              </div>
            </Card>
          )}

          {feedData && !isLoading && feedData.items.length > 0 && visibleItems.length === 0 && (
            <Card className="glass-card p-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <Filter className="w-8 h-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">No articles from this source</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSourceFilter(null)}
                  className="font-brand uppercase tracking-widest text-xs"
                  data-testid="button-clear-source-filter-empty"
                >
                  <X className="w-3.5 h-3.5 mr-1.5" />
                  All sources
                </Button>
              </div>
            </Card>
          )}

          {feedData && !isLoading && visibleItems.length > 0 && (
            // A single feed renders as a CONDENSED PLAYLIST, not the magazine
            // spread: a podcast's episodes all share one show image, so big cards
            // looked like a repetitive wall. Header = show identity; below it a
            // tight list (play/№ · title · date · duration). Works for news feeds
            // too — just a clean chronological list.
            <div className="space-y-3" data-testid="container-playlist">
              <div className="flex items-start gap-3 sm:gap-4 pb-1">
                {(activeFeed?.feedImage || feedData?.image) && (
                  <img
                    src={activeFeed?.feedImage || feedData?.image}
                    alt=""
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover shadow-sm shrink-0"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      const src = activeFeed?.feedImage || feedData?.image;
                      if (src && !img.src.includes("/api/rss/image-proxy")) img.src = `/api/rss/image-proxy?url=${encodeURIComponent(src)}`;
                      else img.style.display = "none";
                    }}
                  />
                )}
                <div className="flex-1 min-w-0 pt-0.5">
                  <h1 className="text-base sm:text-lg font-bold leading-snug line-clamp-2" data-testid="text-playlist-title">
                    {activeFeed?.name || feedData?.title || "Feed"}
                  </h1>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">
                    {visibleItems.length} {feedData?.isPodcast ? (visibleItems.length === 1 ? "episode" : "episodes") : (visibleItems.length === 1 ? "article" : "articles")}
                  </p>
                  {(activeFeed?.siteUrl || feedData?.link) && (
                    <a
                      href={activeFeed?.siteUrl || feedData?.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-1 text-[11px] text-muted-foreground/60 hover:text-brand"
                    >
                      <ExternalLink className="w-3 h-3" /> Website
                    </a>
                  )}
                </div>
              </div>
              <div className="divide-y divide-border/15">
                {visibleItems.map((it, idx) => (
                  <PlaylistEpisodeRow
                    key={it.link || idx}
                    item={it}
                    index={idx}
                    feedImage={activeFeed?.feedImage || feedData?.image}
                    feedTitle={feedData?.title}
                    isPodcast={!!feedData?.isPodcast}
                    read={isRead(rssItemId(it))}
                    onOpen={handleOpenReader}
                    onMarkRead={(x) => markRead(rssItemId(x))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {shareCtx && (
        isMobile ? (
          <Drawer open={!!shareCtx} onOpenChange={(open) => { if (!open) setShareCtx(null); }}>
            <DrawerContent className="max-h-[85dvh]">
              {/* Opaque backing against the iOS scroll-in-transform compositing bug (PRs #321/#322). */}
              <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 rounded-t-[10px] bg-background" data-testid="share-drawer-backing" />
              <DrawerHeader className="shrink-0">
                <DrawerTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
                  {shareCtx.item.audioUrl ? <Headphones className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                  {shareCtx.item.audioUrl ? "Share Episode" : "Share"}
                </DrawerTitle>
              </DrawerHeader>
              <div className="px-4 pb-8 overflow-y-auto flex-1 min-h-0 overscroll-contain">
                <ShareToNostrDialog item={shareCtx.item} onClose={() => setShareCtx(null)} feedTitle={shareCtx.feedTitle} feedImage={shareCtx.feedImage} />
              </div>
            </DrawerContent>
          </Drawer>
        ) : (
          <Dialog open={!!shareCtx} onOpenChange={(open) => { if (!open) setShareCtx(null); }}>
            <DialogContent className="max-w-sm sm:max-w-md glass-dialog-card border-border overflow-hidden">
              <DialogHeader>
                <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
                  {shareCtx.item.audioUrl ? <Headphones className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                  {shareCtx.item.audioUrl ? "Share Episode" : "Share"}
                </DialogTitle>
              </DialogHeader>
              <ShareToNostrDialog item={shareCtx.item} onClose={() => setShareCtx(null)} feedTitle={shareCtx.feedTitle} feedImage={shareCtx.feedImage} />
            </DialogContent>
          </Dialog>
        )
      )}

      {readerItem && (
        <ArticleReaderDialog
          key={`${readerItem.link}-${readerInitialTab}`}
          item={readerItem}
          initialTab={readerInitialTab}
          onClose={() => setReaderItem(null)}
          onShare={(item) => {
            setReaderItem(null);
            setShareCtx({ item, feedTitle: feedData?.title, feedImage: activeFeed?.feedImage || feedData?.image });
          }}
          isMobile={isMobile}
          isBookmarked={isRssBookmarked(readerItem.link)}
          onToggleBookmark={() => toggleRssBookmark(readerItem)}
        />
      )}

      <AlertDialog open={markAllConfirmOpen} onOpenChange={setMarkAllConfirmOpen}>
        <AlertDialogContent className="glass-dialog-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Mark all as read?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks all {isAllMode ? mergedVisibleItems.length : visibleItems.length} article{(isAllMode ? mergedVisibleItems.length : visibleItems.length) === 1 ? "" : "s"} in this view as read.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-mark-all-read">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMarkAllVisibleRead}
              data-testid="button-confirm-mark-all-read"
            >
              Mark all read
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
