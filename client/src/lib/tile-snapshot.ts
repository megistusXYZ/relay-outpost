/**
 * Last-known answers for Discover's tiles, kept on this device so the next
 * visit paints at once and refreshes in place (stale-while-revalidate).
 *
 * Per account: the key carries the viewer (or "guest"), so one account's feed
 * never shows under another. Bounded in age, so a device opened after a long
 * gap doesn't show yesterday's front page as if it were today's. Storage can
 * be missing or full (private windows, quota); every access is best-effort
 * and a failure just means no instant paint.
 */

export interface SnapshotStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Older than this and a snapshot is ignored: the page waits for fresh data. */
export const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Skip oversized answers rather than crowd out the rest of localStorage. */
const MAX_BYTES = 64 * 1024;

const PREFIX = "ro_tile_snap";

function storageKey(viewer: string | null, key: string): string {
  return `${PREFIX}:${viewer ?? "guest"}:${key}`;
}

export function saveSnapshot(store: SnapshotStore, viewer: string | null, key: string, value: unknown, now: number): void {
  try {
    const raw = JSON.stringify({ at: now, value });
    if (raw.length > MAX_BYTES) return;
    store.setItem(storageKey(viewer, key), raw);
  } catch { /* storage unavailable or full: no snapshot this time */ }
}

export function readSnapshot<T = unknown>(store: SnapshotStore, viewer: string | null, key: string, now: number): T | null {
  try {
    const raw = store.getItem(storageKey(viewer, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; value?: T };
    if (typeof parsed.at !== "number" || now - parsed.at > SNAPSHOT_MAX_AGE_MS) return null;
    return (parsed.value ?? null) as T | null;
  } catch {
    return null;
  }
}
