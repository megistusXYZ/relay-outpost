// The News "latest edition" — a small on-device snapshot of the last merged
// News screen (News-perf Phase 3). It's written to localStorage as the feed
// settles and read back SYNCHRONOUSLY on mount, so the News page paints its
// remembered edition instantly (0ms perceived) instead of waiting on the
// network; live feed data then merges in and takes over.
//
// The pack/unpack/merge helpers are pure (unit-tested); load/save are thin
// localStorage wrappers that never throw (storage may be full or disabled).

import type { MergedItem, MergeableItem } from "./rss-merge";

export const NEWS_EDITION_KEY = "ro_news_edition_v1";
/** Cap the snapshot so localStorage stays small (a few hundred KB at most). */
export const NEWS_EDITION_CAP = 120;

interface StoredEdition {
  v: 1;
  ts: number;
  items: MergedItem[];
}

const isRenderable = (m: unknown): m is MergedItem => {
  const x = m as MergedItem | undefined;
  return !!x && !!x.item && !!x.source && typeof x.source.url === "string" && x.source.url.length > 0;
};

/** Stable identity for a merged item — matches the reader's read-state key
 *  (guid || id || link), with a source+title fallback. */
export function editionItemKey(m: MergedItem): string {
  const it = m.item as { guid?: string; id?: string; link?: string; title?: string };
  return String(it?.guid || it?.id || it?.link || `${m.source?.url}:${it?.title ?? ""}`);
}

// Fields that render a CARD (title, link, date, thumb, audio, …) are kept; the
// heavy full-article body is dropped — it can be 50k chars/item (≈6 MB across
// 120 items, way over the localStorage budget) and is only needed in the reader,
// which re-fetches. The live feed restores the full item as soon as it loads.
const HEAVY_ITEM_FIELDS = ["fullContent", "content", "content:encoded"] as const;

function slimItem<T extends MergeableItem>(m: MergedItem<T>): MergedItem<T> {
  const it: Record<string, unknown> = { ...(m.item as Record<string, unknown>) };
  for (const k of HEAVY_ITEM_FIELDS) delete it[k];
  if (typeof it.description === "string" && it.description.length > 400) {
    it.description = it.description.slice(0, 400);
  }
  return { item: it as unknown as T, source: m.source };
}

/** Serialize the current merged items into a compact stored edition: capped in
 *  count and slimmed of the heavy article body so the snapshot stays small
 *  (well under the localStorage budget). Returns null when there's nothing worth
 *  storing. `now` is injected to keep this pure/testable. */
export function packEdition(items: MergedItem[], now: number, cap = NEWS_EDITION_CAP): string | null {
  const slim = (items ?? []).filter(isRenderable).slice(0, cap).map(slimItem);
  if (slim.length === 0) return null;
  const payload: StoredEdition = { v: 1, ts: now, items: slim };
  return JSON.stringify(payload);
}

/** Parse a stored edition back into merged items, or [] if missing / malformed /
 *  wrong version. Never throws. Age is NOT gated — the remembered edition is
 *  always flashed (the live refresh replaces stale items within a second). */
export function unpackEdition(raw: string | null | undefined): MergedItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredEdition;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter(isRenderable);
  } catch {
    return [];
  }
}

/** Overlay the remembered edition UNDER the live items: live wins (it's fresher),
 *  and any remembered item the live set doesn't yet have is appended so the list
 *  never shrinks or flashes empty while feeds stream in. Once live is a superset,
 *  this converges to pure live. */
export function mergeEditions<T extends MergeableItem>(
  live: MergedItem<T>[],
  remembered: MergedItem<T>[],
): MergedItem<T>[] {
  if (!remembered || remembered.length === 0) return live;
  if (!live || live.length === 0) return remembered;
  const seen = new Set(live.map(editionItemKey));
  const extra = remembered.filter((m) => !seen.has(editionItemKey(m)));
  return extra.length ? [...live, ...extra] : live;
}

/** Read the remembered edition (synchronous — available at first render). */
export function loadEdition(): MergedItem[] {
  try {
    return unpackEdition(localStorage.getItem(NEWS_EDITION_KEY));
  } catch {
    return [];
  }
}

/** Persist the current merged items as the remembered edition. No-ops on
 *  quota/disabled storage. */
export function saveEdition(items: MergedItem[]): void {
  try {
    const raw = packEdition(items, Date.now());
    if (raw) localStorage.setItem(NEWS_EDITION_KEY, raw);
  } catch {
    /* storage full or unavailable — the edition is a nicety, not required */
  }
}
