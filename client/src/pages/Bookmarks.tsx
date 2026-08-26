import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { NostrPost } from "@/components/NostrPost";
import { useNostrBookmarks } from "@/hooks/use-nostr-bookmarks";
import { use$ } from "applesauce-react/hooks";
import { eventStore, subscribeToFeed, fetchProfiles, fetchInteractions, DEFAULT_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import { KIND_LONG_FORM, parseArticle } from "@/lib/nip23";
import { getAvatarUrl, getDisplayName, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Bookmark, BookmarkCheck, Trash2, Type, Image, Video, LinkIcon, SlidersHorizontal, ArrowUpDown, BookOpen, Newspaper, ExternalLink, Clock, Lock, Globe } from "lucide-react";
import { RelayOutpostLoader } from "@/components/RelayOutpostLoader";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { formatDistanceToNow } from "date-fns";
import { nip19 } from "nostr-tools";
import { estimateReadingTime } from "@/lib/nip23";
import {
  notifyNewsBookmarksChanged,
  NEWS_BOOKMARKS_UPDATED_EVENT,
  NEWS_BOOKMARKS_STORAGE_KEY as RSS_BOOKMARKS_KEY,
} from "@/lib/news-bookmark-sync";
import type { Event } from "nostr-tools";

type ContentFilter = "all" | "text" | "images" | "videos" | "links" | "articles" | "news";

const IMAGE_PATTERN = /https?:\/\/\S+\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)/i;
const VIDEO_PATTERN = /https?:\/\/\S+\.(mp4|webm|mov|avi|mkv)|https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv)\S*/i;
const ALL_URLS_PATTERN = /https?:\/\/\S+/gi;

interface RSSBookmarkItem {
  title: string;
  link: string;
  description: string;
  fullContent: string;
  pubDate: string;
  author: string;
  categories: string[];
  thumbnail: string;
  comments: string;
}

