/**
 * Tiny per-viewer MRU of recently visited profiles, feeding the Stories
 * menu's "Recent people" row (shown when the search pill is focused with an
 * empty query). LOCAL history only — written by a 2-line hook on the Profile
 * page mount, read synchronously when the menu opens. No relay work; the
 * menu resolves names/avatars from the kind-0 cache it already uses.
 *
 * The list logic (`pushRecentProfile`) is pure and unit-tested; the
 * localStorage wrappers are guarded for tests/SSR/quota.
 */

export interface RecentProfileVisit {
  /** Hex pubkey of the VIEWED profile (never the viewer's own). */
  pubkey: string;
  at: number;
}

export const RECENT_PROFILES_CAP = 8;

const keyFor = (viewer: string | null | undefined) =>
  `ro_recent_profiles_${viewer ?? "anon"}`;

/** Pure MRU push: newest first, deduped by pubkey, capped. */
export function pushRecentProfile(
  list: RecentProfileVisit[],
  entry: RecentProfileVisit,
  cap: number = RECENT_PROFILES_CAP,
): RecentProfileVisit[] {
  const rest = list.filter((p) => p.pubkey !== entry.pubkey);
  return [entry, ...rest].slice(0, cap);
}

export function getRecentProfiles(
  viewer: string | null | undefined,
): RecentProfileVisit[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(keyFor(viewer));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is RecentProfileVisit =>
        !!p && typeof p.pubkey === "string" && p.pubkey.length > 0 &&
        typeof p.at === "number",
    );
  } catch {
    return [];
  }
}

/** Record a profile visit. Viewing your OWN profile is never recorded. */
/** Wipe the viewer's whole recent-profiles ring (the "Clear" affordance). */
export function clearRecentProfiles(viewer: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(keyFor(viewer));
  } catch {}
}

export function recordProfileVisit(
  viewer: string | null | undefined,
  viewedPubkey: string,
): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (!viewedPubkey || viewedPubkey === viewer) return;
    const next = pushRecentProfile(getRecentProfiles(viewer), {
      pubkey: viewedPubkey,
      at: Date.now(),
    });
    localStorage.setItem(keyFor(viewer), JSON.stringify(next));
  } catch {}
}
