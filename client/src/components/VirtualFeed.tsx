import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { setFeedScrollBridge } from "@/lib/feed-scroll-bridge";
import { getPendingRestoreAnchor, scrollRestoreDebugEnabled } from "@/lib/scroll-restore";
import { computeIndexAnchor, resolveRestoreTarget, type RowRect } from "@/lib/feed-anchor";

interface VirtualFeedProps<T> {
  items: T[];
  /** Stable key per item (Nostr event id) — keeps measurement/positioning correct across prepends. */
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Initial per-row height guess before real measurement (px). */
  estimateSize?: number;
  overscan?: number;
  /** Fired when the rendered range nears the end of the list — drives infinite load. */
  onReachEnd?: () => void;
  /** How many items from the end trigger onReachEnd. */
  reachEndThreshold?: number;
  /** Vertical gap between rows (px) — replaces the flow `space-y-*` that absolute rows lose. */
  gap?: number;
  className?: string;
}

/**
 * Window/element virtualized post list. Renders only the rows near the viewport
 * into the DOM (constant DOM cost regardless of feed length) while measuring
 * each row's real height so variable-height posts (media, threads) position
 * correctly. The scroll parent is the app's `.feed-scroll-container` (the
 * `<main overflow-y-auto>`), discovered from the mounted node so no ref needs
 * to be threaded down from the layout.
 *
 * Rows keep rendering the existing post components unchanged, so `data-event-id`
 * (used by scroll restoration) and all interaction behaviour are preserved.
 *
 * Back-navigation (the real-device fix): on a scroll-restored return this
 * restores by ROW INDEX, not by a raw pixel offset. A saved pixel offset maps to
 * the WRONG row because the virtualizer's pixel→index cache is seeded from a flat
 * height estimate (real rows vary 120–600px), so the anchor row isn't mounted on
 * return and the DOM restorer chases a moving estimate — the "sloppy load / shake".
 * Instead we resolve the saved anchor to its index in the (pinned, stable) items
 * list and call `virtualizer.scrollToIndex(index, { align: "start" })`, which
 * forces that exact row to mount and measure regardless of estimates; the
 * intra-row offset is then applied, and the app-level growth-aware restorer
 * fine-tunes to the now-present DOM anchor for the exact final pixel. See
 * lib/feed-anchor.ts for the pure index math.
 */
