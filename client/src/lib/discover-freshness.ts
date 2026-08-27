/**
 * The Discover bento's "since you left" store — the honest rubber band.
 *
 * The page greets a returning viewer with energy proportional to what ACTUALLY
 * happened while they were away: each tile counts items whose ids the viewer
 * has not seen. Three rules keep the excitement honest (owner decision,
 * 2026-08-15 — real deltas, theatrically presented; never fabricated):
 *
 *  1. ID-GATED, not wall-clock-gated. notification-read.ts documents the
 *     shipped bug: a `created_at <= lastSeen` rule silently pre-reads
 *     late-arriving items because lastSeen advances just by opening a page.
 *     Here newness is "id not in the seen ledger", with the shared 72h
 *     freshness window (news-unread.ts) capping how old "new" can be.
 *  2. NO BASELINE, NO CLAIM. A first visit counts nothing — the store must
 *     have seen a previous visit before it may say "+N new".
 *  3. STAMP ON LEAVE, never on mount (read-state-sync precedent) — opening
 *     the page must not clear the chips before the viewer has looked.
 *
 * Storage: ro_discover_seen_v1, Record<TileId, TileSeen>, seenIds capped per
 * tile, monotonic `at` (room-read's guard). Local-only v1; the NIP-78 dmRead
 * slot shape is the future sync path.
 */
import { useSyncExternalStore } from "react";
import { isFreshForUnread } from "@/lib/news-unread";
import type { RankedTopic } from "@/lib/discover-tiles";

const KEY = "ro_discover_seen_v1";
export const DISCOVER_FRESHNESS_CHANGED = "discover-freshness-changed";
export const SEEN_IDS_CAP = 60;

export type TileId =
  | "feed" | "communities" | "articles" | "live"
  | "podcasts" | "events" | "videos" | "topics" | "images" | "market";

export interface TileSeen {
  at: number;
  seenIds: string[];
  /** Only on the "topics" record: the previous ranked list, for ↑ marks. */
  topics?: RankedTopic[];
}

export interface FreshItem {
  id: string;
  /** When the item happened. Absent → the id gate alone decides. */
  timeMs?: number;
}

export function loadSeen(): Partial<Record<TileId, TileSeen>> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSeen(all: Partial<Record<TileId, TileSeen>>): void {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  emit();
}

/** Newest-first, deduped, capped. */
export function mergeSeenIds(fresh: readonly string[], existing: readonly string[]): string[] {
  const out: string[] = [];
  const have = new Set<string>();
  for (const id of [...fresh, ...existing]) {
    if (have.has(id)) continue;
    have.add(id);
    out.push(id);
    if (out.length >= SEEN_IDS_CAP) break;
  }
  return out;
}

/**
 * Items the viewer has not seen, capped to the shared 72h freshness window.
 * `undefined` seen (no baseline) claims nothing.
 */
export function freshCount(
  items: readonly FreshItem[],
  seen: TileSeen | undefined,
  now: number,
): number {
  if (!seen) return 0;
  const ledger = new Set(seen.seenIds);
  let n = 0;
  for (const it of items) {
    if (!it.id || ledger.has(it.id)) continue;
    if (it.timeMs !== undefined && !isFreshForUnread(it.timeMs, now)) continue;
    n++;
  }
  return n;
}

/**
 * Record what the viewer has now seen. `at` is monotonic; ids always merge —
 * seen is seen, whatever clock delivered it.
 */
export function stampTiles(
  entries: readonly { tile: TileId; ids: readonly string[]; topics?: RankedTopic[] }[],
  now: number = Date.now(),
): void {
  if (entries.length === 0) return;
  const all = loadSeen();
  for (const e of entries) {
    const prev = all[e.tile];
    all[e.tile] = {
      at: Math.max(now, prev?.at ?? 0),
      seenIds: mergeSeenIds(e.ids, prev?.seenIds ?? []),
      ...(e.topics ? { topics: e.topics } : prev?.topics ? { topics: prev.topics } : {}),
    };
  }
  saveSeen(all);
}

// ── Reactivity (discover-prefs plumbing) ─────────────────────────────────────

let version = 0;
const listeners = new Set<() => void>();
function emit() {
  version++;
  for (const l of listeners) l();
  try { window.dispatchEvent(new CustomEvent(DISCOVER_FRESHNESS_CHANGED)); } catch {}
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Re-renders consumers when any tile is stamped. */
export function useFreshnessVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}
