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
import {
  type SavedFeed,
  DEFAULT_FEEDS,
  SUGGESTED_FEEDS,
  EXTRA_DEFAULT_FEEDS,
  loadCustomFeeds,
  saveCustomFeeds,
  loadHiddenDefaults,
  saveHiddenDefaults,
  addFeedToLibrary,
  updateFeedInLibrary } from "@/lib/rss-feeds";
import { NEWS_STARTER_KEPT_KEY, laneFeeds, removeFromLibrary, restoreSource, sourceSections, starterStatus, type NewsLane } from "@/lib/news-library";
import { mergeFeedItems, type MergedItem, type MergeSource } from "@/lib/rss-merge";
import { groupByDay, listenEpisodes, orderStream, pickLead, withoutLead, withoutMuted } from "@/lib/news-stream";
import { imageFit } from "@/lib/news-image";
import { episodeTrack, podcastFeedToSaved } from "@/lib/podcast-episode";
import { listenView } from "@/lib/listen-view";
import { usePodcastStatus, usePodcastTrending } from "@/hooks/use-podcast-index";
import { scrollRootFor } from "@/lib/scroll-root";
import { loadEdition, saveEdition, mergeEditions, editionForSources } from "@/lib/news-edition";
import { stripHtml, formatDuration, type PodcastFeed } from "@/lib/podcast-index";
import { clusterStories, type StoryCluster } from "@/lib/story-cluster";
import { useNewsAlertPrefs } from "@/lib/news-alert-settings";
import { AddRssFeedDialog } from "@/components/rss/AddRssFeedDialog";
import { GuestWall } from "@/components/GuestWall";
import { NewsStoryRow } from "@/components/news/NewsStoryRow";

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

// Merge/memory guard: newest N items per feed fed into the All-view merge. A
// firehose never surfaces a single feed's deep back-catalog, so this bounds the
// held item set (≤ N × feed-count) and keeps weak devices safe.
const MAX_ITEMS_PER_FEED = 25;

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
  /** The picture's width in px, when the feed states it (lets News size it honestly). */
  thumbnailWidth?: number;
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

// The oldest saved-feeds key is folded in at start-up, before this page loads
// (ensureNewsLibraryMigrated in lib/news-library.ts, called from main.tsx).

function loadAllFeeds(): SavedFeed[] {
  const hidden = loadHiddenDefaults();
  const visibleDefaults = DEFAULT_FEEDS.filter(f => !hidden.has(f.url));
  const custom = loadCustomFeeds();
  return [...visibleDefaults, ...custom];
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
  const podcastTrack = useMemo(
    () =>
      episodeTrack(
        {
          title: sharedPodcast?.title || item.title || "Podcast Episode",
          audioUrl: podcastAudioUrl,
          pubDate: item.pubDate,
          duration: sharedPodcast?.duration || item.duration,
          description: item.description,
          thumbnail: sharedPodcast?.image || item.thumbnail,
          author: item.author,
        },
        {},
      ),
    [podcastAudioUrl, sharedPodcast, item],
  );
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
  const track = useMemo(() => episodeTrack(item, { title: feedTitle, image: feedImage }), [item, feedTitle, feedImage]);
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
    // A deliberate re-sort (all your sources answered while you're at the top)
    // SHOULD reorder; streaming backfill should not. Reset the frozen order only
    // when the resetKey changes.
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

/** Which lane of the News page you last had open ("news" | "listen"). */
const NEWS_LANE_KEY = "ro_news_lane";

/** One feed through the server's RSS proxy. Throws on failure, so react-query retries and reports it. */
async function fetchRssFeed(url: string): Promise<RSSFeedData> {
  const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to fetch" }));
    throw new Error(err.error || "Failed to fetch feed");
  }
  return res.json() as Promise<RSSFeedData>;
}

/**
 * A feed's newest items, at most MAX_ITEMS_PER_FEED. A feed's own order isn't
 * always newest first, and a stream never reaches a feed's deep back-catalogue,
 * so keeping all of it only bloats the merge and memory on weaker devices.
 */
function newestCapped(items: RSSItem[]): RSSItem[] {
  if (items.length <= MAX_ITEMS_PER_FEED) return items;
  return [...items]
    .sort((a, b) => (Date.parse(b.pubDate || "") || 0) - (Date.parse(a.pubDate || "") || 0))
    .slice(0, MAX_ITEMS_PER_FEED);
}

