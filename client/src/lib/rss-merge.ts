// Pure, testable logic for the merged "thread of releases" News view.
//
// The News page fetches every saved feed in parallel and merges the results into
// one stream. These helpers own the merge/sort/hero/count logic so the component
// stays a thin renderer over them (and so the behaviour is unit-tested).
//
// Everything here is source-agnostic: it operates on a minimal item shape plus a
// per-feed source descriptor, and takes an `isRead` predicate from the caller so
// read-state (which lives in localStorage/React state) stays out of pure logic.

/** The minimal item shape these helpers need. RSSItem (in RSSFeed.tsx) satisfies it. */
export interface MergeableItem {
  link?: string;
  guid?: string;
  id?: string;
  pubDate?: string;
  thumbnail?: string;
}

/** Where a merged item came from — used to label each card in the thread. */
export interface MergeSource {
  url: string;
  name?: string;
  feedImage?: string;
  siteUrl?: string;
}

/** One feed's fetched items plus its source descriptor. */
export interface PerFeedItems<T extends MergeableItem = MergeableItem> {
  source: MergeSource;
  items: T[];
}

/** An item flattened out of the per-feed sets, carrying its origin. */
export interface MergedItem<T extends MergeableItem = MergeableItem> {
  item: T;
  source: MergeSource;
}

export type SortMode = "unread-first" | "latest";

/**
 * Source-dominance cap for the diversity pass. Without it the diversifier only
 * guarantees no BACK-TO-BACK same-source cards (max linear run of 1) — which
 * still lets a firehose outlet (e.g. ZeroHedge) fill every other slot and
 * dominate the "Top" mixed stream. The cap adds a SLIDING-WINDOW quota on top:
 * within any `window` consecutive output cards a single source appears at most
 * `maxPerWindow` times, so no one outlet can crowd out the rest.
 *
 * It is a PARAMETER, not a hardcode: the "Top" mixed feed passes a cap; the
 * per-topic tabs pass none (that tab is intentionally one topic's full firehose,
 * so it keeps only the basic linear diversity). When the tail of the list is all
 * one source the quota is unsatisfiable and that source necessarily runs on —
 * there is nothing left to interleave with.
 */
export interface DiversifyOptions {
  /** Window length (in output cards) the quota is measured over. */
  window: number;
  /** Max times one source may appear within any `window`-length window. */
  maxPerWindow: number;
}

/** Stable per-item identity: guid → id → link (mirrors rssItemId in RSSFeed.tsx). */
export function mergeItemId(item: MergeableItem): string {
  return (item.guid || item.id || item.link || "").trim();
}

