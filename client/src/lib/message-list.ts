/**
 * Incremental, time-ordered, de-duplicated message list.
 *
 * Chat and DM threads used to rebuild their whole array on every incoming
 * event: `[...prev, msg].sort(byTime)` with a linear `find` for dedupe —
 * O(n log n) time + O(n) dedupe per message, so a busy channel re-sorts
 * thousands of items on each event. This keeps the array sorted incrementally:
 * a realtime message (newest) is an O(1) tail append; an out-of-order or
 * history message binary-inserts at its position; dedupe is an O(1) Set lookup.
 *
 * Pure — no React, no store. The output array is byte-for-byte the same set and
 * order the old stable-sort produced (equal-time items keep insertion order),
 * so it's a drop-in behavioural replacement.
 */
export interface MessageList<T> {
  readonly items: readonly T[];
  readonly ids: ReadonlySet<string>;
}

export function emptyMessageList<T>(): MessageList<T> {
  return { items: [], ids: new Set<string>() };
}

/** First index where getTime(items[i]) > t (upper bound) — where a new item of
 *  time t is inserted so it lands AFTER existing equal-time items. */
function upperBound<T>(items: readonly T[], t: number, getTime: (x: T) => number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (getTime(items[mid]) > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Insert an item into an already-time-sorted array, returning a NEW array. The
 * newest-message case (item at/after the tail) is an O(1) append; otherwise it
 * binary-inserts at the item's upper bound. The result equals what a stable
 * `[...arr, item].sort(byTime)` produces — a drop-in for that pattern that skips
 * the full re-sort. Does NOT dedupe; guard the id at the call site as before.
 */
export function insertSorted<T>(arr: readonly T[], item: T, getTime: (x: T) => number): T[] {
  const t = getTime(item);
  if (arr.length === 0 || t >= getTime(arr[arr.length - 1])) return arr.concat(item);
  const idx = upperBound(arr, t, getTime);
  return arr.slice(0, idx).concat(item, arr.slice(idx));
}

/**
 * Merge a just-loaded cached history into messages that arrived LIVE while the
 * cache read was in flight. The live copy wins on id conflicts (it is at least
 * as fresh — edits/deletes may already be applied), and live items keep their
 * time-sorted position among the cached ones. Replacing state with the cached
 * array (the old pattern) dropped those live messages — and since their wraps
 * were already marked in the processed ledger, they never re-arrived until a
 * remount re-read the cache.
 */
export function mergeCachedHistory<T>(
  cached: readonly T[],
  live: readonly T[],
  getId: (x: T) => string,
  getTime: (x: T) => number,
): T[] {
  if (live.length === 0) return [...cached];
  const liveIds = new Set(live.map(getId));
  let out: T[] = cached.filter((c) => !liveIds.has(getId(c)));
  for (const m of live) out = insertSorted(out, m, getTime);
  return out;
}

/**
 * Add one message. Returns the SAME state reference if the id is already known
 * (so React can skip re-render), otherwise a new state with the item inserted in
 * time order. Newest-message case is an O(1) tail append.
 */
export function addMessage<T>(
  state: MessageList<T>,
  item: T,
  getId: (x: T) => string,
  getTime: (x: T) => number,
): MessageList<T> {
  const id = getId(item);
  if (state.ids.has(id)) return state;
  const ids = new Set(state.ids);
  ids.add(id);
  return { items: insertSorted(state.items, item, getTime), ids };
}

/**
 * Add a batch of messages (initial load / history page). Filters out already
 * known ids, then merges and sorts once. Returns the SAME state if nothing is
 * new.
 */
export function addMessages<T>(
  state: MessageList<T>,
  incoming: readonly T[],
  getId: (x: T) => string,
  getTime: (x: T) => number,
): MessageList<T> {
  const ids = new Set(state.ids);
  const fresh: T[] = [];
  for (const it of incoming) {
    const id = getId(it);
    if (ids.has(id)) continue;
    ids.add(id);
    fresh.push(it);
  }
  if (fresh.length === 0) return state;
  const merged = state.items.concat(fresh);
  merged.sort((a, b) => getTime(a) - getTime(b));
  return { items: merged, ids };
}