/** "24 minutes ago"; empty without a usable date. A date a publisher's clock
 *  put in the future reads as now, never "in 3 hours". */
function storyTimeLabel(pubDate?: string): string {
  const t = Date.parse(pubDate || "");
  if (!Number.isFinite(t)) return "";
  return formatDistanceToNow(new Date(Math.min(t, Date.now())), { addSuffix: true });
}

export default function RSSFeed({ embedded = false }: { embedded?: boolean } = {}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
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
  // Source filter: narrows the active feed's items to a single author/source.
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  // Merged thread is the default when no single source is chosen.
  const isAllMode = activeFeedUrl === "";
  // How many cards of the merged thread to render (paginated so a 30-feed
  // library doesn't paint thousands of cards at once). Reset when inputs change.
  const MERGED_PAGE = 25;
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

  // The merged "All feeds" stream = YOUR news sources only (lib/news-library.ts).
  // It used to add every preset outlet and all 76 preset podcasts on top of the
  // library whether you chose them or not, so podcasts crowded out the news
  // ("forced with our agenda and presets", 2026-09-10). Podcasts you follow
  // belong in their own Listen lane.
  const allFeedSources = useMemo<SavedFeed[]>(() => laneFeeds(feeds, "news"), [feeds]);

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
  // Wave 1 (first paint) = your first 12 news sources; a larger library
  // backfills the rest on idle, so first paint never stampedes /api/rss.
  const primaryFeedUrls = useMemo(
    () => new Set<string>(allFeedSources.slice(0, 12).map((f) => f.url)),
    [allFeedSources],
  );
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
      // A feed fetches when it's on the front page (wave 1) or the rolling
      // backfill frontier has reached it. This keeps first paint to ~12
      // requests and streams a larger library in gently.
      const shouldFetch = primaryFeedUrls.has(f.url) || i < backfillLimit;
      return {
        queryKey: ["/api/rss", f.url],
        queryFn: () => fetchRssFeed(f.url),
        enabled: isAllMode && !!f.url && shouldFetch,
        staleTime: 10 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 1,
      };
    }),
  });

  // ── The Listen lane (News redesign, part 4) ──────────────────────────────
  // News | Listen: articles in News, the new episodes of the shows you follow
  // in Listen. The lane you had open is remembered on this device.
  const [lane, setLane] = useState<NewsLane>(() => {
    try {
      return localStorage.getItem(NEWS_LANE_KEY) === "listen" ? "listen" : "news";
    } catch {
      return "news";
    }
  });
  const chooseLane = useCallback((next: string) => {
    const chosen: NewsLane = next === "listen" ? "listen" : "news";
    setLane(chosen);
    try {
      localStorage.setItem(NEWS_LANE_KEY, chosen);
    } catch {
      /* ignore */
    }
  }, []);
  const isListen = isAllMode && lane === "listen";
  const listenFeedSources = useMemo<SavedFeed[]>(() => laneFeeds(feeds, "listen"), [feeds]);
  // Your shows are fetched only while Listen is open: the first 12 at once,
  // then 6 more a second (the /api/rss budget is 120 requests a minute).
  const [listenLimit, setListenLimit] = useState(12);
  useEffect(() => {
    if (!isListen || listenLimit >= listenFeedSources.length) return;
    const t = window.setTimeout(() => setListenLimit((n) => n + 6), 1000);
    return () => window.clearTimeout(t);
  }, [isListen, listenLimit, listenFeedSources.length]);
  const listenQueries = useQueries({
    queries: listenFeedSources.map((f, i) => ({
      queryKey: ["/api/rss", f.url],
      queryFn: () => fetchRssFeed(f.url),
      enabled: isListen && i < listenLimit,
      staleTime: 10 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
    })),
  });
  const listenItems = useMemo(() => {
    if (!isListen) return [] as MergedItem<RSSItem>[];
    const perFeed = listenFeedSources.map((f, i) => {
      const data = listenQueries[i]?.data as RSSFeedData | undefined;
      const source: MergeSource = {
        url: f.url,
        name: f.name || data?.title,
        feedImage: f.feedImage || data?.image,
        siteUrl: f.siteUrl || data?.link,
      };
      return { source, items: newestCapped((data?.items ?? []) as RSSItem[]) };
    });
    return listenEpisodes(mergeFeedItems(perFeed));
    // listenQueries identity changes each render; key off the resolved data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListen, listenFeedSources, listenQueries.map((q) => q.dataUpdatedAt).join(",")]);
  const listenLoading = isListen && listenQueries.some((q) => q.isLoading);
  const [listenVisibleCount, setListenVisibleCount] = useState(MERGED_PAGE);
  const listenDays = useMemo(
    () => groupByDay(listenItems.slice(0, listenVisibleCount), Date.now()),
    [listenItems, listenVisibleCount],
  );
  // Following no shows: suggest what's trending in podcasting (Podcast Index),
  // never our own picks, and say so plainly when it can't answer.
  const { configured: podcastIndexConfigured } = usePodcastStatus();
  const trending = usePodcastTrending(null, 20, isListen && listenFeedSources.length === 0 && podcastIndexConfigured === true);
  const listenMode = listenView({
    followedShows: listenFeedSources.length,
    episodeCount: listenItems.length,
    episodesLoading: listenLoading,
    podcastIndexConfigured,
    trendingLoading: trending.isLoading,
    trendingCount: trending.feeds.length,
    trendingError: trending.isError,
  });
  const player = useAudioPlayer();

  // The remembered "latest edition" — read synchronously on mount so the News
  // page paints its last screen instantly instead of waiting on the network.
  const [restoredEdition] = useState<MergedItem<RSSItem>[]>(() =>
    editionForSources(loadEdition() as MergedItem<RSSItem>[], new Set(allFeedSources.map((f) => f.url))),
  );

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
      return { source, items: newestCapped((data?.items ?? []) as RSSItem[]) };
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

  // The non-lead members of multi-outlet clusters: the same story from several
  // outlets shows once, as its lead, never as a run of near-duplicates.
  const stackedMemberIds = useMemo(() => {
    const memberIds = new Set<string>();
    for (const c of storyClusters) {
      if (c.itemIds.length < 2) continue;
      for (const id of c.itemIds) if (id !== c.leadItemId) memberIds.add(id);
    }
    return memberIds;
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

  // Your mutes (Settings → News) are the one thing the stream leaves out. It no
  // longer hides stories by our own scoring, keeps one story per source, or
  // files them under topic tabs (2026-09 calm redesign, lib/news-stream.ts).
  const newsPrefs = useNewsAlertPrefs();
  const mergedVisibleItems = useMemo(
    () => withoutMuted(mergedCollapsedItems, { mutedSources: newsPrefs.mutedSources, mutedKeywords: newsPrefs.mutedKeywords }),
    [mergedCollapsedItems, newsPrefs.mutedSources, newsPrefs.mutedKeywords],
  );

  // The quiet lead: the newest unread story with a picture big enough to lead,
  // otherwise the newest unread one. Held once picked, so a better picture
  // arriving in the backfill never swaps it out from under the reader.
  const mergedLeadRaw = useMemo(
    () => pickLead(mergedVisibleItems, (it) => isRead(rssItemId(it))),
    [mergedVisibleItems, isRead],
  );
  const mergedLead = useStableHero(mergedLeadRaw, mergedVisibleItems);
  // Everything else, strictly newest first. The lead is removed by story id,
  // so it's never shown twice.
  const mergedRestRaw = useMemo(
    () => withoutLead(orderStream(mergedVisibleItems), mergedLead),
    [mergedVisibleItems, mergedLead],
  );
  // Freeze positions as feeds stream in so nothing on screen moves (iOS has no
  // scroll anchoring); a late story appends, and still lands under the right
  // day. Once your sources have all answered, re-sort a single time if you're
  // still at the top: the first screen paints from the remembered edition, and
  // staying frozen buried a slower source's newest story below older ones.
  const [orderEpoch, setOrderEpoch] = useState(0);
  useEffect(() => {
    if (mergedLoading) return;
    const root = scrollRootFor(articlesRef.current);
    if ((root ? root.scrollTop : window.scrollY) < 120) setOrderEpoch((n) => n + 1);
  }, [mergedLoading]);
  const mergedRest = useStableOrder(mergedRestRaw, byMergedItemId, String(orderEpoch));  const mergedVisible = useMemo(
    () => mergedRest.slice(0, mergedVisibleCount),
    [mergedRest, mergedVisibleCount]
  );
  const mergedDays = useMemo(() => groupByDay(mergedVisible, Date.now()), [mergedVisible]);

  // Back to the first page when switching between all sources and one source,
  // NOT when the item count changes: the stream fills over several seconds and
  // pull-to-refresh rebuilds it, and resetting on length snapped a reader who
  // had scrolled or tapped "Show more" back to page 1.
  useEffect(() => {
    setMergedVisibleCount(MERGED_PAGE);
  }, [isAllMode]);

  // Refresh: All mode re-fetches every feed; single mode re-fetches the one.
  // Refresh follows the lane you're in.
  const laneQueries = isListen ? listenQueries : feedQueries;
  const mergedFetching = isAllMode && laneQueries.some((q) => q.isFetching);
  const handleRefresh = useCallback(() => {
    if (isAllMode) {
      laneQueries.forEach((q) => q.refetch());
    } else {
      refetch();
    }
  }, [isAllMode, laneQueries, refetch]);

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

  // Distinct authors in the active feed, for the source-filter dropdown.
  const feedAuthors = useMemo(() => {
    const seen = new Set<string>();
    for (const it of feedData?.items ?? []) {
      const a = (it.author || "").trim();
      if (a) seen.add(a);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [feedData]);

  // Mark all read lives in a single source's view only; the all-sources stream
  // is read by time, not cleared like an inbox.
  const handleMarkAllVisibleRead = useCallback(() => {
    markAllRead(visibleItems.map((it) => rssItemId(it)));
  }, [visibleItems, markAllRead]);

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

  // One row style for every story (components/news/NewsStoryRow). A picture
  // shows only when it's good enough (lib/news-image.ts): show art, logos and
  // tracker pixels never stand in for a story's own picture.
  const renderStory = (m: MergedItem<RSSItem>, variant: "lead" | "row") => {
    const id = rssItemId(m.item);
    const thumbnail = m.item.thumbnail || "";
    const fit = imageFit(thumbnail, { width: m.item.thumbnailWidth, feedImage: m.source.feedImage });
    return (
      <NewsStoryRow
        // The picture is part of the key, so a fresher copy of the story with a
        // different picture starts over instead of keeping the old fallback.
        key={`${variant}-${id}-${thumbnail}`}
        variant={variant}
        title={m.item.title}
        sourceName={m.source.name || "News"}
        timeLabel={storyTimeLabel(m.item.pubDate)}
        image={fit ? { url: thumbnail, ...fit } : null}
        isRead={isRead(id)}
        onOpen={() => handleOpenReader(m.item)}
      />
    );
  };

  // An episode in the Listen lane: the same row as a story, with its own Play
  // beside it. The show's art isn't repeated on every row (the show's name
  // says whose it is); tapping the row opens the episode in the reader.
  const renderEpisode = (m: MergedItem<RSSItem>) => {
    const id = rssItemId(m.item);
    const track = episodeTrack(m.item, { title: m.source.name, image: m.source.feedImage });
    const isCurrent = !!track && player.currentTrack?.audioUrl === track.audioUrl;
    const length = m.item.duration ? formatDuration(m.item.duration) : "";
    return (
      <NewsStoryRow
        key={`episode-${id}`}
        variant="row"
        title={m.item.title}
        sourceName={m.source.name || "Podcast"}
        timeLabel={[storyTimeLabel(m.item.pubDate), length].filter(Boolean).join(" · ")}
        image={null}
        isRead={isRead(id)}
        onOpen={() => handleOpenReader(m.item)}
        onPlay={track ? () => {
          markRead(id);
          if (isCurrent) player.togglePlay();
          else player.play(track);
        } : undefined}
        playing={isCurrent && player.isPlaying}
      />
    );
  };

  // A show suggested from Podcast Index's trending list, followed in one tap.
  const renderSuggestedShow = (feed: PodcastFeed) => {
    const following = existingUrls.has(feed.url);
    return (
      <div key={feed.id} className="flex items-center gap-3 px-2 py-3" data-testid="listen-suggested-show">
        {feed.image && (
          <img
            src={feed.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-12 w-12 shrink-0 rounded-md object-cover bg-muted/40"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-foreground">{feed.title}</p>
          {feed.author && <p className="truncate text-xs text-muted-foreground">{feed.author}</p>}
        </div>
        <Button
          variant="outline"
          className="h-11 shrink-0 px-4 text-sm"
          disabled={following}
          onClick={() => handleAddFeed(podcastFeedToSaved(feed))}
          data-testid={`button-follow-show-${feed.id}`}
        >
          {following ? "Following" : "Follow"}
        </Button>
      </div>
    );
  };

  // The starter stays a suggestion until you settle it (starterStatus in
  // lib/news-library.ts): one quiet line under the search with Keep and Edit.
  const [starterKept, setStarterKept] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NEWS_STARTER_KEPT_KEY) === "1";
    } catch {
      return false;
    }
  });
  // Re-read what's stored whenever this page changes the library (every
  // add / remove / rename goes through setFeeds after writing storage).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storedLibrary = useMemo(() => ({ custom: loadCustomFeeds(), hidden: loadHiddenDefaults() }), [feeds]);
  const libraryStatus = starterStatus(storedLibrary, { kept: starterKept });
  const sections = useMemo(() => sourceSections(storedLibrary, libraryStatus), [storedLibrary, libraryStatus]);
  const handleKeepStarter = useCallback(() => {
    setStarterKept(true);
    try {
      localStorage.setItem(NEWS_STARTER_KEPT_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  // The suggestion line is about your news sources, so it lives in News.
  const showSuggestedLine = isAllMode && lane === "news" && libraryStatus === "suggested";

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
    // Drop any stored copy AND hide the starter entry, so a renamed starter
    // source can't come back after a reload (lib/news-library.ts).
    const before = { custom: loadCustomFeeds(), hidden: loadHiddenDefaults() };
    const name = feeds.find((f) => f.url === url)?.name;
    const next = removeFromLibrary(before, url);
    saveCustomFeeds(next.custom);
    saveHiddenDefaults(next.hidden);
    setFeeds(prev => {
      const next = prev.filter(f => f.url !== url);
      if (activeFeedUrl === url && next.length > 0) {
        handleSelectFeed(next[0].url);
      }
      return next;
    });
    // Undo brings back this one source as it was, and nothing else
    // (restoreSource in lib/news-library.ts).
    toast({
      title: name ? `Removed ${name}` : "Source removed",
      action: (
        <ToastAction
          altText="Undo"
          className="h-11 px-4"
          onClick={() => {
            const restored = restoreSource({ custom: loadCustomFeeds(), hidden: loadHiddenDefaults() }, before, url);
            saveCustomFeeds(restored.custom);
            saveHiddenDefaults(restored.hidden);
            setFeeds(loadAllFeeds());
          }}
          data-testid="button-undo-remove-source"
        >
          Undo
        </ToastAction>
      ),
    });
  }, [activeFeedUrl, toast, handleSelectFeed, feeds]);

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
    // Restored defaults are suggestions again.
    setStarterKept(false);
    try { localStorage.removeItem(NEWS_STARTER_KEPT_KEY); } catch {}
    const defaults = [...DEFAULT_FEEDS];
    setFeeds(defaults);
    setActiveFeedUrl(""); // back to the merged "All feeds" thread
  }, [toast]);

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
      {/* One calm column at every width (2026-09 redesign): the desktop
          magazine breakout (hero + rail + grid) is gone. */}
      <div className="max-w-2xl mx-auto w-full">
      {/* Title header: only on the standalone page. On the focused News view
          (embedded) it's redundant — refresh + Add Feed are relocated into
          Row A (mobile) and a slim desktop action bar below. */}
      {!embedded && (
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground whitespace-nowrap" data-testid="text-rss-title">
              News
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              onClick={handleRefresh}
              disabled={isAllMode ? mergedFetching : isFetching}
              aria-label="Refresh"
              data-testid="button-refresh-feed"
            >
              <RefreshCw className={`w-4 h-4 ${(isAllMode ? mergedFetching : isFetching) ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      )}

        {/* Search (the app's search pill, which opens find-and-add), then your
            sources. Mark all read, the source filter and Visit site belong to
            a single source's view only. */}
        <div className="mb-4 space-y-2.5">
        <AddRssFeedDialog
          onAdd={handleAddFeed}
          existingUrls={existingUrls}
          onOpenFeed={handleSelectFeed}
          autoFocusSearch
          trigger={
            <button
              type="button"
              className={`${searchPillClass} relative flex items-center pl-10 pr-4 text-muted-foreground`}
              aria-label="Search news, blogs & podcasts"
              data-testid="button-open-feed-search"
            >
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <span className="truncate">Search news, blogs &amp; podcasts…</span>
            </button>
          }
        />
        {isAllMode && (
          <PageTabs
            ariaLabel="News or Listen"
            testId="news-lane-switch"
            className="[&_[role=tab]]:min-h-11"
            active={lane}
            onChange={chooseLane}
            tabs={[
              { key: "news", label: "News", testId: "tab-lane-news" },
              { key: "listen", label: "Listen", testId: "tab-lane-listen" },
            ]}
          />
        )}
        <div className="flex items-center gap-2" data-testid="container-feed-selector-mobile">
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
          {/* The starter, said plainly: suggestions you can keep in one tap or
              edit. The line goes once you keep them or add a source. */}
          {showSuggestedLine && (
            <p className="flex items-center gap-1 text-sm text-muted-foreground" data-testid="news-suggested-line">
              {sections.suggested.length} suggested {sections.suggested.length === 1 ? "source" : "sources"}
              <span aria-hidden="true">·</span>
              <Button variant="ghost" onClick={handleKeepStarter} className="h-11 px-2 text-sm font-medium text-brand hover:text-brand" data-testid="button-keep-starter">
                Keep
              </Button>
              <span aria-hidden="true">·</span>
            </p>
          )}
          <Drawer open={feedPopoverOpen} onOpenChange={setFeedPopoverOpen}>
            <DrawerTrigger asChild>
              {isAllMode ? (
                showSuggestedLine ? (
                  <Button variant="ghost" className="h-11 -ml-1 px-2 text-sm font-medium text-brand hover:text-brand" data-testid="button-feed-dropdown">
                    Edit
                  </Button>
                ) : (
                  // A quiet way into your sources; the stream itself is the page.
                  <Button variant="ghost" className="h-11 -ml-2 px-2 gap-1.5 text-sm font-normal text-muted-foreground hover:text-foreground" data-testid="button-feed-dropdown">
                    Your sources
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  </Button>
                )
              ) : (
              <Button variant="outline" size="sm" className="justify-between h-11 flex-1 min-w-0" data-testid="button-feed-dropdown">
                <span className="flex items-center gap-1.5 truncate">
                  <SourceFavicon
                    feedImage={activeFeed?.feedImage || feedData?.image}
                    link={feedData?.link}
                    siteUrl={activeFeed?.siteUrl || feedData?.link}
                    className="w-4 h-4 shrink-0"
                  />
                  <span className="truncate">{activeFeed?.name || "Select feed"}</span>
                  {feedData && feedData.items.length > 0 && visibleUnreadCount > 0 && (
                    <span className="text-muted-foreground tabular-nums shrink-0" data-testid="text-picker-unread">
                      · {visibleUnreadCount} unread
                    </span>
                  )}
                </span>
                <ChevronDown className="w-3.5 h-3.5 ml-2 text-muted-foreground shrink-0" />
              </Button>
              )}
            </DrawerTrigger>
            <DrawerContent className="border-border/20 bg-background/95 backdrop-blur-xl max-h-[80dvh] overflow-hidden flex flex-col">
              {/* Opaque backing: iOS WebKit can drop the composited background of a transform-animated
                  fixed container with a scrollable descendant (PRs #321/#322). */}
              <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 rounded-t-[10px] bg-background" data-testid="switch-feed-backing" />
              <DrawerHeader className="pb-2 border-b border-border/15 shrink-0">
                <DrawerTitle className="text-base font-semibold">Your sources</DrawerTitle>
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
                    <span className={`truncate ${isAllMode ? "font-medium" : ""}`}>All sources</span>
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
                {/* Suggested (the starter you haven't decided on), your news
                    sources, and the shows you follow (lib/news-library.ts). */}
                {([["Suggested", sections.suggested], ["News", sections.news], ["Shows", sections.shows]] as const).map(([label, sectionFeeds]) => {
                  if (sectionFeeds.length === 0) return null;
                  return (
                    <div key={label} className="mb-3" data-testid={`sources-section-${label.toLowerCase()}`}>
                      <p className="text-xs font-medium text-muted-foreground px-2 py-1.5">{label}</p>
                      <div className="space-y-1">
                        {sectionFeeds.map(feed => {
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
          {!isAllMode && feedData && visibleUnreadCount > 0 && (
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


        <div ref={articlesRef} className="min-w-0 space-y-3" data-testid="container-feed-content">
          {/* ── Merged "All feeds" thread (the default view) ── */}
          {isAllMode && lane === "news" && (
            <div data-testid="container-merged-thread">
              {mergedLoading && mergedItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <RelayOutpostLoader />
                  <p className="text-sm text-muted-foreground">Gathering your stories…</p>
                </div>
              )}

              {!mergedLoading && mergedVisibleItems.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-12 text-center" data-testid="news-empty">
                  <Newspaper className="w-7 h-7 text-muted-foreground" />
                  <p className="text-sm font-medium">Nothing to read yet</p>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    {feeds.length === 0
                      ? "Search above to add a source."
                      : mergedItems.length > 0
                        ? "Everything from your sources right now matches something you muted."
                        : "Your sources have no stories right now."}
                  </p>
                </div>
              )}

              {mergedVisibleItems.length > 0 && (
                <div className="space-y-6">
                  {/* One calm column (2026-09 redesign): a quiet lead, then your
                      stories under Today / Yesterday / weekday. One row style
                      throughout; the lead's size is the only contrast. */}
                  {mergedLead && renderStory(mergedLead, "lead")}
                  {mergedDays.map((day) => (
                    <section key={day.label} data-testid="news-day">
                      <h2 className="px-2 pb-1 text-sm font-semibold text-foreground">{day.label}</h2>
                      <div className="divide-y divide-border/50">
                        {day.items.map((m) => renderStory(m, "row"))}
                      </div>
                    </section>
                  ))}
                  {mergedRest.length > mergedVisibleCount && (
                    <div className="flex justify-center">
                      <Button
                        variant="ghost"
                        onClick={() => setMergedVisibleCount((n) => n + MERGED_PAGE)}
                        className="h-11 px-4 text-sm text-muted-foreground hover:text-foreground"
                        data-testid="button-load-more-merged"
                      >
                        Show more stories
                      </Button>
                    </div>
                  )}
                  {mergedLoading && (
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <RelayOutpostInlineLoader />
                      <span className="text-xs">Loading more stories…</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Listen: the new episodes of the shows you follow ── */}
          {isListen && (
            <div data-testid="container-listen">
              {listenMode === "loading" && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <RelayOutpostLoader />
                  <p className="text-sm text-muted-foreground">
                    {listenFeedSources.length > 0 ? "Gathering your shows…" : "Finding what people are listening to…"}
                  </p>
                </div>
              )}

              {listenMode === "episodes" && listenItems.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground" data-testid="listen-empty">
                  No new episodes from your shows right now.
                </p>
              )}

              {listenMode === "episodes" && listenItems.length > 0 && (
                <div className="space-y-6">
                  {listenDays.map((day) => (
                    <section key={day.label} data-testid="listen-day">
                      <h2 className="px-2 pb-1 text-sm font-semibold text-foreground">{day.label}</h2>
                      <div className="divide-y divide-border/50">
                        {day.items.map((m) => renderEpisode(m))}
                      </div>
                    </section>
                  ))}
                  {listenItems.length > listenVisibleCount && (
                    <div className="flex justify-center">
                      <Button
                        variant="ghost"
                        onClick={() => setListenVisibleCount((n) => n + MERGED_PAGE)}
                        className="h-11 px-4 text-sm text-muted-foreground hover:text-foreground"
                        data-testid="button-load-more-episodes"
                      >
                        Show more episodes
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {listenMode === "trending" && (
                <section data-testid="listen-trending">
                  <h2 className="px-2 text-sm font-semibold text-foreground">Trending in podcasts</h2>
                  <p className="px-2 pt-1 pb-2 text-sm text-muted-foreground">
                    You don't follow any shows yet. Here's what people are listening to, from Podcast Index.
                  </p>
                  <div className="divide-y divide-border/50">
                    {trending.feeds.map((feed) => renderSuggestedShow(feed))}
                  </div>
                </section>
              )}

              {listenMode === "unavailable" && (
                <div className="flex flex-col items-center gap-3 py-12 text-center" data-testid="listen-unavailable">
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Podcast suggestions aren't available right now. You can still find and follow shows by searching.
                  </p>
                  <AddRssFeedDialog
                    onAdd={handleAddFeed}
                    existingUrls={existingUrls}
                    onOpenFeed={handleSelectFeed}
                    autoFocusSearch
                    trigger={
                      <Button variant="outline" className="h-11 px-4" data-testid="button-find-podcasts">
                        Find podcasts
                      </Button>
                    }
                  />
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
