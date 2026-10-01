/**
 * Paging a relay's catalog backwards in time, a batch at a time.
 *
 * The Marketplace paged 30 × 100 listings on open and stopped: everything
 * older than the first 3,000 was unreachable (measured 2026-10-01: the 30th
 * page was still full, and the relay held at least 6,000). The page keeps its
 * opening batch and now fetches older ones as the reader reaches the end.
 *
 * Pure of relays: `fetchPage` asks for one page at or before `until` and says
 * whether the relay really answered.
 */
export interface PagerCursor {
  /** Ask for events at or before this time. */
  until: number;
  /** Ids already taken, across calls. */
  seen: Set<string>;
  /** The relay answered with nothing new: the catalog has no more. */
  dry: boolean;
}

export function newCursor(nowSeconds: number = Math.floor(Date.now() / 1000) + 60): PagerCursor {
  return { until: nowSeconds, seen: new Set(), dry: false };
}

export async function pageOlder<E extends { id: string; created_at: number }>(
  fetchPage: (until: number) => Promise<{ events: readonly E[]; answered: boolean }>,
  cursor: PagerCursor,
  maxPages: number,
  opts: { onPage?: (fresh: E[]) => void; shouldStop?: () => boolean } = {},
): Promise<{ fresh: E[]; answeredAny: boolean; stalled: boolean }> {
  const all: E[] = [];
  let answeredAny = false;
  let stalled = false;
  for (let page = 0; page < maxPages && !cursor.dry; page++) {
    if (opts.shouldStop?.()) break;
    const res = await fetchPage(cursor.until);
    if (opts.shouldStop?.()) break;
    const fresh = res.events.filter((e) => !cursor.seen.has(e.id));
    answeredAny = answeredAny || res.answered || fresh.length > 0;
    if (fresh.length === 0) {
      // An ANSWER with nothing new is the end. Silence is not: the page that
      // timed out may be full, so the catalog is not declared finished.
      if (res.answered) cursor.dry = true; else stalled = true;
      break;
    }
    for (const e of fresh) cursor.seen.add(e.id);
    cursor.until = Math.min(...fresh.map((e) => e.created_at)) - 1;
    all.push(...fresh);
    opts.onPage?.(fresh);
  }
  return { fresh: all, answeredAny, stalled };
}

/** Listings from a later batch that are not already on the shelf (by address). */
export function olderNotShown<L extends { pubkey: string; dTag: string }>(incoming: readonly L[], shown: ReadonlyArray<readonly L[]>): L[] {
  const have = new Set<string>();
  for (const chunk of shown) for (const l of chunk) have.add(`${l.pubkey}:${l.dTag}`);
  return incoming.filter((l) => !have.has(`${l.pubkey}:${l.dTag}`));
}
