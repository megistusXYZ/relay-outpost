import { useEffect, useRef, useState, useCallback } from "react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  disabled?: boolean;
  scrollContainerSelector?: string;
}

const THRESHOLD = 64;
const MAX_PULL = 100;
const RESISTANCE = 0.4;

export function PullToRefresh({ onRefresh, children, disabled, scrollContainerSelector = "main" }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pullDistanceRef = useRef(0);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  onRefreshRef.current = onRefresh;

  const getScrollContainer = useCallback((): HTMLElement | null => {
    return document.querySelector(scrollContainerSelector);
  }, [scrollContainerSelector]);

  useEffect(() => {
    if (disabled) return;

    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current) return;
      const scrollEl = getScrollContainer();
      const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
      if (scrollTop <= 2) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling.current || isRefreshingRef.current) return;
      const scrollEl = getScrollContainer();
      const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
      if (scrollTop > 2) {
        isPulling.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const diff = currentY - touchStartY.current;
      if (diff > 0) {
        if (diff > 10) {
          e.preventDefault();
        }
        const dampened = Math.min(diff * RESISTANCE, MAX_PULL);
        pullDistanceRef.current = dampened;
        setPullDistance(dampened);
      } else {
        isPulling.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    const handleTouchEnd = async () => {
      if (!isPulling.current || isRefreshingRef.current) return;
      isPulling.current = false;

      if (pullDistanceRef.current >= THRESHOLD) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        const settledDistance = THRESHOLD * 0.6;
        pullDistanceRef.current = settledDistance;
        setPullDistance(settledDistance);
        try {
          await onRefreshRef.current();
        } catch (err) {
          console.warn("[PullToRefresh] refresh error:", err);
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          pullDistanceRef.current = 0;
          setPullDistance(0);
        }
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [disabled, getScrollContainer]);

  const isActive = pullDistance > 0 || isRefreshing;
  const pastThreshold = pullDistance >= THRESHOLD;

  return (
    <div ref={containerRef} data-testid="pull-to-refresh-container">
      <div
        className="flex items-center justify-center overflow-hidden transition-[height,opacity] duration-300 ease-out"
        style={{
          height: isActive ? `${pullDistance}px` : "0px",
          opacity: isActive ? 1 : 0,
        }}
        data-testid="pull-to-refresh-indicator"
      >
        <div
          className="flex items-center gap-2 transition-transform duration-200"
          style={{
            transform: `scale(${Math.min(pullDistance / THRESHOLD, 1)})`,
          }}
        >
          {isRefreshing ? (
            <>
              <RelayOutpostInlineLoader className="w-4 h-4 text-brand" />
              <span className="text-[11px] text-brand/70 font-mono tracking-wider uppercase">
                Refreshing signal...
              </span>
            </>
          ) : (
            <>
              <div
                className="transition-transform duration-200"
                style={{
                  transform: pastThreshold ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`w-4 h-4 transition-colors duration-200 ${pastThreshold ? "text-brand" : "text-muted-foreground/50"}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <span className={`text-[11px] font-mono tracking-wider uppercase transition-colors duration-200 ${pastThreshold ? "text-brand/70" : "text-muted-foreground/50"}`}>
                {pastThreshold ? "Release to refresh" : "Pull for new signal"}
              </span>
            </>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