/** Parse a pubDate to a comparable epoch ms; unparseable/missing dates sort oldest. */
function itemTime(item: MergeableItem): number {
  if (!item.pubDate) return 0;
  const t = new Date(item.pubDate).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Flatten every feed's items into one list, attaching each item's source, and
 * dedup so the same article syndicated to multiple feeds appears once.
 *
 * Dedup key is the item link (the same URL is the same story). When an item has
 * no link we fall back to its guid/id; an item with no identity at all is always
 * kept (we can't prove it's a duplicate). First occurrence wins, so earlier feeds
 * in the input order take precedence.
 */
export function mergeFeedItems<T extends MergeableItem>(
  perFeed: PerFeedItems<T>[],
): MergedItem<T>[] {
  const out: MergedItem<T>[] = [];
  const seen = new Set<string>();
  for (const feed of perFeed) {
    for (const item of feed.items ?? []) {
      const key = (item.link || "").trim() || mergeItemId(item);
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push({ item, source: feed.source });
    }
  }
  return out;
}

/**
 * Order the merged stream.
 * - "latest": pure reverse-chronological across all sources.
 * - "unread-first": unread items first (newest → oldest), then read items
 *   (newest → oldest) — the default, so new releases lead the thread.
 */
export function sortMergedItems<T extends MergeableItem>(
  items: MergedItem<T>[],
  mode: SortMode,
  isRead: (item: T) => boolean,
): MergedItem<T>[] {
  const byNewest = (a: MergedItem<T>, b: MergedItem<T>) => itemTime(b.item) - itemTime(a.item);
  if (mode === "latest") {
    return [...items].sort(byNewest);
  }
  const unread: MergedItem<T>[] = [];
  const read: MergedItem<T>[] = [];
  for (const m of items) {
    (isRead(m.item) ? read : unread).push(m);
  }
  unread.sort(byNewest);
  read.sort(byNewest);
  return [...unread, ...read];
}

/**
 * Pick the "Top story" hero for the merged thread:
 *   newest UNREAD item with an image → newest unread → newest item overall.
 * Returns null only when there are no items at all.
 */
export function pickHero<T extends MergeableItem>(
  items: MergedItem<T>[],
  isRead: (item: T) => boolean,
): MergedItem<T> | null {
  if (items.length === 0) return null;
  const byNewest = (a: MergedItem<T>, b: MergedItem<T>) => itemTime(b.item) - itemTime(a.item);
  const unread = items.filter((m) => !isRead(m.item)).sort(byNewest);
  if (unread.length > 0) {
    return unread.find((m) => !!m.item.thumbnail) ?? unread[0];
  }
  return [...items].sort(byNewest)[0] ?? null;
}

/**
 * Source-diversity pass for the merged thread: caps same-source runs at ONE —
 * no two consecutive items from the same outlet whenever any other outlet still
 * has items available. Greedy swap-forward (same pattern as VideoFeed's
 * interleaveByKind): walking the sorted list, when the next item would repeat
 * the previous item's source, the NEAREST later item from a different source is
 * pulled forward; relative order is otherwise preserved. When only one source
 * remains (e.g. the tail of the list), its items run consecutively — there is
 * nothing to interleave with.
 *
 * Apply this AFTER sorting and AFTER story-cluster collapsing (a collapsed
 * cluster is one item carrying its lead's source), and only to the below-hero
 * list (the hero is pulled out before this runs).
 *
 * In "unread-first" mode the unread and read segments are diversified
 * independently, so no read item ever climbs above the "Caught up" divider and
 * unread counting is untouched. Pure and idempotent: re-running it on its own
 * output changes nothing, so memoized re-renders never reshuffle.
 *
 * Pass `cap` to additionally bound each source's local share (see
 * DiversifyOptions) — used for the "Top" mixed stream so a firehose outlet
 * can't dominate. Omit it for a single topic's firehose tab (basic linear
 * diversity only).
 */
/**
 * Keep at most `maxPerSource` items per source, first-seen wins, order preserved.
 * Used to show ONE card per show/outlet in the diversified All view — a prolific
 * podcast (e.g. 3 fresh episodes) or wire feed shouldn't repeat down the feed.
 * Because the input is already in display (best-first) order, the survivor is
 * that source's top item.
 */
export function capPerSource<T extends MergeableItem>(
  items: MergedItem<T>[],
  keyFn: (m: MergedItem<T>) => string,
  maxPerSource: number,
): MergedItem<T>[] {
  if (maxPerSource < 1) return items;
  const counts = new Map<string, number>();
  const out: MergedItem<T>[] = [];
  for (const m of items) {
    const k = keyFn(m);
    const n = counts.get(k) ?? 0;
    if (n >= maxPerSource) continue;
    counts.set(k, n + 1);
    out.push(m);
  }
  return out;
}

export function interleaveMergedSources<T extends MergeableItem>(
  items: MergedItem<T>[],
  mode: SortMode,
  isRead: (item: T) => boolean,
  cap?: DiversifyOptions,
): MergedItem<T>[] {
  if (mode === "latest") return interleaveRun(items, cap);
  // unread-first: the list is [unread…, read…]; diversify each segment alone.
  const unread: MergedItem<T>[] = [];
  const read: MergedItem<T>[] = [];
  for (const m of items) (isRead(m.item) ? read : unread).push(m);
  return [...interleaveRun(unread, cap), ...interleaveRun(read, cap)];
}

/**
 * One order-preserving diversity pass over a single segment. Without `cap` this
 * is the original greedy max-run-of-1 (no two same-source cards adjacent). With
 * `cap` it also enforces the sliding-window quota — see interleaveRunCapped.
 */
function interleaveRun<T extends MergeableItem>(
  items: MergedItem<T>[],
  cap?: DiversifyOptions,
): MergedItem<T>[] {
  if (items.length < 2) return items;
  const distinct = new Set(items.map((m) => m.source.url));
  if (distinct.size <= 1) return items;
  if (cap && cap.window >= 2 && cap.maxPerWindow >= 1) return interleaveRunCapped(items, cap);

  const queue = [...items];
  const result: MergedItem<T>[] = [];
  let lastSource: string | null = null;
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (lastSource !== null && cur.source.url === lastSource) {
      // Pull the nearest later item from any other source in front of this run.
      const altIdx = queue.findIndex((m, j) => j > i && m.source.url !== lastSource);
      if (altIdx !== -1) {
        const [alt] = queue.splice(altIdx, 1);
        queue.splice(i, 0, alt);
        result.push(alt);
        lastSource = alt.source.url;
        continue;
      }
    }
    result.push(cur);
    lastSource = cur.source.url;
  }
  return result;
}

/**
 * Greedy source-balanced pass with a sliding-window quota. At each output slot
 * it picks the EARLIEST-order remaining item whose source (a) isn't the immediate
 * predecessor and (b) hasn't already hit `maxPerWindow` within the last
 * `window - 1` outputs. It relaxes those constraints only when nothing else
 * qualifies (a dominant tail), so it never stalls. Because it always takes a
 * source's earliest remaining item, per-source relative order is preserved; and
 * because it re-derives the window each step it is idempotent on its own output.
 */
function interleaveRunCapped<T extends MergeableItem>(
  items: MergedItem<T>[],
  cap: DiversifyOptions,
): MergedItem<T>[] {
  const { window, maxPerWindow } = cap;
  const queue = [...items];
  const result: MergedItem<T>[] = [];
  while (queue.length > 0) {
    // Count each source in the last (window - 1) outputs: placing a source that
    // already appears maxPerWindow times there would breach a window of `window`.
    const back = result.slice(Math.max(0, result.length - (window - 1)));
    const counts = new Map<string, number>();
    for (const m of back) counts.set(m.source.url, (counts.get(m.source.url) ?? 0) + 1);
    const lastSource = result.length > 0 ? result[result.length - 1].source.url : null;
    const withinQuota = (url: string) => (counts.get(url) ?? 0) < maxPerWindow;

    // Prefer: not the immediate predecessor AND under quota.
    let idx = queue.findIndex((m) => m.source.url !== lastSource && withinQuota(m.source.url));
    // Relax adjacency but keep the quota (e.g. two firehoses left).
    if (idx === -1) idx = queue.findIndex((m) => withinQuota(m.source.url));
    // Everything left is quota-blocked (one source dominates the tail): take the
    // earliest so relative order holds and we make progress.
    if (idx === -1) idx = 0;

    const [picked] = queue.splice(idx, 1);
    result.push(picked);
  }
  return result;
}

/** Count unread items across the merged set (drives "All feeds · N unread"). */
export function countUnread<T extends MergeableItem>(
  items: MergedItem<T>[],
  isRead: (item: T) => boolean,
): number {
  let n = 0;
  for (const m of items) if (!isRead(m.item)) n++;
  return n;
}
