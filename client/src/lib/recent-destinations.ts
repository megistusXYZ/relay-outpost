/**
 * Tiny per-pubkey MRU of recently opened destinations, feeding the Stories
 * menu's "Jump back in" module. LOCAL history only — written by 2-line hooks
 * at the destinations themselves (DM thread open in Messages.tsx, community
 * open in ConcordOutpost.tsx), read synchronously when the menu opens. No
 * relay work anywhere.
 *
 * The list logic (`pushRecent`) is pure and unit-tested; the localStorage
 * wrappers are guarded for tests/SSR/quota.
 */

export type RecentDestinationType = "community" | "dm";

export interface RecentDestination {
  type: RecentDestinationType;
  /** Stable identity for dedupe (community id, peer pubkey…). */
  id: string;
  /** Where tapping the row navigates. */
  path: string;
  /** Human label captured at visit time (falls back to id-ish in the UI). */
  label?: string;
  /** Avatar/image URL if the write site had one handy. */
  avatar?: string;
  ts: number;
}

export const RECENT_DESTINATIONS_CAP = 5;

const keyFor = (pubkey: string | null | undefined) =>
  `ro_recent_dest:${pubkey ?? "anon"}`;

/** Pure MRU push: newest first, deduped by type+id, capped. */
export function pushRecent(
  list: RecentDestination[],
  entry: RecentDestination,
  cap: number = RECENT_DESTINATIONS_CAP,
): RecentDestination[] {
  const rest = list.filter((d) => !(d.type === entry.type && d.id === entry.id));
  return [entry, ...rest].slice(0, cap);
}

export function getRecentDestinations(
  pubkey: string | null | undefined,
): RecentDestination[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(keyFor(pubkey));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is RecentDestination =>
        !!d && typeof d.id === "string" && typeof d.path === "string" &&
        (d.type === "community" || d.type === "dm"),
    );
  } catch {
    return [];
  }
}

export function recordRecentDestination(
  pubkey: string | null | undefined,
  entry: Omit<RecentDestination, "ts">,
): void {
  try {
    if (typeof localStorage === "undefined") return;
    const next = pushRecent(getRecentDestinations(pubkey), { ...entry, ts: Date.now() });
    localStorage.setItem(keyFor(pubkey), JSON.stringify(next));
  } catch {}
}

// ---- Dismissed suggestions --------------------------------------------------
//
// The Stories menu lets users clear a "Jump back in" / "Up next" row with a
// small ✕. Dismissals are per-account, persisted, and filtered out at the
// CANDIDATE-selection layer (before capping/priority-picking), so the
// next-best suggestion backfills naturally on later menu opens. A dismissal
// expires after ~14 days so a destination that becomes active again can
// resurface.

export interface DismissedSuggestion {
  /**
   * Stable row id. Jump-back-in rows use `destinationSuggestionId` (e.g.
   * "dm:<pubkey>", "community:<id>"); Up-next rows use "upnext:<kind>:<id>".
   */
  id: string;
  dismissedAt: number;
}

/** A dismissal expires after ~2 weeks so a truly-active row can come back. */
export const SUGGESTION_DISMISSAL_TTL_MS = 14 * 24 * 3_600_000;

const dismissedKeyFor = (pubkey: string | null | undefined) =>
  `ro_menu_dismissed_suggestions_${pubkey ?? "anon"}`;

/** Stable dismissal id for a Jump-back-in destination row. */
export function destinationSuggestionId(
  d: Pick<RecentDestination, "type" | "id">,
): string {
  return `${d.type}:${d.id}`;
}

/** Pure: drop expired dismissals. */
export function pruneDismissals(
  list: DismissedSuggestion[],
  now: number,
  ttlMs: number = SUGGESTION_DISMISSAL_TTL_MS,
): DismissedSuggestion[] {
  return list.filter((d) => now - d.dismissedAt < ttlMs);
}

/** Pure: record a dismissal (deduped, refreshing dismissedAt), pruning expired ones. */
export function addDismissal(
  list: DismissedSuggestion[],
  id: string,
  now: number,
  ttlMs: number = SUGGESTION_DISMISSAL_TTL_MS,
): DismissedSuggestion[] {
  const kept = pruneDismissals(list, now, ttlMs).filter((d) => d.id !== id);
  return [...kept, { id, dismissedAt: now }];
}

/** Pure: drop candidate rows whose stable id is actively dismissed. */
export function filterDismissed<T>(
  rows: readonly T[],
  dismissedIds: ReadonlySet<string>,
  idOf: (row: T) => string,
): T[] {
  if (dismissedIds.size === 0) return rows.slice();
  return rows.filter((r) => !dismissedIds.has(idOf(r)));
}

function loadDismissals(pubkey: string | null | undefined): DismissedSuggestion[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(dismissedKeyFor(pubkey));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is DismissedSuggestion =>
        !!d && typeof d.id === "string" && typeof d.dismissedAt === "number",
    );
  } catch {
    return [];
  }
}

/** Active (unexpired) dismissed row ids for this account. */
export function getDismissedSuggestionIds(
  pubkey: string | null | undefined,
  now: number = Date.now(),
): Set<string> {
  return new Set(pruneDismissals(loadDismissals(pubkey), now).map((d) => d.id));
}

/** Persist a dismissal (pruning expired entries while writing anyway). */
export function dismissSuggestion(
  pubkey: string | null | undefined,
  id: string,
  now: number = Date.now(),
): void {
  try {
    if (typeof localStorage === "undefined") return;
    const next = addDismissal(loadDismissals(pubkey), id, now);
    localStorage.setItem(dismissedKeyFor(pubkey), JSON.stringify(next));
  } catch {}
}
