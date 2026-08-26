import { useEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import { MissionBriefing, ARTICLES_BRIEFING } from "@/components/MissionBriefing";
import { use$ } from "applesauce-react/hooks";
import { eventStore, pool, DEFAULT_RELAYS, FAST_RELAYS, fetchProfiles, publishEvent, throttledPoolSubscribe } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { KIND_LONG_FORM, parseArticle, type ArticleData } from "@/lib/nip23";
import { clientTags } from "@/lib/nostr-helpers";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { createShareMention } from "@/lib/share-mention";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useNostrBookmarks } from "@/hooks/use-nostr-bookmarks";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageTabs } from "@/components/PageTabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MediaRow, MediaHero, type MediaItemModel } from "@/components/media/MediaCard";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Link, useLocation } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { nip19 } from "nostr-tools";
import { formatDistanceToNow } from "date-fns";
import {
  getAvatarUrl,
  getDisplayName, getRealName,
  formatNpub,
  shortenNpub,
} from "@/lib/nostr-helpers";
import { estimateReadingTime } from "@/lib/nip23";
import { usePrimalStats } from "@/hooks/use-primal-stats";
import { prefetchStatsImmediate, primalStatsCache, fetchPrimalArticles } from "@/lib/primal-cache";
import { useToast } from "@/hooks/use-toast";
import { UnifiedArticleSearch } from "@/components/UnifiedArticleSearch";
import { KIND_METADATA, getProfileContent } from "@/lib/nostr-helpers";
import { fetchProfilesCached } from "@/lib/nostr";
import {
  X,
  Clock,
  Zap,
  MessageCircle,
  Heart,
  Repeat2,
  Users,
  PenSquare,
  LayoutGrid,
  LayoutList,
  BookOpen,
  Hash,
  Share2,
  Send,
  Flame,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  Filter,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Event } from "nostr-tools";
import { useSpamFilter } from "@/hooks/use-spam-filter";
import { GuestWall } from "@/components/GuestWall";

const KIND_TEXT_NOTE = 1;

const CURATED_TOPICS = [
  "ai", "alexandria", "amethyst", "bitcoin", "damus", "decentralization",
  "dvm", "entrepreneurship", "freedom", "gitcitadel", "lightning", "marmot",
  "nostr", "nostrrecap", "nostria", "opensource", "otherstuff", "praxeology",
  "primal", "privacy", "protocols", "saas", "security", "soapbox",
  "sovereignty", "verification", "war", "web of trust", "whitenoise",
  "wisp", "wot", "zap", "zapstore",
];

