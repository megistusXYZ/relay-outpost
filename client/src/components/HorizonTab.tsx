import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { pool, fetchProfilesCached, eventStore } from "@/lib/nostr";
import { KIND_LONG_FORM, parseArticle, estimateReadingTime, DEFAULT_HORIZON_SECTIONS } from "@/lib/nip23";
import type { ArticleData, HorizonContentType } from "@/lib/nip23";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useOutpostCompose } from "@/contexts/OutpostComposeContext";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { HorizonNewEntryDialog } from "@/components/HorizonNewEntryDialog";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchPill } from "@/components/SearchPill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { use$ } from "applesauce-react/hooks";
import {
  getAvatarUrl,
  getDisplayName,
  KIND_METADATA,
  formatNpub,
  shortenNpub,
} from "@/lib/nostr-helpers";
import { formatDistanceToNow } from "date-fns";
import {
  Search,
  BookOpen,
  Clock,
  Plus,
  X,
  Video,
  Music,
  FileDown,
  ExternalLink,
  FileText,
  FolderOpen,
  Info,
  ChevronDown,
  ChevronUp,
  Layers,
  Compass,
  Sparkles,
  MessageSquareOff,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { HorizonIcon } from "@/components/icons/HorizonIcon";

type HorizonSortMode = "newest" | "oldest" | "updated";

function ContentTypeIcon({ type, className }: { type: HorizonContentType; className?: string }) {
  switch (type) {
    case "video": return <Video className={className} />;
    case "audio": return <Music className={className} />;
    case "file": return <FileDown className={className} />;
    case "link": return <ExternalLink className={className} />;
    default: return <FileText className={className} />;
  }
}

const CONTENT_TYPE_COLORS: Record<HorizonContentType, string> = {
  article: "text-brand/60 bg-brand/8 border-brand/15",
  video: "text-blue-600/60 dark:text-blue-400/60 bg-blue-500/8 border-blue-500/15",
  audio: "text-emerald-600/60 dark:text-emerald-400/60 bg-emerald-500/8 border-emerald-500/15",
  file: "text-amber-600/60 dark:text-amber-400/60 bg-amber-500/8 border-amber-500/15",
  link: "text-cyan-600/60 dark:text-cyan-400/60 bg-cyan-500/8 border-cyan-500/15",
};

function ArticleAuthorLine({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Avatar className="w-5 h-5 shrink-0">
        <AvatarImage src={avatar} alt={name} />
        <AvatarFallback className="bg-brand/20 text-brand text-[8px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-[11px] text-muted-foreground/70 truncate">{name}</span>
    </div>
  );
}

function HorizonArticleCard({ article, relayUrl }: { article: ArticleData; relayUrl: string }) {
  const readTime = estimateReadingTime(article.event.content);

  const naddr = useMemo(() => {
    try {
      return nip19.naddrEncode({
        identifier: article.dTag,
        pubkey: article.event.pubkey,
        kind: KIND_LONG_FORM,
        relays: [relayUrl],
      });
    } catch {
      return article.naddr;
    }
  }, [article.dTag, article.event.pubkey, relayUrl, article.naddr]);

  const summaryText = useMemo(() => {
    if (article.summary) return article.summary;
    const plain = article.event.content
      .replace(/^#+\s.*/gm, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
      .replace(/[*_~`#>-]/g, "")
      .replace(/\n+/g, " ")
      .trim();
    return plain.slice(0, 180) + (plain.length > 180 ? "…" : "");
  }, [article.summary, article.event.content]);

  const typeColors = CONTENT_TYPE_COLORS[article.contentType];

  return (
    <Link href={`/articles/${naddr}`}>
      <Card className="glass-card overflow-hidden group cursor-pointer hover:border-primary/30 transition-all duration-200 hover:shadow-lg hover:shadow-brand/5 h-full flex flex-col">
        {article.image && (
          <div className="aspect-[16/9] overflow-hidden bg-muted/20 relative">
            <img
              src={article.image}
              alt={article.title}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
              loading="lazy"
            />
            {article.contentType !== "article" && (
              <div className={`absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium border backdrop-blur-sm ${typeColors}`}>
                <ContentTypeIcon type={article.contentType} className="w-2.5 h-2.5" />
                {article.contentType}
              </div>
            )}
          </div>
        )}
        <div className="p-3 sm:p-4 flex flex-col flex-1 gap-2">
          <div className="flex items-start gap-2">
            <h3 className="text-sm font-semibold text-foreground/90 line-clamp-2 group-hover:text-brand transition-colors leading-snug flex-1">
              {article.title || "Untitled"}
            </h3>
            {!article.image && article.contentType !== "article" && (
              <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium border shrink-0 ${typeColors}`}>
                <ContentTypeIcon type={article.contentType} className="w-2.5 h-2.5" />
              </div>
            )}
          </div>

          {article.section && (
            <Badge
              variant="outline"
              className="text-[9px] h-4 px-1.5 border-brand/20 text-brand/70 bg-brand/5 w-fit"
            >
              <FolderOpen className="w-2 h-2 mr-0.5" />
              {article.section}
            </Badge>
          )}

          {summaryText && (
            <p className="text-[11px] text-muted-foreground/50 line-clamp-3 leading-relaxed flex-1">
              {summaryText}
            </p>
          )}

          {article.hashtags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {article.hashtags.slice(0, 3).map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-[9px] h-4 px-1.5 border-brand/15 text-brand/60 bg-brand/5"
                >
                  {tag}
                </Badge>
              ))}
              {article.hashtags.length > 3 && (
                <span className="text-[9px] text-muted-foreground/30">+{article.hashtags.length - 3}</span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1 mt-auto border-t border-border/20">
            <ArticleAuthorLine pubkey={article.event.pubkey} />
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40 shrink-0">
              {article.commentsDisabled && (
                <span className="flex items-center gap-0.5 text-amber-500/50" title="Comments disabled">
                  <MessageSquareOff className="w-2.5 h-2.5" />
                </span>
              )}
              <span className="flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {readTime} min
              </span>
              <span>·</span>
              <span>{formatDistanceToNow(article.publishedAt * 1000, { addSuffix: true })}</span>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function HorizonSkeletonCard() {
  return (
    <Card className="glass-card overflow-hidden">
      <div className="aspect-[16/9] bg-muted/20 animate-pulse" />
      <div className="p-3 sm:p-4 space-y-3">
        <div className="h-4 bg-muted/20 rounded animate-pulse w-3/4" />
        <div className="space-y-1.5">
          <div className="h-3 bg-muted/10 rounded animate-pulse" />
          <div className="h-3 bg-muted/10 rounded animate-pulse w-2/3" />
        </div>
        <div className="flex gap-1">
          <div className="h-4 w-12 bg-muted/10 rounded animate-pulse" />
          <div className="h-4 w-10 bg-muted/10 rounded animate-pulse" />
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-border/20">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-muted/20 animate-pulse" />
            <div className="h-3 w-16 bg-muted/10 rounded animate-pulse" />
          </div>
          <div className="h-3 w-20 bg-muted/10 rounded animate-pulse" />
        </div>
      </div>
    </Card>
  );
}

function SectionNav({
  sections,
  totalArticles,
  selectedSection,
  onSelect,
}: {
  sections: { name: string; count: number }[];
  totalArticles: number;
  selectedSection: string | null;
  onSelect: (section: string | null) => void;
}) {
  const showDefaults = sections.length === 0;

  return (
    <div className="flex gap-1.5 overflow-x-auto md:flex-wrap md:overflow-x-visible pb-1 -mx-1 px-1">
      <button
        onClick={() => onSelect(null)}
        className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-200 ${
          selectedSection === null
            ? "bg-accent text-accent-foreground dark:text-brand ring-1 ring-primary/20"
            : "text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-muted/20"
        }`}
      >
        All
        {totalArticles > 0 && (
          <span className="text-[9px] opacity-60">{totalArticles}</span>
        )}
      </button>

      {sections.map((s) => (
        <button
          key={s.name}
          onClick={() => onSelect(selectedSection === s.name ? null : s.name)}
          className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-200 ${
            selectedSection === s.name
              ? "bg-accent text-accent-foreground dark:text-brand ring-1 ring-primary/20"
              : "text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-muted/20"
          }`}
        >
          <FolderOpen className="w-2.5 h-2.5" />
          {s.name}
          <span className="text-[9px] opacity-60">{s.count}</span>
        </button>
      ))}

      {showDefaults && DEFAULT_HORIZON_SECTIONS.map((name) => (
        <span
          key={name}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-muted-foreground/25 border border-dashed border-border/20"
        >
          <FolderOpen className="w-2.5 h-2.5" />
          {name}
        </span>
      ))}
    </div>
  );
}

export function HorizonTab({
  relayUrl,
  externalRefreshKey,
  canPostHorizon = false,
  trustFilterEnabled = false,
  isHiddenByTrust,
  onTrustHidden,
}: {
  relayUrl: string;
  externalRefreshKey?: number;
  canPostHorizon?: boolean;
  trustFilterEnabled?: boolean;
  isHiddenByTrust?: (pubkey: string) => boolean;
  onTrustHidden?: (count: number) => void;
}) {
  const { pubkey } = useNostrAuth();
  const { horizonDialogOpen, setHorizonDialogOpen } = useOutpostCompose();
  const [articles, setArticles] = useState<ArticleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<HorizonSortMode>("newest");
  const [showLearnMore, setShowLearnMore] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  useEffect(() => {
    if (!canPostHorizon) return;
    const handler = () => setHorizonDialogOpen(true);
    window.addEventListener("horizon-new-entry", handler);
    return () => window.removeEventListener("horizon-new-entry", handler);
  }, [setHorizonDialogOpen, canPostHorizon]);

  useEffect(() => {
    let unmounted = false;
    const eventMap = new Map<string, Event>();
    const authorSet = new Set<string>();
    let eoseReceived = false;

    setArticles([]);
    setLoading(true);

    function flushArticles() {
      if (unmounted) return;
      const parsed = Array.from(eventMap.values())
        .map((e) => parseArticle(e))
        .filter((a) => a.title);
      setArticles(parsed);
    }

    const sub = pool.subscribeMany(
      [relayUrl],
      { kinds: [KIND_LONG_FORM], limit: 100 },
      {
        onevent(e: Event) {
          if (unmounted) return;
          const dTag = e.tags.find((t) => t[0] === "d")?.[1] || "";
          const key = `${e.pubkey}:${dTag}`;
          const existing = eventMap.get(key);
          if (!existing || e.created_at > existing.created_at) {
            eventMap.set(key, e);
            eventStore.add(e);
            const isNewAuthor = !authorSet.has(e.pubkey);
            authorSet.add(e.pubkey);
            if (isNewAuthor) fetchProfilesCached([e.pubkey]);

            if (eoseReceived) {
              flushArticles();
            }
          }
        },
        oneose() {
          if (unmounted) return;
          eoseReceived = true;
          clearTimeout(timer);
          flushArticles();
          setLoading(false);
        },
      },
    );

    const timer = setTimeout(() => {
      if (!eoseReceived && !unmounted) {
        eoseReceived = true;
        flushArticles();
        setLoading(false);
      }
    }, 12000);

    return () => {
      unmounted = true;
      sub.close();
      clearTimeout(timer);
    };
  }, [relayUrl, externalRefreshKey]);

  const sections = useMemo(() => {
    const sectionMap = new Map<string, number>();
    for (const a of articles) {
      if (a.section) {
        sectionMap.set(a.section, (sectionMap.get(a.section) || 0) + 1);
      }
    }
    return Array.from(sectionMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [articles]);

  const allTags = useMemo(() => {
    const tagMap = new Map<string, number>();
    for (const a of articles) {
      for (const t of a.hashtags) {
        tagMap.set(t, (tagMap.get(t) || 0) + 1);
      }
    }
    return Array.from(tagMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [articles]);

  const filteredArticles = useMemo(() => {
    let result = [...articles];

    if (selectedSection) {
      result = result.filter((a) => a.section === selectedSection);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) =>
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.hashtags.some((t) => t.includes(q)) ||
        a.section.toLowerCase().includes(q)
      );
    }

    if (selectedTag) {
      result = result.filter((a) => a.hashtags.includes(selectedTag));
    }

    switch (sortMode) {
      case "newest":
        result.sort((a, b) => b.publishedAt - a.publishedAt);
        break;
      case "oldest":
        result.sort((a, b) => a.publishedAt - b.publishedAt);
        break;
      case "updated":
        result.sort((a, b) => b.event.created_at - a.event.created_at);
        break;
    }

    return result;
  }, [articles, searchQuery, selectedTag, selectedSection, sortMode]);

  // Apply the outpost trust filter LAST, after all existing filtering/sorting.
  // The parent's predicate handles unscored/loading state, so this stays flicker-safe.
  const visibleArticles = useMemo(() => {
    if (!trustFilterEnabled || !isHiddenByTrust) return filteredArticles;
    return filteredArticles.filter((a) => !isHiddenByTrust(a.event.pubkey));
  }, [filteredArticles, trustFilterEnabled, isHiddenByTrust]);

  const hiddenCount =
    trustFilterEnabled && isHiddenByTrust
      ? filteredArticles.length - visibleArticles.length
      : 0;

  useEffect(() => {
    onTrustHidden?.(trustFilterEnabled ? hiddenCount : 0);
  }, [onTrustHidden, trustFilterEnabled, hiddenCount]);

  return (
    <div className="space-y-3">
      {canPostHorizon && (
        <HorizonNewEntryDialog
          open={horizonDialogOpen}
          onOpenChange={setHorizonDialogOpen}
          relayUrl={relayUrl}
        />
      )}
      {/* ONE control row (media-hub Articles family): combined sections+sort
          chip · search · (i) explainer toggle. No "Articles · N entries"
          heading — the outpost tab bar already labels this view. */}
      {(articles.length > 0 || !loading || searchQuery || selectedTag) && (
        <div className="flex items-center gap-2">
          <Popover open={filterMenuOpen} onOpenChange={setFilterMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${ selectedSection || sortMode !== "newest" ? "border-brand/40 bg-brand/5 text-brand" : "border-input bg-background text-foreground hover:bg-muted/30" }`}
                data-testid="button-horizon-filter"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span className="max-w-[110px] truncate">{selectedSection ?? "All"}</span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-1.5 max-h-80 overflow-y-auto">
              <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Sections</p>
              <button
                onClick={() => { setSelectedSection(null); setFilterMenuOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                  selectedSection === null ? "bg-primary/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
                data-testid="horizon-section-all"
              >
                All
                {articles.length > 0 && <span className="text-[10px] opacity-60 ml-auto">{articles.length}</span>}
              </button>
              {sections.map((s) => (
                <button
                  key={s.name}
                  onClick={() => { setSelectedSection(selectedSection === s.name ? null : s.name); setFilterMenuOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                    selectedSection === s.name ? "bg-primary/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                  data-testid={`horizon-section-${s.name}`}
                >
                  <FolderOpen className="w-3 h-3" />
                  <span className="truncate">{s.name}</span>
                  <span className="text-[10px] opacity-60 ml-auto">{s.count}</span>
                </button>
              ))}
              <div className="my-1 border-t border-border/30" />
              <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Sort</p>
              {(["newest", "oldest", "updated"] as HorizonSortMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => { setSortMode(mode); setFilterMenuOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                    sortMode === mode ? "bg-primary/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                  data-testid={`horizon-sort-${mode}`}
                >
                  <Clock className="w-3 h-3" />
                  {mode === "updated" ? "Recently Updated" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <SearchPill
            containerClassName="flex-1 min-w-0"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search articles..."
            trailing={searchQuery ? (
              <button
                onClick={() => setSearchQuery("")}
                className="p-2 rounded-full text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-muted/50 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : undefined}
          />

          <button
            type="button"
            onClick={() => setShowLearnMore(!showLearnMore)}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${
              showLearnMore ? "text-brand bg-brand/10" : "text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-muted/20"
            }`}
            aria-expanded={showLearnMore}
            aria-label="How do Articles work?"
            title="How do Articles work?"
            data-testid="button-horizon-info"
          >
            <Info className="w-4 h-4" />
          </button>
          {loading && <RelayOutpostInlineLoader className="w-3.5 h-3.5 shrink-0" />}
        </div>
      )}

      <div>
        {showLearnMore && (
          <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <BookOpen className="w-3.5 h-3.5 text-brand/70" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-foreground/70">A shared knowledge base</p>
                <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                  Articles are this outpost's long-form content library. Members contribute articles, guides, resources, and links that live permanently on the relay — building a shared knowledge base for the community.
                </p>
              </div>
            </div>
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Layers className="w-3.5 h-3.5 text-brand/70" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-foreground/70">Organized into sections</p>
                <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                  Entries can be categorized into sections like Guides, Updates, Links, and Resources — or create your own. Sections help people find what they're looking for without scrolling through everything.
                </p>
              </div>
            </div>
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Compass className="w-3.5 h-3.5 text-brand/70" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-foreground/70">Full article editor</p>
                <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                  Write rich articles with formatting, images, video embeds, code blocks, and more. Your content is published as a NIP-23 long-form event — portable across any Nostr client.
                </p>
              </div>
            </div>
            <div className="flex gap-2.5">
              <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-3.5 h-3.5 text-yellow-800/70 dark:text-yellow-400/70" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-foreground/70">Different from Posts and Discussions</p>
                <p className="text-[10px] text-muted-foreground/40 leading-relaxed mt-0.5">
                  Posts are quick status updates, Discussions are threaded conversations. Articles are lasting, polished content — think wiki pages, tutorials, or documentation rather than social posts.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tags: ONE horizontally-scrolling line (was a 2-3 line wrapping cloud). */}
      {allTags.length > 0 && (
        <div className="flex gap-1 overflow-x-auto scrollbar-hide flex-nowrap -mx-1 px-1">
          {selectedTag && (
            <button
              onClick={() => setSelectedTag(null)}
              className="flex shrink-0 items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-accent text-accent-foreground dark:text-brand hover:bg-accent/80 transition-colors"
            >
              <X className="w-2.5 h-2.5" />
              Clear
            </button>
          )}
          {allTags.slice(0, 12).map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                selectedTag === tag
                  ? "bg-accent text-accent-foreground dark:text-brand"
                  : "bg-muted/15 text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-muted/25"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {loading && articles.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <HorizonSkeletonCard key={i} />
          ))}
        </div>
      ) : !loading && visibleArticles.length === 0 ? (
        searchQuery || selectedTag || selectedSection ? (
          <Card className="glass-card p-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <Search className="w-8 h-8 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground/50">No matching entries</p>
              <p className="text-[10px] text-muted-foreground/30">
                Try adjusting your search or filters.
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setSearchQuery(""); setSelectedTag(null); setSelectedSection(null); }}
                className="text-[11px] text-brand/60 hover:text-brand mt-1"
              >
                Clear filters
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="glass-card p-8">
            <div className="flex flex-col items-center gap-3 text-center max-w-xs mx-auto">
              <div className="w-14 h-14 rounded-full bg-primary/8 border border-primary/15 flex items-center justify-center">
                <BookOpen className="w-7 h-7 text-brand/40" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-brand tracking-wide text-foreground/80">No articles yet</h3>
                <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
                  This outpost's knowledge base has no entries yet. Share articles, resources, files, and links to build your community's library.
                </p>
              </div>
              {pubkey && canPostHorizon && (
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs gap-1.5 mt-1"
                  onClick={() => setHorizonDialogOpen(true)}
                >
                  <Plus className="w-3 h-3" />
                  Create First Entry
                </Button>
              )}
            </div>
          </Card>
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleArticles.map((article) => (
            <HorizonArticleCard
              key={`${article.event.pubkey}:${article.dTag}`}
              article={article}
              relayUrl={relayUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
}
