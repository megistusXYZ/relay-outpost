import { useEffect, useRef, useState } from "react";
import type { Event } from "nostr-tools";
import { RefreshCw, Vote } from "lucide-react";
import { fetchPollsFeed, filterPollsByShow, sortPolls, type PollShowMode, type PollSortMode } from "@/lib/polls";
import { PollPost } from "@/components/PollPost";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Button } from "@/components/ui/button";
import { FeedSkeletonList } from "./home/feed-controls";
import { useTierContentFilter } from "@/hooks/use-tier-content-filter";

// Macro "Polls" feed (kind 1068, NIP-88). We fetch once WITH closed polls
// (includeClosed) so the sheet's Sort (Trending / Latest / Ending soon) and
// Show (Open / All) picks re-slice the cached set instantly — no refetch. We
// render incrementally so even a large result stays light on mobile, and cache
// the result for the session so flipping between the Images/Videos/Polls macro
// feeds doesn't refetch every time.

const PAGE = 12;
const CACHE_TTL_MS = 120_000;
let pollsCache: { at: number; polls: Event[]; responseCounts: Map<string, number> } | null = null;

export default function PollsFeed({
  embedded: _embedded, sort = "trending", show = "open",
}: {
  embedded?: boolean;
  /** SavedOptionsSheet's "Sort" pick — same value vocabulary as Home's pollSort. */
  sort?: PollSortMode;
  /** SavedOptionsSheet's "Show" pick — "open" hides ended polls. */
  show?: PollShowMode;
}) {
  const fresh = pollsCache && Date.now() - pollsCache.at < CACHE_TTL_MS;
  const [polls, setPolls] = useState<Event[]>(() => (fresh ? pollsCache!.polls : []));
  const [responseCounts, setResponseCounts] = useState<Map<string, number>>(
    () => (fresh ? pollsCache!.responseCounts : new Map()),
  );
  const [loading, setLoading] = useState(!fresh);
  const [refreshing, setRefreshing] = useState(false);
  const [count, setCount] = useState(PAGE);
  const mounted = useRef(true);

  const load = async () => {
    try {
      const res = await fetchPollsFeed({ includeClosed: true });
      if (!mounted.current) return;
      pollsCache = { at: Date.now(), polls: res.polls, responseCounts: res.responseCounts };
      setPolls(res.polls);
      setResponseCounts(res.responseCounts);
    } catch {
      /* leave whatever we have */
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  };

  useEffect(() => {
    mounted.current = true;
    if (!pollsCache || Date.now() - pollsCache.at >= CACHE_TTL_MS) {
      setLoading(true);
      void load();
    }
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new Sort/Show pick re-orders the whole list — restart paging from the top.
  useEffect(() => { setCount(PAGE); }, [sort, show]);

  const refresh = () => { setRefreshing(true); setCount(PAGE); void load(); };

  // Honor the shared WoT excluded-tier set (same filter the main feed and
  // outposts use), then apply the sheet's Show + Sort picks. Pure re-slices of
  // the cached fetch — sheet changes take effect immediately, no relay work.
  const tierFilter = useTierContentFilter();
  const nowSec = Math.floor(Date.now() / 1000);
  const filteredPolls = sortPolls(filterPollsByShow(tierFilter(polls), show, nowSec), sort, responseCounts, nowSec);

  if (loading && polls.length === 0) {
    return <FeedSkeletonList count={4} />;
  }

  if (!loading && filteredPolls.length === 0) {
    return (
      <div className="glass-card rounded-lg flex flex-col items-center justify-center py-12 sm:py-16 text-center px-4" data-testid="container-empty-polls">
        <Vote className="w-8 h-8 text-brand/60 mb-3" />
        <p className="text-sm font-medium mb-1">{show === "all" ? "No polls right now" : "No open polls right now"}</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Polls people start across the network show up here. Check back soon — or start one from the compose box.
        </p>
        <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={refresh} disabled={refreshing} data-testid="button-refresh-polls-empty">
          {refreshing ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      </div>
    );
  }

  const visible = filteredPolls.slice(0, count);
  return (
    <div className="space-y-3" data-testid="container-polls-feed">
      <div className="-mb-1 flex items-center justify-end">
        <button
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-50"
          data-testid="button-refresh-polls"
        >
          {refreshing ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>
      {visible.map((p) => <PollPost key={p.id} event={p} />)}
      <InfiniteScrollSentinel
        onLoadMore={() => setCount((c) => Math.min(c + PAGE, filteredPolls.length))}
        isLoading={false}
        hasMore={count < filteredPolls.length}
      />
    </div>
  );
}
