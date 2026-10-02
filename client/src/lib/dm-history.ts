/**
 * Paging back through private messages, one relay at a time.
 *
 * A gift wrap names only its recipient, so every chat's history is ONE
 * stream: kind 1059 addressed to the reader, on the reader's own inbox relays.
 * Until 2026-10-02 the app asked once for the newest 200 (or for what arrived
 * since the last visit) and never looked further back: a conversation older
 * than the newest 200 wraps was simply not there, with no way to reach it.
 *
 * Each relay is paged separately, because each holds a different slice and
 * gives out after a different number. Three things a page can say, kept apart
 * (see RELAY_REACHABILITY.md):
 *
 *   - it brought messages          → carry on from the oldest of them;
 *   - it answered with nothing     → that relay's beginning has been reached;
 *   - the relay didn't answer      → NOTHING is concluded; ask again later.
 *
 * The design follows Amethyst's pager, by way of Brainstorm's notes on it.
 * Pure: the caller supplies how a page is fetched.
 */

/** How many wraps one page asks a relay for. Relays may give fewer. */
export const HISTORY_PAGE_SIZE = 200;
/** NIP-59 back-dates a wrap by up to two days from when its message was written. */
export const WRAP_BACKDATE_SEC = 2 * 24 * 60 * 60;

export interface RelayCursor {
  /** Ask for wraps at or before this time (inclusive). Null: from the newest. */
  until: number | null;
  /** The relay answered a page with nothing older: its beginning is reached. */
  done: boolean;
}
export type HistoryCursors = Record<string, RelayCursor>;

export const freshCursor = (): RelayCursor => ({ until: null, done: false });

export function historyFilter(me: string, cursor: RelayCursor, limit = HISTORY_PAGE_SIZE): Record<string, unknown> {
  return { kinds: [1059], "#p": [me], limit, ...(cursor.until !== null ? { until: cursor.until } : {}) };
}

/**
 * Where a relay's cursor stands after one page.
 *
 * `until` is INCLUSIVE — several wraps share a second, and an exclusive bound
 * would skip the ones the previous page's limit cut off. So a page always
 * repeats the wraps at the boundary second, and "nothing older" is judged on
 * what lies strictly BELOW it, not on the page being empty.
 */
export function afterPage(
  cursor: RelayCursor,
  page: readonly { created_at: number }[],
  answered: boolean,
  limit = HISTORY_PAGE_SIZE,
): RelayCursor {
  // No answer is not an empty answer: the cursor stays exactly where it was.
  if (!answered) return cursor;
  if (cursor.done) return cursor;
  if (page.length === 0) return { until: cursor.until, done: true };
  const below = cursor.until === null ? page : page.filter((e) => e.created_at < cursor.until!);
  if (below.length === 0) {
    // Everything was the boundary second again. A FULL page of it means more
    // may hide behind the limit at that same second: step past it. Otherwise
    // this relay has nothing older.
    if (page.length >= limit) return { until: cursor.until! - 1, done: false };
    return { until: cursor.until, done: true };
  }
  return { until: Math.min(...below.map((e) => e.created_at)), done: false };
}

/** Every relay has reached its beginning. (No relays at all is not "everything".) */
export function historyComplete(relays: readonly string[], cursors: HistoryCursors): boolean {
  return relays.length > 0 && relays.every((r) => cursors[r]?.done);
}

/**
 * The time back to which messages are known to be all here, or null when that
 * can't be said yet.
 *
 * A relay that has delivered wraps back to T is only complete for messages
 * written after T + two days (the back-dating). The claim holds for the whole
 * mailbox only as far as the LEAST advanced relay still paging — and a relay
 * that hasn't answered a single page says nothing, so the claim isn't made.
 */
export function completeBackTo(relays: readonly string[], cursors: HistoryCursors): number | null {
  let worst: number | null = null;
  for (const r of relays) {
    const c = cursors[r];
    if (c?.done) continue;
    if (!c || c.until === null) return null;
    const t = c.until + WRAP_BACKDATE_SEC;
    worst = worst === null ? t : Math.max(worst, t);
  }
  return worst;
}

export type FetchPage = (relay: string, filter: Record<string, unknown>) => Promise<{ events: { id: string; created_at: number }[]; answered: boolean }>;

export interface OlderResult<E> {
  cursors: HistoryCursors;
  /** Wraps not seen before, each once, newest first. */
  wraps: E[];
  /** Relays that didn't answer this time. */
  unreached: string[];
  complete: boolean;
}

/**
 * Look further back: one page from every relay that still has more, repeated
 * (a few times at most) until something new turns up or every relay is done.
 * The first page of a relay overlaps what the app already has, so a single
 * page would often bring nothing and look like "no older messages".
 */
export async function loadOlder<E extends { id: string; created_at: number }>(
  relays: readonly string[],
  me: string,
  cursors: HistoryCursors,
  fetchPage: (relay: string, filter: Record<string, unknown>) => Promise<{ events: E[]; answered: boolean }>,
  isKnown: (id: string) => boolean,
  opts: { maxRounds?: number; limit?: number } = {},
): Promise<OlderResult<E>> {
  const limit = opts.limit ?? HISTORY_PAGE_SIZE;
  const maxRounds = opts.maxRounds ?? 6;
  const next: HistoryCursors = { ...cursors };
  const found = new Map<string, E>();
  let unreached: string[] = [];
  for (let round = 0; round < maxRounds; round++) {
    const asking = relays.filter((r) => !(next[r]?.done));
    if (asking.length === 0) break;
    unreached = [];
    const pages = await Promise.all(asking.map(async (relay) => {
      const cursor = next[relay] ?? freshCursor();
      try {
        const page = await fetchPage(relay, historyFilter(me, cursor, limit));
        return { relay, cursor, ...page };
      } catch {
        return { relay, cursor, events: [] as E[], answered: false };
      }
    }));
    for (const p of pages) {
      next[p.relay] = afterPage(p.cursor, p.events, p.answered, limit);
      if (!p.answered) unreached.push(p.relay);
      // Whatever arrived is kept, answered or not: a relay that sent three
      // wraps and then went quiet still sent three wraps.
      for (const e of p.events) if (!isKnown(e.id) && !found.has(e.id)) found.set(e.id, e);
    }
    if (found.size > 0) break;
    // Nobody answered at all: another round would only ask the same silence.
    if (unreached.length === asking.length) break;
  }
  return {
    cursors: next,
    wraps: [...found.values()].sort((a, b) => b.created_at - a.created_at),
    unreached,
    complete: historyComplete(relays, next),
  };
}

/* ---- remembering where each relay got to, per account, on this device ---- */

const KEY = (pubkey: string) => `ro_dm_history_v1_${pubkey}`;

export function readCursors(pubkey: string): HistoryCursors {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(pubkey)) || "{}");
    const out: HistoryCursors = {};
    for (const [relay, c] of Object.entries(raw as Record<string, any>)) {
      if (!c || typeof c !== "object") continue;
      const until = typeof c.until === "number" && c.until > 0 ? c.until : null;
      out[relay] = { until, done: c.done === true };
    }
    return out;
  } catch {
    return {};
  }
}

export function writeCursors(pubkey: string, cursors: HistoryCursors): void {
  try { localStorage.setItem(KEY(pubkey), JSON.stringify(cursors)); } catch { /* storage full or blocked */ }
}

/** Forget where paging got to (sign-out, or "look again from the start"). */
export function clearCursors(pubkey: string): void {
  try { localStorage.removeItem(KEY(pubkey)); } catch { /* nothing to clear */ }
}