function ShareArticleToNostrDialog({ article, onClose }: { article: ArticleData; onClose: () => void }) {
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [isPublishing, setIsPublishing] = useState(false);

  const articleUrl = `${window.location.origin}/articles/${article.naddr}`;
  // Show the author's profile name in the editable prefill (raw npubs are
  // user-hostile); the mention is swapped back to a nostr:npub token at
  // publish time so other clients render a tappable @mention.
  const authorProfile = use$(() => eventStore.replaceable(0, article.event.pubkey), [article.event.pubkey]);
  const fallbackName = shortenNpub(formatNpub(article.event.pubkey));
  // Real name on purpose: this string is prefilled into a PUBLISHED post.
  const authorName = authorProfile ? (getRealName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const authorMention = useMemo(() => createShareMention(article.event.pubkey, authorName), [article.event.pubkey, authorName]);
  const defaultContent = `${article.title}${article.summary ? `\n\n${article.summary.slice(0, 200)}${article.summary.length > 200 ? "..." : ""}` : ""}${authorMention ? `\n\nby ${authorMention.display}` : ""}\n\n${articleUrl}`;
  const [content, setContent] = useState(defaultContent);
  const userEditedRef = useRef(false);

  // Refresh the prefill if the author's profile finishes loading after mount,
  // but never clobber text the user has already edited.
  useEffect(() => {
    if (!userEditedRef.current) setContent(defaultContent);
  }, [defaultContent]);

  const handleShare = async () => {
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in to share.", variant: "destructive" });
      return;
    }
    if (!content.trim()) return;

    setIsPublishing(true);
    try {
      const tags: string[][] = [];
      tags.push(["p", article.event.pubkey]);
      if (article.hashtags.length > 0) {
        article.hashtags.forEach((t) => tags.push(["t", t.toLowerCase()]));
      }
      tags.push(["r", articleUrl]);
      if (article.image) {
        tags.push(["r", article.image]);
      }
      tags.push(...clientTags());

      const eventTemplate = {
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: (authorMention ? authorMention.resolve(content) : content).trim(),
      };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      publishEvent(signedEvent, userRelays, undefined, isUserSelected).catch((err) => {
        console.error("Background publish failed:", err);
      });
      toast({ title: "Shared", description: "Article posted." });
      onClose();
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to share article:", err);
        toast({ title: "Failed to share", description: "Something went wrong.", variant: "destructive" });
      }
      setIsPublishing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-brand/[0.06] border border-brand/15 p-3 overflow-hidden">
        {article.image && (
          <div className="rounded-md overflow-hidden mb-2 max-h-32 bg-muted/20">
            <img src={article.image} alt={`${article.title || "Article"} cover`} className="w-full h-full object-cover max-h-32" loading="lazy" decoding="async" />
          </div>
        )}
        <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider mb-1.5">Sharing Article</p>
        <p className="text-sm font-medium text-foreground/90 line-clamp-2 break-words">{article.title}</p>
        {article.summary && (
          <p className="text-[11px] text-muted-foreground/60 mt-1 line-clamp-2 break-words">{article.summary}</p>
        )}
        <p className="text-[11px] text-muted-foreground/50 mt-1.5 break-all line-clamp-1">{articleUrl}</p>
      </div>

      <Textarea
        value={content}
        onChange={(e) => { userEditedRef.current = true; setContent(e.target.value); }}
        rows={5}
        className="text-sm resize-none bg-white/[0.04] border-white/[0.08] focus:border-brand/30 focus:bg-white/[0.06] rounded-lg break-words"
        style={{ wordBreak: "break-word", overflowWrap: "break-word" }}
        placeholder="Add your thoughts..."
        autoComplete="off"
        data-testid="textarea-share-article-content"
      />

      <p className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider leading-relaxed">
        This creates a public post with the article link. Others can reply and zap your post.
      </p>

      <div className="flex gap-2.5 pt-1">
        <Button
          variant="outline"
          onClick={onClose}
          className="flex-1 font-brand uppercase tracking-widest text-xs border-white/10 text-muted-foreground"
          data-testid="button-cancel-share-article"
        >
          Cancel
        </Button>
        <Button
          onClick={handleShare}
          disabled={isPublishing || !content.trim()}
          className="flex-1 bg-brand text-white font-brand uppercase tracking-widest text-xs border-0"
          data-testid="button-confirm-share-article"
        >
          {isPublishing ? (
            <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
          ) : (
            <Send className="w-3.5 h-3.5 mr-2" />
          )}
          {isPublishing ? "Posting..." : "Share"}
        </Button>
      </div>
    </div>
  );
}

type FeedTab = "trending" | "latest" | "following";
type ViewMode = "grid" | "list";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE = 350;
const MIN_CONTENT_LENGTH = 300;
const MIN_TITLE_LENGTH = 5;

function rawEngagement(stats: { zapAmount: number; replies: number; likes: number; reposts: number } | undefined): number {
  return (stats?.zapAmount ? Math.log10(stats.zapAmount + 1) * 3 : 0)
    + (stats?.replies ?? 0) * 2
    + (stats?.likes ?? 0)
    + (stats?.reposts ?? 0) * 1.5;
}

function hotScore(article: ArticleData, stats: { zapAmount: number; replies: number; likes: number; reposts: number } | undefined): number {
  const engagement = rawEngagement(stats);
  if (engagement <= 0) return -1;
  const now = Date.now() / 1000;
  const ageHours = Math.max(1, (now - article.publishedAt) / 3600);
  const velocity = engagement / Math.sqrt(ageHours);
  const hasImage = article.image ? 1.15 : 1;
  const hasSummary = article.summary ? 1.05 : 1;
  return velocity * hasImage * hasSummary;
}

