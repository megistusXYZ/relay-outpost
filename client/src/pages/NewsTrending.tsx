/**
 * The trending-news front page (NEWS_TRENDING_PLAN.md, phase 2).
 *
 * Fetches ONE ranked payload from /api/news/trending (the corroboration spine,
 * phase 1) and renders it: a topic lens, a hero, a ranked river. The order is
 * the server's trending rank; read stories DIM IN PLACE and never reorder
 * (decision 5). Each story shows its corroboration signal — "N outlets" — the
 * transparent "why it's ranked here" (decision 9). The Nostr-network lift and
 * the podcast rail land in later phases.
 *
 * Flag-gated (ro_news_trending, default off): mounted by RSSFeed only when the
 * flag is on, so the proven reader keeps serving until this is verified.
 */
import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Newspaper, Users, ExternalLink, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { loadRssReadLedger } from "@/lib/orbit-stories";
import { FOCUS_RING } from "@/lib/a11y";
import {
  annotateReadState,
  markStoryRead,
  type TrendingResponse,
  type AnnotatedStory,
} from "@/lib/news-trending";
import { useNewsNetworkShares } from "@/hooks/use-news-network-shares";
import { PodcastTrendingRail } from "@/components/news/PodcastTrendingRail";
import { applyNetworkBoost, type NetworkSignal } from "@/lib/news-network-boost";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { GuestWall } from "@/components/GuestWall";

const TOPICS = ["Top", "News", "Business", "Tech", "Sports", "Health", "Science"] as const;
type Topic = (typeof TOPICS)[number];

function proxied(url: string): string {
  return `/api/rss/image-proxy?url=${encodeURIComponent(url)}`;
}

/** "3 outlets" / "just BBC" — the corroboration signal, transparent by design. */
function CorroborationBadge({ count, className = "" }: { count: number; className?: string }) {
  if (count < 2) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium text-brand/80 ${className}`} data-testid="corroboration-badge">
      <Users className="w-3 h-3" />
      {count} outlets
    </span>
  );
}

/** "3 you follow shared" — the differentiator no aggregator can show. */
function NetworkBadge({ network, className = "" }: { network: NetworkSignal | null; className?: string }) {
  if (!network || network.count < 1) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium text-primary ${className}`} data-testid="network-badge">
      <Sparkles className="w-3 h-3" />
      {network.count} you follow shared
    </span>
  );
}

function timeAgo(pubDate: string) {
  const d = new Date(pubDate);
  return isNaN(d.getTime()) ? null : formatDistanceToNow(d, { addSuffix: true });
}