export function VirtualFeed<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 320,
  overscan = 6,
  onReachEnd,
  reachEndThreshold = 8,
  gap = 12,
  className,
}: VirtualFeedProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  // Refs so the bridge closures always see the latest list without re-registering
  // on every items change.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;

  // Captured once, synchronously, on first render — before the app-level
  // restorer has consumed the pending flag (child layout effects run first). The
  // pinned items snapshot (Home.tsx) keeps `items` identity stable across the
  // thread round-trip, so an index resolved here stays meaningful.
  const restoreTargetRef = useRef<{ index: number; intraOffset: number } | null | undefined>(undefined);
  if (restoreTargetRef.current === undefined) {
    const saved = getPendingRestoreAnchor();
    restoreTargetRef.current = saved
      ? resolveRestoreTarget(
          { anchorId: saved.anchorId, anchorIndex: saved.anchorIndex ?? null, intraOffset: saved.intraOffset ?? 0 },
          items,
          // getKey takes (item, index); the resolver only needs id-by-item and
          // callers derive the id from the item alone (event.id), so index is nominal.
          (it) => getKey(it, 0),
        )
      : null;
    if (scrollRestoreDebugEnabled()) {
      try { console.debug(`[scroll-restore] VirtualFeed mount indexTarget=${JSON.stringify(restoreTargetRef.current)} saved=${JSON.stringify(saved)}`); } catch {}
    }
  }

  // First-paint seed: place the container near the target row's ESTIMATED offset
  // so the initial rendered range already brackets the anchor (no top-of-feed
  // flash). `scrollToIndex` below then refines to the true measured offset.
  const rowStride = estimateSize + gap;
  const initialOffset = restoreTargetRef.current
    ? Math.max(0, restoreTargetRef.current.index * rowStride + restoreTargetRef.current.intraOffset)
    : 0;

  // The virtualizer needs the scroll element; find the app's main scroll
  // container once the row container is in the DOM. When restoring, seed the
  // container near the estimated target BEFORE the virtualizer attaches so the
  // first paint already renders the anchor region.
  // Offset of the feed's row container within the scroll container's CONTENT
  // (the controls/tabs above the feed, ~140px on Home). Without this the
  // virtualizer's row coordinates and the container's scrollTop disagree by
  // exactly that constant: every scrollToIndex-based back-restore overshot by
  // it (and the error COMPOUNDED across repeated round-trips) while the
  // app-level anchor correction fought scrollToIndex's self-reconciliation.
  // react-virtual's own `scrollMargin` option is the designed fix — row
  // `start`s then include the margin, so capture math, scrollToIndex and the
  // DOM all agree.
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = parentRef.current?.closest<HTMLElement>(".feed-scroll-container") ?? null;
    if (el && parentRef.current) {
      const m = parentRef.current.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      setScrollMargin(Math.max(0, Math.round(m)));
    }
    if (el && initialOffset > 0) el.scrollTop = initialOffset;
    setScrollEl(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimateSize + gap,
    overscan,
    getItemKey: (index) => getKey(items[index], index),
    initialOffset,
    scrollMargin,
  });

  // INDEX-BASED restore: once the scroll element is attached, force the saved
  // anchor row to mount and measure via `scrollToIndex` (which self-reconciles
  // until measurements settle), then apply the intra-row offset. This replaces
  // the old estimate-derived pixel seed + 12-frame virtual-jump ping: those
  // resolved the wrong row under flat height estimates so the anchor never
  // mounted. The app-level growth-aware restorer takes the now-present DOM anchor
  // the rest of the way to the exact pixel.
  const didIndexRestoreRef = useRef(false);
  useLayoutEffect(() => {
    if (didIndexRestoreRef.current || !scrollEl) return;
    const target = restoreTargetRef.current;
    if (!target) return;
    didIndexRestoreRef.current = true;

    const apply = () => {
      // align:"start" writes scrollTop to the row's top; += lands within the row.
      virtualizer.scrollToIndex(target.index, { align: "start" });
      if (target.intraOffset) scrollEl.scrollTop += target.intraOffset;
    };
    apply();
    // Re-assert ONCE after the target row has mounted/measured: the first call
    // used estimates for the offset, the second lands on the true measured start.
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollEl]);

  // Bridge for the app-level restorer:
  //  • scrollToEventId — reach a virtualized-out row by id (scrollToIndex mounts it).
  //  • captureAnchor  — save-time index anchor from the virtualizer's own rows.
  useEffect(() => {
    setFeedScrollBridge({
      scrollToEventId: (eventId) => {
        const arr = itemsRef.current;
        const gk = getKeyRef.current;
        const idx = arr.findIndex((it, i) => gk(it, i) === eventId);
        if (idx < 0) return false;
        virtualizer.scrollToIndex(idx, { align: "start" });
        return true;
      },
      captureAnchor: () => {
        const el = parentRef.current?.closest<HTMLElement>(".feed-scroll-container");
        if (!el) return null;
        const vItems = virtualizer.getVirtualItems();
        if (!vItems.length) return null;
        const rows: RowRect[] = vItems.map((v) => ({ index: v.index, start: v.start, size: v.size }));
        const scrollOffset = virtualizer.scrollOffset ?? el.scrollTop ?? 0;
        // Viewport height → anchor on the first FULLY-VISIBLE row (what the
        // user is reading), so above-the-fold re-measures can't shift it.
        const a = computeIndexAnchor(rows, scrollOffset, el.clientHeight);
        if (!a) return null;
        const arr = itemsRef.current;
        const gk = getKeyRef.current;
        const item = arr[a.index];
        return { anchorId: item ? gk(item, a.index) : null, anchorIndex: a.index, intraOffset: a.intraOffset };
      },
    });
    return () => setFeedScrollBridge(null);
  }, [virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.length ? virtualItems[virtualItems.length - 1].index : -1;

  // Range-based infinite load: trigger when the last rendered row is within
  // `reachEndThreshold` of the end. Replaces the IntersectionObserver sentinel.
  useEffect(() => {
    if (lastIndex < 0 || !onReachEnd) return;
    if (lastIndex >= items.length - reachEndThreshold) onReachEnd();
  }, [lastIndex, items.length, reachEndThreshold, onReachEnd]);

  return (
    <div
      ref={parentRef}
      // `virtual-feed` (index.css): inside virtualized rows the virtualizer is
      // the single source of laziness — the class neutralizes the posts'
      // `content-visibility: auto` placeholder sizing (which fed phantom 220px
      // heights into measureElement mid-scroll) and opts the rows out of native
      // scroll anchoring (which double-corrects against our own scroll
      // adjustments when a row above the viewport re-measures).
      className={className ? `virtual-feed ${className}` : "virtual-feed"}
      style={{ position: "relative", width: "100%", height: `${virtualizer.getTotalSize()}px` }}
      data-testid="container-feed"
    >
      {virtualItems.map((vi) => (
        <div
          key={vi.key}
          data-index={vi.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            // `start` includes scrollMargin (container coords) — subtract it to
            // position within the feed's own row container.
            transform: `translateY(${vi.start - virtualizer.options.scrollMargin}px)`,
            paddingBottom: `${gap}px`,
          }}
        >
          {renderItem(items[vi.index], vi.index)}
        </div>
      ))}
    </div>
  );
}