function formatZapAmount(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}k`;
  return sats.toString();
}

function ArticleStats({ eventId }: { eventId: string }) {
  const stats = usePrimalStats(eventId);
  if (!stats) return null;

  const hasAny = stats.zaps > 0 || stats.replies > 0 || stats.likes > 0 || stats.reposts > 0;
  if (!hasAny) return null;

  return (
    <div className="flex items-center gap-2.5 flex-wrap" data-testid={`container-article-stats-${eventId}`}>
      {stats.zaps > 0 && (
        <span className="text-[11px] text-amber-800/80 dark:text-amber-400/80 flex items-center gap-0.5">
          <Zap className="w-2.5 h-2.5" />
          {formatZapAmount(stats.zapAmount)}
        </span>
      )}
      {stats.replies > 0 && (
        <span className="text-[11px] text-muted-foreground/70 flex items-center gap-0.5">
          <MessageCircle className="w-2.5 h-2.5" />
          {stats.replies}
        </span>
      )}
      {stats.likes > 0 && (
        <span className="text-[11px] text-muted-foreground/70 flex items-center gap-0.5">
          <Heart className="w-2.5 h-2.5" />
          {stats.likes}
        </span>
      )}
      {stats.reposts > 0 && (
        <span className="text-[11px] text-muted-foreground/70 flex items-center gap-0.5">
          <Repeat2 className="w-2.5 h-2.5" />
          {stats.reposts}
        </span>
      )}
    </div>
  );
}

// Articles render through the shared MediaRow/MediaHero (see MediaCard.tsx) so the
// Media hub's Articles list is visually identical to the News list: a top-story
// hero + flush glass-card rows. Q2/Q3 of the media-hub redesign.
const ArticleCard = memo(function ArticleCard({ article, asHero, heroBadge, onShare, isBookmarked, coord, toggleBookmark }: { article: ArticleData; asHero?: boolean; heroBadge?: React.ReactNode; onShare?: (article: ArticleData) => void; isBookmarked: boolean; coord: string; toggleBookmark: (coord: string, kind: string) => void }) {
  const [, navigate] = useLocation();
  const onToggleBookmark = useCallback(() => toggleBookmark(coord, "a"), [coord, toggleBookmark]);
  const authorProfile = use$(() => eventStore.replaceable(0, article.event.pubkey), [article.event.pubkey]);
  const fallbackName = shortenNpub(formatNpub(article.event.pubkey));
  const displayName = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(authorProfile);
  const readTime = estimateReadingTime(article.event.content);

  const timeAgo = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(article.publishedAt * 1000), { addSuffix: true });
    } catch {
      return "";
    }
  }, [article.publishedAt]);

  const actions = (
    <>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleBookmark(); }}
        className={`inline-flex items-center justify-center w-9 h-9 rounded-lg transition-colors shrink-0 cursor-pointer ${isBookmarked ? "text-brand" : "text-muted-foreground/60 hover:text-brand hover:bg-muted/50"}`}
        data-testid={`button-bookmark-article-${article.event.id}`}
        aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
      >
        {isBookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
      </button>
      {onShare && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShare(article); }}
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground/60 hover:text-brand hover:bg-muted/50 transition-colors shrink-0 cursor-pointer"
          data-testid={`button-share-article-${article.event.id}`}
          aria-label="Share"
        >
          <Share2 className="w-4 h-4" />
        </button>
      )}
    </>
  );

  const meta = (
    <>
      <span className="text-[11px] text-muted-foreground/70 flex items-center gap-0.5">
        <Clock className="w-2.5 h-2.5" /> {readTime} min
      </span>
      <ArticleStats eventId={article.event.id} />
    </>
  );

  const item: MediaItemModel = {
    id: article.event.id,
    title: article.title || "Untitled",
    summary: article.summary,
    image: article.image,
    byline: { name: displayName, avatar: avatarUrl },
    timeAgo,
    meta,
    onClick: () => navigate(`/articles/${article.naddr}`),
    actions,
  };

  if (asHero) {
    return (
      <MediaHero
        item={item}
        badge={heroBadge}
        placeholder={<BookOpen className="w-10 h-10 text-muted-foreground/20" />}
      />
    );
  }
  return <MediaRow item={item} />;
});

function ScrollSentinel({ onLoadMore, isLoading, hasMore }: { onLoadMore: () => void; isLoading: boolean; hasMore: boolean }) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoading && hasMore) onLoadMore();
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, isLoading, hasMore]);

  if (!hasMore) return null;

  return (
    <div ref={sentinelRef} className="flex items-center justify-center py-6" data-testid="container-articles-scroll-sentinel">
      {isLoading && <RelayOutpostInlineLoader className="w-5 h-5" />}
    </div>
  );
}

function ScopedAuthorChip({
  pubkey,
  displayName,
  picture,
  onClear,
}: {
  pubkey: string;
  displayName?: string;
  picture?: string;
  onClear: () => void;
}) {
  const profileEvent = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);

  useEffect(() => {
    if (!profileEvent) fetchProfilesCached([pubkey]);
  }, [pubkey, profileEvent]);

  const { name, avatar } = useMemo(() => {
    const content = profileEvent ? getProfileContent(profileEvent) : null;
    const fallback = (() => { try { return shortenNpub(formatNpub(pubkey)); } catch { return pubkey.slice(0, 8); } })();
    return {
      name: content?.display_name || content?.name || displayName || fallback,
      avatar: content?.picture || picture || "",
    };
  }, [profileEvent, displayName, picture, pubkey]);

  return (
    <div
      className="inline-flex items-center gap-2 pl-1 pr-1.5 py-1 rounded-full bg-brand/15 border border-brand/30 text-xs text-brand"
      data-testid={`chip-scoped-author-${pubkey.slice(0, 8)}`}
    >
      <Avatar className="w-5 h-5">
        {avatar ? <AvatarImage src={avatar} alt={name} /> : null}
        <AvatarFallback className="text-[9px] bg-brand/30">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="font-medium">Articles by {name}</span>
      <button
        onClick={onClear}
        className="p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
        aria-label="Clear author scope"
        data-testid="button-clear-scoped-author"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function ArticlesFeed({ embedded = false }: { embedded?: boolean } = {}) {
  const { pubkey, follows } = useNostrAuth();
  const { isBookmarked, toggleBookmark } = useNostrBookmarks();
  const [, setLocation] = useLocation();
  useDocumentTitle("Articles");
  // Trending is the landing lane (owner call, 2026-08-08): it's the strongest
  // first screen for everyone — a guest's Following is structurally empty, and
  // a new account's is near-empty, so landing there opened Articles on a blank.
  // Following/Latest stay one tap away in the same control row.
  const [tab, setTab] = useState<FeedTab>("trending");
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (typeof window !== "undefined" && window.innerWidth < 640 ? "list" : "grid"),
  );
  const [shareArticle, setShareArticle] = useState<ArticleData | null>(null);
  const stableOnShare = useMemo(() => pubkey ? setShareArticle : undefined, [pubkey]);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  const initialTag = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tag") || "";
  }, []);

  const [searchQuery, setSearchQuery] = useState(initialTag);
  const [searchInput, setSearchInput] = useState(initialTag);
  const [scopedAuthor, setScopedAuthor] = useState<{ pubkey: string; displayName?: string; picture?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [articles, setArticles] = useState<Event[]>([]);
  // Moderation: articles were the one feed skipping the shared spam/mute/report
  // filter. `filter` identity bumps on any mute/report, purging live.
  const { filter: moderationFilter } = useSpamFilter();
  const visibleArticles = useMemo(() => moderationFilter(articles), [articles, moderationFilter]);
  const [hasMoreArticles, setHasMoreArticles] = useState(true);
  const relayUntilRef = useRef(Math.floor(Date.now() / 1000));
  const primalUntilRef = useRef(Math.floor(Date.now() / 1000));
  const relayHasMoreRef = useRef(true);
  const primalHasMoreRef = useRef(true);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const profilesFetched = useRef(new Set<string>());
  const articleIdsRef = useRef(new Set<string>());
  const fetchTokenRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const [statsVersion, setStatsVersion] = useState(0);
  const [topicsDropdownOpen, setTopicsDropdownOpen] = useState(false);

  useEffect(() => {
    const key = "relay-outpost-scroll-/articles";
    const saved = sessionStorage.getItem(key);
    if (!saved) return;
    sessionStorage.removeItem(key);
    const y = parseInt(saved, 10);
    if (isNaN(y) || y <= 0) return;
    const timer = setInterval(() => {
      if (document.body.scrollHeight > y) {
        window.scrollTo(0, y);
        clearInterval(timer);
      }
    }, 200);
    const fallback = setTimeout(() => {
      clearInterval(timer);
      window.scrollTo(0, Math.min(y, document.body.scrollHeight - window.innerHeight));
    }, 3000);
    return () => { clearInterval(timer); clearTimeout(fallback); };
  }, []);

  const mergeAndApply = useCallback((relayEvents: Event[], primalEvents: Event[], token: number, primalFailed = false, scopedAuthorPubkey?: string) => {
    if (fetchTokenRef.current !== token) return;

    if (relayEvents.length > 0) {
      const minTs = Math.min(...relayEvents.map((e) => e.created_at));
      relayUntilRef.current = minTs - 1;
    }
    if (relayEvents.length < PAGE_SIZE) relayHasMoreRef.current = false;

    if (!primalFailed) {
      if (primalEvents.length > 0) {
        const minTs = Math.min(...primalEvents.map((e) => e.created_at));
        primalUntilRef.current = minTs - 1;
      }
      if (primalEvents.length < PAGE_SIZE) primalHasMoreRef.current = false;
    }

    setHasMoreArticles(relayHasMoreRef.current || primalHasMoreRef.current);

    const allSeenIds = new Set<string>();
    const merged: Event[] = [];
    for (const e of [...relayEvents, ...primalEvents]) {
      // Enforce the author scope defensively. The relay query filters by author,
      // but Primal's long_form_content_feed ignores the `pubkey` param and returns
      // the generic latest feed — without this, "Articles by X" leaked everyone
      // else's articles in from the Primal source.
      if (scopedAuthorPubkey && e.pubkey !== scopedAuthorPubkey) continue;
      if (!allSeenIds.has(e.id)) {
        allSeenIds.add(e.id);
        merged.push(e);
      }
    }
    merged.sort((a, b) => b.created_at - a.created_at);

    const pubkeys = Array.from(new Set(merged.map((e) => e.pubkey))).filter(
      (pk) => !profilesFetched.current.has(pk)
    );
    if (pubkeys.length > 0) {
      pubkeys.forEach((pk) => profilesFetched.current.add(pk));
      fetchProfiles(pubkeys);
    }

    const newEvents = merged.filter((e) => {
      if (articleIdsRef.current.has(e.id)) return false;
      articleIdsRef.current.add(e.id);
      return true;
    });

    if (newEvents.length > 0) {
      setArticles((prev) => [...prev, ...newEvents]);
      const eventIds = newEvents.map((e) => e.id);
      prefetchStatsImmediate(eventIds).then(() => {
        if (fetchTokenRef.current === token) setStatsVersion((v) => v + 1);
      }).catch(() => {});
    }

    setLoading(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, []);

  const fetchArticles = useCallback((until: number, isMore = false) => {
    if (!isMore) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    const token = fetchTokenRef.current;

    const relayUntil = isMore ? relayUntilRef.current : until;
    const primalUntil = isMore ? primalUntilRef.current : until;

    const filter: any = {
      kinds: [KIND_LONG_FORM],
      limit: PAGE_SIZE,
      until: relayUntil,
    };

    if (scopedAuthor) {
      filter.authors = [scopedAuthor.pubkey];
    } else if (tab === "following" && follows.length > 0) {
      filter.authors = follows;
    }

    const topic = searchQuery ? searchQuery.toLowerCase().replace(/^#/, "") : undefined;
    if (topic) {
      filter["#t"] = [topic];
    }

    const relayCollected: Event[] = [];
    let relayDone = false;
    let primalDone = false;
    let primalFailed = false;
    const primalCollected: Event[] = [];

    const tryFinalize = () => {
      if (!relayDone || !primalDone) return;
      mergeAndApply(relayCollected, primalCollected, token, primalFailed, scopedAuthor?.pubkey);
    };

    if (relayHasMoreRef.current || !isMore) {
      const sub = throttledPoolSubscribe(FAST_RELAYS, filter, {
        onevent(event: Event) {
          eventStore.add(event);
          relayCollected.push(event);
        },
        oneose() {
          sub.close();
          relayDone = true;
          tryFinalize();
        },
      });
    } else {
      relayDone = true;
    }

    // Skip Primal's long_form_content_feed when scoping to an author — it ignores
    // the pubkey param (returns the generic latest feed), so it can't scope and
    // would just paginate through others' articles we then filter out. The
    // relay query (authors: [pubkey]) is the correct author-scoped source.
    if (tab !== "following" && !scopedAuthor && (primalHasMoreRef.current || !isMore)) {
      fetchPrimalArticles(PAGE_SIZE, primalUntil, topic).then(({ articles }) => {
        primalCollected.push(...articles);
        primalDone = true;
        tryFinalize();
      }).catch(() => {
        primalFailed = true;
        primalDone = true;
        tryFinalize();
      });
    } else {
      primalDone = true;
    }

    if (relayDone && primalDone) {
      tryFinalize();
    }
  }, [tab, follows, searchQuery, scopedAuthor, mergeAndApply]);

  useEffect(() => {
    fetchTokenRef.current++;
    setArticles([]);
    articleIdsRef.current.clear();
    const now = Math.floor(Date.now() / 1000);
    relayUntilRef.current = now;
    primalUntilRef.current = now;
    relayHasMoreRef.current = true;
    primalHasMoreRef.current = true;
    setHasMoreArticles(true);
    fetchArticles(now);
  }, [tab, searchQuery, scopedAuthor, fetchArticles]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreArticles) return;
    loadingMoreRef.current = true;
    fetchArticles(0, true);
  }, [fetchArticles, hasMoreArticles]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const q = searchInput.trim();
      setSearchQuery(q);
      if (q && tabRef.current === "following") setTab("latest");
    }, SEARCH_DEBOUNCE);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchInput]);

  const parsedArticles = useMemo(() => {
    const seenByKey = new Map<string, ArticleData>();
    const seenByTitle = new Map<string, ArticleData>();
    const seenIds = new Set<string>();
    const parsed: ArticleData[] = [];

    const normalizeTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80);

    for (const event of visibleArticles) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);

      const a = parseArticle(event);
      if (!a.title || a.title.trim().length < MIN_TITLE_LENGTH) continue;
      if (a.event.content.length < MIN_CONTENT_LENGTH) continue;
      if (!a.summary && !a.image) continue;

      const key = `${a.event.pubkey}:${a.dTag}`;
      const existingByKey = seenByKey.get(key);
      if (existingByKey) {
        if (a.event.created_at > existingByKey.event.created_at) {
          const idx = parsed.indexOf(existingByKey);
          if (idx >= 0) parsed[idx] = a;
          seenByKey.set(key, a);
          seenByTitle.set(normalizeTitle(a.title), a);
        }
        continue;
      }

      const normTitle = normalizeTitle(a.title);
      const existingByTitle = seenByTitle.get(normTitle);
      if (existingByTitle) {
        if (a.event.created_at > existingByTitle.event.created_at) {
          const idx = parsed.indexOf(existingByTitle);
          if (idx >= 0) parsed[idx] = a;
          seenByKey.set(key, a);
          seenByTitle.set(normTitle, a);
        }
        continue;
      }

      seenByKey.set(key, a);
      seenByTitle.set(normTitle, a);
      parsed.push(a);
    }

    return parsed.sort((a, b) => b.publishedAt - a.publishedAt);
  }, [visibleArticles, tab]);

  const sortedArticles = useMemo(() => {
    if (tab === "trending") {
      const withStats = parsedArticles
        .map((a) => {
          const stats = primalStatsCache.get(a.event.id);
          return { article: a, stats, score: hotScore(a, stats) };
        })
        .filter((x) => x.score > 0);

      withStats.sort((a, b) => b.score - a.score);

      const deduped: ArticleData[] = [];
      const authorHits = new Map<string, number>();
      const AUTHOR_SPACING = 5;
      for (const x of withStats) {
        const pk = x.article.event.pubkey;
        const last = authorHits.get(pk);
        if (last !== undefined && deduped.length - last < AUTHOR_SPACING) continue;
        authorHits.set(pk, deduped.length);
        deduped.push(x.article);
      }
      return deduped;
    }
    return parsedArticles;
  }, [parsedArticles, tab, statsVersion]);


  const popularTags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    for (const a of parsedArticles) {
      for (const t of a.hashtags) {
        const lower = t.toLowerCase();
        tagCounts.set(lower, (tagCounts.get(lower) ?? 0) + 1);
      }
    }
    return Array.from(tagCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag);
  }, [parsedArticles]);

  const tabs: { id: FeedTab; label: string; icon: typeof Clock }[] = [
    { id: "following", label: "Following", icon: Users },
    { id: "latest", label: "Latest", icon: Clock },
    { id: "trending", label: "Trending", icon: Flame },
  ];

  // Hard wall (owner decision, 2026-08-14): the library is a browse surface,
  // so guests meet the wall outright — the earlier 8-article taste is gone.
  // A shared SINGLE article (/articles/:naddr) still renders for guests;
  // that link is the acquisition hook, this page is membership.
  if (!pubkey) {
    return (
      <div className={embedded ? "" : "max-w-5xl mx-auto px-3 sm:px-4 py-4"} data-testid="page-articles">
        <div className="max-w-2xl mx-auto pt-8">
          <GuestWall context="The article library is for members" />
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "" : "max-w-5xl mx-auto px-3 sm:px-4 py-4"}>
      <MissionBriefing pageId="articles" steps={ARTICLES_BRIEFING} />
      {!embedded && (
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-lg font-semibold text-foreground" data-testid="heading-articles">Articles</h1>
        </div>
      )}

      {/* One slim control row: sort (Following·Latest·Trending) + Write. */}
      <div data-testid="articles-tab-switcher">
      <div className="hidden sm:flex items-center justify-between gap-2 mb-4">
        <PageTabs
          equalWidth={false}
          ariaLabel="Article scope"
          active={tab}
          onChange={(key) => setTab(key as FeedTab)}
          tabs={tabs.map((t) => ({
            key: t.id,
            label: t.label,
            icon: t.icon,
            disabled: t.id === "following" && !pubkey,
            testId: `button-tab-${t.id}`,
          }))}
        />
        {pubkey && (
          <Button variant="default" size="sm" onClick={() => setLocation("/articles/write")} data-testid="button-write-article">
            <PenSquare className="w-3.5 h-3.5 mr-1.5" />
            Write
          </Button>
        )}
      </div>

      {/* Mobile has no separate scope row: the scope (Following/Latest/Trending)
          lives in the combined filter chip on the single control row below, and
          Write rides that row as an icon. One row of filters, then content. */}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Popover open={topicsDropdownOpen} onOpenChange={setTopicsDropdownOpen}>
          <PopoverTrigger asChild>
            {/* Styled to match the Audio hub row exactly: neutral select-style
                chip (h-10, border-input, bg-background) — active topic gets a
                subtle primary tint instead of a filled button. */}
            <button
              type="button"
              className={`flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors ${ searchQuery ? "border-brand/40 bg-brand/5 text-brand" : "border-input bg-background text-foreground hover:bg-muted/30" }`}
              data-testid="button-topics-dropdown"
            >
              <Filter className="w-3.5 h-3.5" />
              {/* Mobile: the chip is the combined scope+topic filter, so label it
                  with the active scope (or the active #topic). Desktop keeps
                  "Topics" — scope has its own button row there. */}
              <span className="sm:hidden">{searchQuery ? `#${searchQuery}` : (tabs.find((t) => t.id === tab)?.label ?? "Filter")}</span>
              <span className="hidden sm:inline">{searchQuery ? `#${searchQuery}` : "Topics"}</span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1.5 max-h-80 overflow-y-auto">
            <div className="sm:hidden">
              <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Show</p>
              {tabs.map((t) => {
                const isActive = tab === t.id;
                const disabled = t.id === "following" && !pubkey;
                return (
                  <button
                    key={t.id}
                    onClick={() => { if (!disabled) { setTab(t.id); setTopicsDropdownOpen(false); } }}
                    disabled={disabled}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                      isActive ? "bg-primary/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                    data-testid={`dropdown-tab-${t.id}`}
                  >
                    {isActive && <span className="w-1 h-1 rounded-full bg-primary shrink-0" />}
                    <t.icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
              <div className="my-1 border-t border-border/30" />
            </div>
            {searchQuery && (
              <button
                onClick={() => { setSearchInput(""); setSearchQuery(""); setTopicsDropdownOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer mb-1"
                data-testid="dropdown-topic-clear"
              >
                <X className="w-3.5 h-3.5" />
                Clear filter
              </button>
            )}
            <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Curated</p>
            {CURATED_TOPICS.map((tag) => {
              const isActive = searchQuery === tag;
              return (
                <button
                  key={tag}
                  onClick={() => { setSearchInput(tag); setSearchQuery(tag); if (tab === "following") setTab("latest"); setTopicsDropdownOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                    isActive ? "bg-primary/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                  data-testid={`dropdown-topic-${tag}`}
                >
                  {isActive && <span className="w-1 h-1 rounded-full bg-primary shrink-0" />}
                  <Hash className="w-3 h-3" />
                  {tag}
                </button>
              );
            })}
            {popularTags.filter((t) => !CURATED_TOPICS.includes(t)).length > 0 && (
              <>
                <div className="my-1 border-t border-border/30" />
                <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Trending</p>
                {popularTags.filter((t) => !CURATED_TOPICS.includes(t)).map((tag) => {
                  const isActive = searchQuery === tag;
                  return (
                    <button
                      key={tag}
                      onClick={() => { setSearchInput(tag); setSearchQuery(tag); if (tab === "following") setTab("latest"); setTopicsDropdownOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                        isActive ? "bg-primary/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      }`}
                      data-testid={`dropdown-topic-${tag}`}
                    >
                      {isActive && <span className="w-1 h-1 rounded-full bg-primary shrink-0" />}
                      <Hash className="w-3 h-3" />
                      {tag}
                    </button>
                  );
                })}
              </>
            )}
          </PopoverContent>
        </Popover>

        <UnifiedArticleSearch
          popularTags={popularTags}
          onSelect={(sel) => {
            if (sel.type === "hashtag") {
              setScopedAuthor(null);
              setSearchInput(sel.tag);
              setSearchQuery(sel.tag);
              if (tabRef.current === "following") setTab("latest");
            } else if (sel.type === "author") {
              setSearchInput("");
              setSearchQuery("");
              setScopedAuthor({ pubkey: sel.pubkey, displayName: sel.displayName, picture: sel.picture });
              if (tabRef.current === "following") setTab("latest");
            } else if (sel.type === "article") {
              setLocation(`/articles/${sel.naddr}`);
            }
          }}
        />
        {pubkey && (
          <Button variant="ghost" size="icon" className="shrink-0 sm:hidden text-muted-foreground/80 h-10 w-10" onClick={() => setLocation("/articles/write")} data-testid="button-write-article-mobile" aria-label="Write article">
            <PenSquare className="w-4 h-4" />
          </Button>
        )}
      </div>

      {(scopedAuthor || searchQuery) && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {scopedAuthor && (
            <ScopedAuthorChip
              pubkey={scopedAuthor.pubkey}
              displayName={scopedAuthor.displayName}
              picture={scopedAuthor.picture}
              onClear={() => setScopedAuthor(null)}
            />
          )}
          {searchQuery && (
            <button
              onClick={() => { setSearchInput(""); setSearchQuery(""); }}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-brand/15 border border-brand/30 text-xs text-brand hover:bg-brand/25 transition-colors"
              data-testid="chip-active-hashtag"
            >
              <Hash className="w-3 h-3" />
              <span>{searchQuery}</span>
              <span className="ml-0.5 p-0.5 rounded-full hover:bg-foreground/10">
                <X className="w-3 h-3" />
              </span>
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <RelayOutpostLoader size="lg" label="Scanning relays for articles..." />
        </div>
      ) : sortedArticles.length === 0 ? (
        <div className="text-center py-12">
          <BookOpen className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground" data-testid="text-no-articles">
            {searchQuery ? "No articles found for this search." : tab === "following" ? "No articles from people you follow." : "No articles found."}
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground/50 mb-3 uppercase tracking-wider">
            {sortedArticles.length} article{sortedArticles.length !== 1 ? "s" : ""}
          </p>

          <div className="space-y-2">
            {sortedArticles.map((article, i) => {
              const coord = `${KIND_LONG_FORM}:${article.event.pubkey}:${article.dTag}`;
              const heroBadge = tab === "following"
                ? <><Users className="w-3 h-3" /> Following</>
                : tab === "trending"
                  ? <><Flame className="w-3 h-3" /> Trending</>
                  : <><Clock className="w-3 h-3" /> Latest</>;
              return (
                <ArticleCard
                  key={article.event.id}
                  article={article}
                  asHero={i === 0}
                  heroBadge={heroBadge}
                  onShare={stableOnShare}
                  isBookmarked={isBookmarked(coord)}
                  coord={coord}
                  toggleBookmark={toggleBookmark}
                />
              );
            })}
          </div>

          <ScrollSentinel onLoadMore={loadMore} isLoading={loadingMore} hasMore={hasMoreArticles} />
        </>
      )}

      {shareArticle && (
        isMobile ? (
          <Drawer open={!!shareArticle} onOpenChange={(open) => { if (!open) setShareArticle(null); }}>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
                  <Share2 className="w-4 h-4" />
                  Share
                </DrawerTitle>
              </DrawerHeader>
              <div className="px-4 pb-6">
                <ShareArticleToNostrDialog article={shareArticle} onClose={() => setShareArticle(null)} />
              </div>
            </DrawerContent>
          </Drawer>
        ) : (
          <Dialog open={!!shareArticle} onOpenChange={(open) => { if (!open) setShareArticle(null); }}>
            <DialogContent className="max-w-sm sm:max-w-md glass-dialog-card border-brand/15 overflow-hidden">
              <DialogHeader>
                <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
                  <Share2 className="w-4 h-4" />
                  Share
                </DialogTitle>
              </DialogHeader>
              <ShareArticleToNostrDialog article={shareArticle} onClose={() => setShareArticle(null)} />
            </DialogContent>
          </Dialog>
        )
      )}
    </div>
  );
}