export function NewsTrending({ embedded = false }: { embedded?: boolean }) {
  useDocumentTitle("News");
  const [topic, setTopic] = useState<Topic>("Top");

  const query = useQuery<TrendingResponse>({
    queryKey: ["/api/news/trending", topic],
    queryFn: async () => {
      const res = await fetch(`/api/news/trending?topic=${encodeURIComponent(topic)}`);
      if (!res.ok) throw new Error(`trending ${res.status}`);
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  // Read ledger, re-read when the query data changes (opening a story rewrites
  // it, and react-query's dataUpdatedAt flips when we refetch).
  const readSet = useMemo(() => loadRssReadLedger(), [query.dataUpdatedAt, topic]);
  // The Nostr-network lift (decision 8): fetch what the viewer's follows are
  // sharing and re-rank the base list against it. Additive — a signed-out
  // viewer or an empty network gets the pure corroboration order.
  const shareMap = useNewsNetworkShares(true);
  const stories: Array<AnnotatedStory & { network: NetworkSignal | null }> = useMemo(() => {
    const read = annotateReadState(query.data?.stories ?? [], readSet);
    return applyNetworkBoost(read, shareMap);
  }, [query.data, readSet, shareMap]);

  // Local dim state for stories opened THIS session, so a tap dims instantly
  // without a refetch (the ledger write is durable; this is the optimistic UI).
  const [openedLinks, setOpenedLinks] = useState<Set<string>>(new Set());
  const openStory = useCallback((s: AnnotatedStory) => {
    markStoryRead([s.link, ...s.memberLinks]);
    setOpenedLinks((prev) => new Set(prev).add(s.link));
    try { window.open(s.link, "_blank", "noopener,noreferrer"); } catch { /* popup blocked */ }
  }, []);
  const isDim = (s: AnnotatedStory) => s.read || openedLinks.has(s.link);

  const { pubkey } = useNostrAuth();
  const hero = stories[0];
  const rest = stories.slice(1);

  // Hard wall (owner decision, 2026-08-14): the news river is a browse
  // surface, so guests meet the wall outright — the earlier hero-plus-taste
  // is gone. News stories are external links, so nothing shared breaks.
  if (!pubkey) {
    return (
      <div className={embedded ? "" : "max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6"} data-testid="page-news-trending">
        <div className="max-w-2xl mx-auto pt-8">
          <GuestWall context="The news river is for members" />
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "" : "max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6"} data-testid="page-news-trending">
      {!embedded && (
        <div className="flex items-center gap-2 mb-4">
          {/* No "← Discover" back (owner call, 2026-08-14): the bottom bar's
              Discover tab already returns to the bento in one tap. */}
          <h1 className="text-lg font-semibold" data-testid="text-news-trending-title">Trending news</h1>
        </div>
      )}

      {/* Topic lens — the "from the jump" selection (decision 3). */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-3" role="tablist" aria-label="News topics" data-testid="news-topic-lens">
        {TOPICS.map((t) => {
          const active = topic === t;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTopic(t)}
              className={`shrink-0 rounded-full border px-3 min-h-[36px] text-xs font-medium transition-colors ${
                active
                  ? "border-primary/40 bg-primary/15 text-foreground"
                  : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
              data-testid={`news-topic-${t}`}
            >
              {t}
            </button>
          );
        })}
      </div>

      {query.isPending && (
        <div className="space-y-3" aria-hidden="true">
          <div className="glass-card rounded-2xl overflow-hidden animate-pulse">
            <div className="aspect-[16/9] bg-muted/40" />
            <div className="p-4 space-y-2"><div className="h-4 w-3/4 rounded bg-muted/50" /><div className="h-3 w-1/3 rounded bg-muted/40" /></div>
          </div>
          {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />)}
        </div>
      )}

      {query.isError && (
        <Card className="glass-card p-4 flex items-center justify-between gap-3" data-testid="news-trending-error">
          <span className="text-sm text-muted-foreground">Couldn't load trending news right now.</span>
          <button type="button" onClick={() => query.refetch()} className="text-xs font-medium text-brand hover:underline" data-testid="button-news-trending-retry">
            Try again
          </button>
        </Card>
      )}

      {query.data && stories.length === 0 && (
        <Card className="glass-card p-6 text-center text-sm text-muted-foreground" data-testid="news-trending-empty">
          Nothing trending in {topic} right now.
        </Card>
      )}

      {hero && (
        <button
          type="button"
          onClick={() => openStory(hero)}
          className={`group block w-full text-left glass-card rounded-2xl overflow-hidden mb-4 transition-opacity ${isDim(hero) ? "opacity-60" : ""} ${FOCUS_RING}`}
          data-testid="news-hero"
        >
          {hero.thumbnail && (
            <div className="aspect-[16/9] overflow-hidden bg-muted/30">
              <img src={proxied(hero.thumbnail)} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
            </div>
          )}
          <div className="p-4">
            <span className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 text-brand text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5"><Newspaper className="w-3 h-3" />Top story</span>
              <CorroborationBadge count={hero.outletCount} />
              <NetworkBadge network={hero.network} />
            </span>
            <span className="block text-lg sm:text-xl font-semibold leading-snug line-clamp-3" data-testid="news-hero-title">{hero.title}</span>
            <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{hero.sources.slice(0, 3).join(" · ")}{hero.sources.length > 3 ? ` +${hero.sources.length - 3}` : ""}</span>
              {timeAgo(hero.pubDate) && <span>· {timeAgo(hero.pubDate)}</span>}
              <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
            </span>
          </div>
        </button>
      )}

      <PodcastTrendingRail />

      <div className="space-y-1">
        {rest.map((s) => (
          <button
            key={s.link}
            type="button"
            onClick={() => openStory(s)}
            className={`group flex items-start gap-3 w-full text-left rounded-xl p-2.5 hover:bg-muted/30 transition-colors ${isDim(s) ? "opacity-55" : ""} ${FOCUS_RING}`}
            data-testid={`news-story-${s.link.slice(0, 24)}`}
          >
            {s.thumbnail && (
              <span className="w-20 h-14 shrink-0 rounded-lg overflow-hidden bg-muted/30">
                <img src={proxied(s.thumbnail)} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug line-clamp-2">{s.title}</span>
              <span className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
                <span>{s.source}</span>
                {timeAgo(s.pubDate) && <span>· {timeAgo(s.pubDate)}</span>}
                <CorroborationBadge count={s.outletCount} className="ml-0.5" />
                <NetworkBadge network={s.network} className="ml-0.5" />
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default NewsTrending;
