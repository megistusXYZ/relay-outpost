/**
 * Video seen-ledger — which video events this device has already shown.
 *
 * Exists for "an endless feed of videos they've never seen" (owner request,
 * 2026-08-26): the Videos feed partitions unseen content ahead of seen
 * content. The ledger is per-device (like feed style), capped, and read as a
 * SNAPSHOT once per feed build — marks made while the reader scrolls must
 * never reorder the grid under them; they take effect on the next visit.
 */

const SEEN_KEY = "ro_video_seen_v1";
const SEEN_CAP = 3000;

export function readSeenVideos(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function markVideosSeen(ids: readonly string[]): void {
  if (ids.length === 0) return;
  try {
    const merged = [...readSeenVideos()];
    const have = new Set(merged);
    for (const id of ids) {
      if (have.has(id)) continue;
      have.add(id);
      merged.push(id);
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(merged.slice(-SEEN_CAP)));
  } catch {
    // A ledger that can't persist only costs freshness, never content.
  }
}

/**
 * Stable partition: never-seen entries first, each group in its incoming
 * order. Applied AFTER the feed's own sort, so "unseen first" refines the
 * chosen ranking instead of replacing it.
 */
export function orderUnseenFirst<T extends { event: { id: string } }>(
  entries: readonly T[],
  seen: ReadonlySet<string>,
): T[] {
  if (seen.size === 0) return [...entries];
  const unseen: T[] = [];
  const already: T[] = [];
  for (const e of entries) (seen.has(e.event.id) ? already : unseen).push(e);
  return [...unseen, ...already];
}
