import { useEffect, useRef, useCallback } from "react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { shouldRetriggerLoad } from "@/lib/scroll-refill";

interface InfiniteScrollSentinelProps {
  onLoadMore: () => void;
  isLoading: boolean;
  hasMore: boolean;
}

/**
 * IntersectionObserver reports TRANSITIONS — and a filtered feed can complete
 * a load without moving the sentinel (trust filter hides 29 of a 30-post
 * page), so no transition ever comes and the scroll dies. The rule that
 * unsticks it lives in lib/scroll-refill.ts: when a load COMPLETES while the
 * sentinel is still on screen and there is more, fire again. Filtering may
 * starve a page; it must never starve the scroll.
 */
export function InfiniteScrollSentinel({ onLoadMore, isLoading, hasMore }: InfiniteScrollSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  const isLoadingRef = useRef(isLoading);
  const hasMoreRef = useRef(hasMore);
  const intersectingRef = useRef(false);
  const prevLoadingRef = useRef(isLoading);
  loadMoreRef.current = onLoadMore;
  isLoadingRef.current = isLoading;
  hasMoreRef.current = hasMore;

  const handleIntersect = useCallback((entries: IntersectionObserverEntry[]) => {
    intersectingRef.current = !!entries[0]?.isIntersecting;
    if (entries[0]?.isIntersecting && !isLoadingRef.current && hasMoreRef.current) {
      loadMoreRef.current();
    }
  }, []);

  // The refill edge: a load finished (true → false) with the sentinel still in
  // view. Deferred a tick so the render that delivered the new (possibly
  // entirely filtered-out) rows commits first.
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoading;
    if (!shouldRetriggerLoad({ wasLoading, isLoading, intersecting: intersectingRef.current, hasMore })) return;
    const timer = setTimeout(() => {
      if (intersectingRef.current && !isLoadingRef.current && hasMoreRef.current) {
        loadMoreRef.current();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isLoading, hasMore]);

  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return;

    const observer = new IntersectionObserver(handleIntersect, { rootMargin: "4000px" });
    observer.observe(sentinelRef.current);
    return () => { observer.disconnect(); intersectingRef.current = false; };
  }, [hasMore, handleIntersect]);

  if (!hasMore && !isLoading) {
    return (
      <div className="flex justify-center py-6" data-testid="text-end-of-feed">
        <p className="text-xs text-muted-foreground/70">
          You've reached the end
        </p>
      </div>
    );
  }

  return (
    <div ref={sentinelRef} className="flex justify-center py-4 min-h-[1px]" data-testid="sentinel-load-more">
      {isLoading && <RelayOutpostInlineLoader className="w-5 h-5 text-muted-foreground/60" />}
    </div>
  );
}