function readRssBookmarks(): RSSBookmarkItem[] {
  try {
    const stored = localStorage.getItem(RSS_BOOKMARKS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function classifyContent(event: Event): Set<ContentFilter> {
  const types = new Set<ContentFilter>();
  if (event.kind === KIND_LONG_FORM) {
    types.add("articles");
    return types;
  }
  const content = event.content;
  const hasImages = IMAGE_PATTERN.test(content);
  const hasVideos = VIDEO_PATTERN.test(content);
  if (hasImages) types.add("images");
  if (hasVideos) types.add("videos");
  const allUrls = content.match(ALL_URLS_PATTERN) || [];
  const hasNonMediaLink = allUrls.some(
    (url) => !IMAGE_PATTERN.test(url) && !VIDEO_PATTERN.test(url)
  );
  if (hasNonMediaLink) types.add("links");
  if (types.size === 0) types.add("text");
  return types;
}

function formatDateGroup(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (eventDay.getTime() === today.getTime()) return "Today";
  if (eventDay.getTime() === yesterday.getTime()) return "Yesterday";

  const diffDays = Math.floor((today.getTime() - eventDay.getTime()) / 86400000);
  if (diffDays < 7) return "This Week";
  if (diffDays < 30) return "This Month";

  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const FILTERS: { key: ContentFilter; label: string; icon: typeof Type }[] = [
  { key: "all", label: "All", icon: SlidersHorizontal },
  { key: "text", label: "Text", icon: Type },
  { key: "images", label: "Images", icon: Image },
  { key: "videos", label: "Videos", icon: Video },
  { key: "links", label: "Links", icon: LinkIcon },
  { key: "articles", label: "Articles", icon: BookOpen },
  { key: "news", label: "News", icon: Newspaper },
];

function PrivacyToggleBadge({
  isPrivate,
  onToggle,
  testId,
}: {
  isPrivate: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
        isPrivate
          ? "bg-brand/10 border-brand/25 text-brand hover:bg-brand/20"
          : "bg-brand/10 border-brand/25 text-brand dark:text-brand hover:bg-brand/20"
      }`}
      title={isPrivate ? "Private — click to make public" : "Public — click to make private"}
      data-testid={testId}
    >
      {isPrivate ? <Lock className="w-2.5 h-2.5" /> : <Globe className="w-2.5 h-2.5" />}
      <span>{isPrivate ? "Private" : "Public"}</span>
    </button>
  );
}

function BookmarkedPost({
  eventId,
  isPrivate,
  onRemove,
  onTogglePrivacy,
}: {
  eventId: string;
  isPrivate: boolean;
  onRemove: () => void;
  onTogglePrivacy: () => void;
}) {
  const event = use$(() => eventStore.event(eventId), [eventId]) ?? null;

  if (!event) {
    return (
      <div className="border border-border rounded-md py-4 px-4 flex items-center justify-between gap-4 flex-wrap" data-testid={`bookmark-missing-${eventId.slice(0, 8)}`}>
        <div className="flex items-center gap-2">
          <PrivacyToggleBadge isPrivate={isPrivate} onToggle={onTogglePrivacy} testId={`badge-privacy-missing-${eventId.slice(0, 8)}`} />
          <div>
            <p className="text-sm text-muted-foreground">Note not found on relays</p>
            <p className="text-xs text-muted-foreground/80 font-mono truncate max-w-xs">{eventId.slice(0, 24)}...</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground gap-1.5"
          onClick={onRemove}
          data-testid={`button-delete-bookmark-${eventId.slice(0, 8)}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end px-1">
        <PrivacyToggleBadge isPrivate={isPrivate} onToggle={onTogglePrivacy} testId={`badge-privacy-${eventId.slice(0, 8)}`} />
      </div>
      <NostrPost event={event} />
    </div>
  );
}

function BookmarkedArticle({ coord, isPrivate, onRemove, onTogglePrivacy }: { coord: string; isPrivate: boolean; onRemove: () => void; onTogglePrivacy: () => void }) {
  const parts = coord.split(":");
  const kind = parseInt(parts[0], 10);
  const pubkey = parts[1] || "";
  const dTag = parts[2] || "";

  const event = use$(() => eventStore.replaceable(kind, pubkey, dTag), [kind, pubkey, dTag]) ?? null;
  const authorProfile = use$(() => eventStore.replaceable(0, pubkey), [pubkey]);

  const article = useMemo(() => event ? parseArticle(event) : null, [event]);
  const fallbackName = shortenNpub(formatNpub(pubkey));
  const displayName = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(authorProfile);

  const timeAgo = useMemo(() => {
    if (!article) return "";
    try {
      return formatDistanceToNow(new Date(article.publishedAt * 1000), { addSuffix: true });
    } catch {
      return "";
    }
  }, [article]);

  const profileUrl = useMemo(() => {
    try {
      return `/profile/${nip19.npubEncode(pubkey)}`;
    } catch {
      return "#";
    }
  }, [pubkey]);

  if (!event || !article) {
    return (
      <div className="border border-border rounded-md py-4 px-4 flex items-center justify-between gap-4 flex-wrap" data-testid={`bookmark-missing-article-${dTag.slice(0, 8)}`}>
        <div className="flex items-center gap-2">
          <PrivacyToggleBadge isPrivate={isPrivate} onToggle={onTogglePrivacy} testId={`badge-privacy-article-missing-${dTag.slice(0, 8)}`} />
          <div>
            <p className="text-sm text-muted-foreground">Article not found on relays</p>
            <p className="text-xs text-muted-foreground/80 font-mono truncate max-w-xs">{coord.slice(0, 40)}...</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground gap-1.5"
          onClick={onRemove}
          data-testid={`button-delete-bookmark-article-${dTag.slice(0, 8)}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Remove
        </Button>
      </div>
    );
  }

  const readTime = estimateReadingTime(article.event.content);

  return (
    <Link href={`/articles/${article.naddr}`} data-testid={`bookmark-article-${article.event.id}`}>
      <Card className="glass-card p-3 flex gap-3 hover-elevate cursor-pointer">
        {article.image && (
          <div className="w-24 h-18 rounded-md overflow-hidden shrink-0 bg-muted/30">
            <img src={article.image} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold line-clamp-2" data-testid={`text-bookmark-article-title-${article.event.id}`}>
            {article.title || "Untitled"}
          </h3>
          {article.summary && (
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{article.summary}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Link href={profileUrl} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 shrink-0">
              <Avatar className="w-4 h-4 border border-border/50">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="text-[6px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="text-[11px] text-muted-foreground">{displayName}</span>
            </Link>
            <span className="text-[11px] text-muted-foreground/70">{timeAgo}</span>
            <span className="text-[11px] text-muted-foreground/70 flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" /> {readTime} min
            </span>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <div className="flex-1" />
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
              className="p-1 rounded-md text-muted-foreground/50 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 cursor-pointer"
              data-testid={`button-remove-bookmark-article-${article.event.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function BookmarkedRSSItem({ item, onRemove }: { item: RSSBookmarkItem; onRemove: () => void }) {
  const timeAgo = useMemo(() => {
    if (!item.pubDate) return "";
    try {
      return formatDistanceToNow(new Date(item.pubDate), { addSuffix: true });
    } catch {
      return "";
    }
  }, [item.pubDate]);

  return (
    <Card className="glass-card p-3 flex gap-3" data-testid={`bookmark-rss-${item.link}`}>
      {item.thumbnail && (
        <div className="w-20 h-16 rounded-md overflow-hidden shrink-0 bg-muted/30">
          <img src={item.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <h3 className="text-sm font-semibold line-clamp-2">{item.title || "Untitled"}</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {item.author && <span className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider truncate max-w-[120px]">{item.author}</span>}
          {timeAgo && <span className="text-[11px] text-muted-foreground/80">{timeAgo}</span>}
        </div>
        <div className="flex items-center gap-1 pt-0.5">
          <a href={item.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-6 px-2 gap-1">
              <ExternalLink className="w-3 h-3" /> Open
            </Button>
          </a>
          <div className="flex-1" />
          <button
            onClick={onRemove}
            className="p-1 rounded-md text-muted-foreground/50 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 cursor-pointer"
            data-testid={`button-remove-bookmark-rss-${item.link}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}

type BookmarkItem = {
  id: string;
  type: "e" | "a" | "rss";
  event?: Event | null;
  rssItem?: RSSBookmarkItem;
  timestamp: number;
};

export default function Bookmarks({ embedded = false }: { embedded?: boolean } = {}) {
  const { pubkey } = useNostrAuth();
  const { bookmarks, isLoading, removeBookmark, isPrivateBookmark, setBookmarkPrivacy } = useNostrBookmarks();
  useDocumentTitle("Bookmarks");
  const fetchedRef = useRef(new Set<string>());
  const articleFetchedRef = useRef(new Set<string>());
  const [eventsFetched, setEventsFetched] = useState(false);
  const [articlesFetched, setArticlesFetched] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ContentFilter>("all");
  const [sortNewest, setSortNewest] = useState(true);

  const [rssBookmarks, setRssBookmarks] = useState<RSSBookmarkItem[]>(() => readRssBookmarks());

  // Cross-device sync (news-bookmark-sync) can rewrite the stored list under
  // us after hydrating from relays — re-read so the page refreshes live.
  useEffect(() => {
    const onUpdated = () => setRssBookmarks(readRssBookmarks());
    window.addEventListener(NEWS_BOOKMARKS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(NEWS_BOOKMARKS_UPDATED_EVENT, onUpdated);
  }, []);

  const removeRssBookmark = useCallback((link: string) => {
    try {
      const items = readRssBookmarks();
      const updated = items.filter(i => i.link !== link);
      localStorage.setItem(RSS_BOOKMARKS_KEY, JSON.stringify(updated));
      setRssBookmarks(updated);
      // Tell the sync lib so the delete is tombstoned + published to relays.
      notifyNewsBookmarksChanged();
    } catch {}
  }, []);

  const eventIds = useMemo(() => {
    return bookmarks
      .filter((b) => b.type === "e")
      .map((b) => b.id);
  }, [bookmarks]);

  const articleCoords = useMemo(() => {
    return bookmarks
      .filter((b) => b.type === "a")
      .map((b) => b.id);
  }, [bookmarks]);

  useEffect(() => {
    if (eventIds.length === 0) {
      setEventsFetched(true);
      return;
    }
    const toFetch = eventIds.filter((id) => !fetchedRef.current.has(id));
    if (toFetch.length === 0) return;
    toFetch.forEach((id) => fetchedRef.current.add(id));
    setEventsFetched(false);

    const batchSize = 50;
    const subs: { close: () => void }[] = [];
    const totalBatches = Math.ceil(toFetch.length / batchSize);
    let completedBatches = 0;

    const onBatchComplete = (batch: string[]) => {
      const resolved = batch
        .map((id) => {
          const results = eventStore.getByFilters({ ids: [id] });
          return [...results][0];
        })
        .filter(Boolean);
      const pubkeys = Array.from(new Set(resolved.map((e) => e!.pubkey)));
      if (pubkeys.length > 0) fetchProfiles(pubkeys, DEFAULT_RELAYS);
      const resolvedIds = resolved.map((e) => e!.id);
      if (resolvedIds.length > 0) fetchInteractions(resolvedIds, DEFAULT_RELAYS);

      completedBatches++;
      if (completedBatches >= totalBatches) {
        setEventsFetched(true);
      }
    };

    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      const sub = subscribeToFeed({ ids: batch }, DEFAULT_RELAYS, () => onBatchComplete(batch));
      subs.push(sub);
    }

    const timeout = setTimeout(() => setEventsFetched(true), 10000);

    return () => {
      clearTimeout(timeout);
      subs.forEach((s) => { try { s.close(); } catch {} });
    };
  }, [eventIds]);

  useEffect(() => {
    if (articleCoords.length === 0) {
      setArticlesFetched(true);
      return;
    }
    const toFetch = articleCoords.filter((c) => !articleFetchedRef.current.has(c));
    if (toFetch.length === 0) {
      setArticlesFetched(true);
      return;
    }
    toFetch.forEach((c) => articleFetchedRef.current.add(c));
    setArticlesFetched(false);

    const subs: { close: () => void }[] = [];
    let completed = 0;

    for (const coord of toFetch) {
      const parts = coord.split(":");
      if (parts.length < 3) { completed++; continue; }
      const kind = parseInt(parts[0], 10);
      const authorPubkey = parts[1];
      const dTag = parts[2];

      const sub = throttledPoolSubscribe(
        DEFAULT_RELAYS,
        { kinds: [kind], authors: [authorPubkey], "#d": [dTag] },
        {
          onevent(event: Event) {
            eventStore.add(event);
            fetchProfiles([event.pubkey], DEFAULT_RELAYS);
          },
          oneose() {
            completed++;
            if (completed >= toFetch.length) setArticlesFetched(true);
          },
        }
      );
      subs.push(sub);
    }

    const timeout = setTimeout(() => setArticlesFetched(true), 10000);

    return () => {
      clearTimeout(timeout);
      subs.forEach((s) => { try { s.close(); } catch {} });
    };
  }, [articleCoords]);

  const resolvedEvents = useMemo(() => {
    return eventIds
      .map((id) => {
        const results = eventStore.getByFilters({ ids: [id] });
        return [...results][0] ?? null;
      });
  }, [eventIds, eventsFetched]);

  const allItems = useMemo<BookmarkItem[]>(() => {
    const items: BookmarkItem[] = [];

    eventIds.forEach((id, i) => {
      items.push({
        id,
        type: "e",
        event: resolvedEvents[i],
        timestamp: resolvedEvents[i]?.created_at ?? 0,
      });
    });

    articleCoords.forEach((coord) => {
      const parts = coord.split(":");
      const kind = parseInt(parts[0], 10);
      const authorPubkey = parts[1] || "";
      const dTag = parts[2] || "";
      const results = eventStore.replaceable(kind, authorPubkey, dTag);
      const event = results ?? null;
      items.push({
        id: coord,
        type: "a",
        event,
        timestamp: event?.created_at ?? 0,
      });
    });

    rssBookmarks.forEach((rss) => {
      const ts = rss.pubDate ? Math.floor(new Date(rss.pubDate).getTime() / 1000) : 0;
      items.push({
        id: `rss:${rss.link}`,
        type: "rss",
        rssItem: rss,
        timestamp: ts,
      });
    });

    return items;
  }, [eventIds, resolvedEvents, articleCoords, rssBookmarks, articlesFetched]);

  const filteredAndSorted = useMemo(() => {
    const filtered = activeFilter === "all"
      ? allItems
      : activeFilter === "articles"
        ? allItems.filter((item) => item.type === "a")
        : activeFilter === "news"
          ? allItems.filter((item) => item.type === "rss")
          : allItems.filter((item) => {
              if (item.type !== "e" || !item.event) return false;
              const types = classifyContent(item.event);
              return types.has(activeFilter);
            });

    return [...filtered].sort((a, b) => {
      return sortNewest ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
    });
  }, [allItems, activeFilter, sortNewest]);

  const grouped = useMemo(() => {
    const groups: { label: string; items: typeof filteredAndSorted }[] = [];
    let currentLabel = "";

    for (const item of filteredAndSorted) {
      const label = item.timestamp ? formatDateGroup(item.timestamp) : "Unknown";
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, items: [] });
      }
      groups[groups.length - 1].items.push(item);
    }

    return groups;
  }, [filteredAndSorted]);

  const filterCounts = useMemo(() => {
    const counts: Record<ContentFilter, number> = { all: 0, text: 0, images: 0, videos: 0, links: 0, articles: 0, news: 0 };
    for (const item of allItems) {
      counts.all++;
      if (item.type === "a") {
        counts.articles++;
      } else if (item.type === "rss") {
        counts.news++;
      } else if (item.event) {
        const types = classifyContent(item.event);
        if (types.has("text")) counts.text++;
        if (types.has("images")) counts.images++;
        if (types.has("videos")) counts.videos++;
        if (types.has("links")) counts.links++;
      }
    }
    return counts;
  }, [allItems]);

  const totalCount = allItems.length;
  const showLoading = isLoading || (!eventsFetched && eventIds.length > 0) || (!articlesFetched && articleCoords.length > 0);

  return (
    <div className={embedded ? "" : "px-3 sm:px-4 py-4 sm:py-6"} data-testid="page-bookmarks">
      <div className={embedded ? "" : "max-w-2xl mx-auto"}>
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-brand/70" />
            <h1 className="text-lg font-semibold text-foreground" data-testid="text-bookmarks-title">Bookmarks</h1>
          </div>
          {!isLoading && (
            <p className="text-sm text-muted-foreground mt-1">
              {totalCount} {totalCount === 1 ? "saved item" : "saved items"}
              {activeFilter !== "all" && ` · ${filteredAndSorted.length} matching`}
            </p>
          )}
        </div>

        {!pubkey ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="container-bookmarks-signin">
            <Bookmark className="w-12 h-12 text-muted-foreground/60 mb-3" />
            <p className="text-sm font-medium mb-1">Sign in to view bookmarks</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Your bookmarks are private and require signing in to view.
            </p>
          </div>
        ) : showLoading ? (
          <div className="flex flex-col items-center justify-center py-16" data-testid="container-bookmarks-loading">
            <RelayOutpostLoader size="lg" label="Loading bookmarks..." />
          </div>
        ) : totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="container-bookmarks-empty">
            <Bookmark className="w-12 h-12 text-muted-foreground/60 mb-3" />
            <p className="text-sm font-medium mb-1">No bookmarks yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Save notes, articles, or news items by clicking the bookmark icon.
            </p>
            <Button variant="outline" size="sm" className="mt-4" asChild data-testid="button-browse-feed">
              <Link href="/">Browse Feed</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-4" data-testid="container-bookmark-filters">
              {FILTERS.map((f) => {
                const Icon = f.icon;
                const count = filterCounts[f.key];
                const isActive = activeFilter === f.key;
                if (f.key !== "all" && count === 0) return null;
                return (
                  <Button
                    key={f.key}
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    className={`gap-1 sm:gap-1.5 text-[11px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3 transition-all duration-200 ${
                      isActive
                        ? "bg-brand dark:bg-brand/15 text-brand border border-brand/40 dark:border-brand/30 shadow-[0_0_8px_rgba(109,40,217,0.15)] dark:shadow-[0_0_8px_rgba(168,85,247,0.2)] no-default-hover-elevate"
                        : "text-muted-foreground/70"
                    }`}
                    onClick={() => setActiveFilter(f.key)}
                    data-testid={`button-filter-${f.key}`}
                  >
                    <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span className={f.key === "all" ? "" : "hidden sm:inline"}>{f.label}</span>
                    <span className={`text-[10px] ${isActive ? "opacity-70" : "opacity-50"}`}>
                      {count}
                    </span>
                  </Button>
                );
              })}

              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-[11px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3 ml-auto text-muted-foreground/60"
                onClick={() => setSortNewest((p) => !p)}
                data-testid="button-sort-bookmarks"
              >
                <ArrowUpDown className="w-3 h-3" />
                {sortNewest ? "Newest" : "Oldest"}
              </Button>
            </div>

            {filteredAndSorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-bookmarks-no-match">
                <p className="text-sm text-muted-foreground">No bookmarks match this filter</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={() => setActiveFilter("all")}
                  data-testid="button-clear-filter"
                >
                  Show all
                </Button>
              </div>
            ) : (
              <div className="space-y-6" data-testid="container-bookmarks-list">
                {grouped.map((group) => (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/50" data-testid={`text-date-group-${group.label}`}>
                        {group.label}
                      </span>
                      <div className="flex-1 h-px bg-border/30" />
                      <span className="text-[11px] text-muted-foreground/50">{group.items.length}</span>
                    </div>
                    <div className="space-y-3">
                      {group.items.map((item) => {
                        if (item.type === "a") {
                          return (
                            <BookmarkedArticle
                              key={item.id}
                              coord={item.id}
                              isPrivate={isPrivateBookmark(item.id)}
                              onRemove={() => removeBookmark(item.id)}
                              onTogglePrivacy={() => setBookmarkPrivacy(item.id, !isPrivateBookmark(item.id))}
                            />
                          );
                        }
                        if (item.type === "rss" && item.rssItem) {
                          return (
                            <BookmarkedRSSItem
                              key={item.id}
                              item={item.rssItem}
                              onRemove={() => removeRssBookmark(item.rssItem!.link)}
                            />
                          );
                        }
                        return (
                          <BookmarkedPost
                            key={item.id}
                            eventId={item.id}
                            isPrivate={isPrivateBookmark(item.id)}
                            onRemove={() => removeBookmark(item.id)}
                            onTogglePrivacy={() => setBookmarkPrivacy(item.id, !isPrivateBookmark(item.id))}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
