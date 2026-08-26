/**
 * Per-conversation DM read markers — the last-read message timestamp for each peer.
 * Shared by the Messages page (the "Unread" divider + scroll-to-unread) and by
 * NotificationContext (the total unread-DM count behind the Messages nav badge).
 *
 * `writeDmLastRead` fires a `dm-read-updated` window event so the unread count can
 * recompute the moment a thread is read (or a send marks your own thread read).
 */
export const DM_READ_PREFIX = "ro_dm_read_";
export const DM_READ_EVENT = "dm-read-updated";
/**
 * Fired on a genuine LOCAL read-marker change so the cross-device read-state
 * sync (read-state-sync.ts) can schedule a debounced publish. Deliberately
 * separate from DM_READ_EVENT (which drives the in-app unread count): remote
 * hydration writes markers directly and must NOT re-trigger a publish.
 */
export const READSTATE_CHANGED_EVENT = "readstate-changed";
/**
 * Fired by read-state-sync.ts AFTER remote read-state has been hydrated into
 * localStorage (markers raised). UI that mirrors a marker in React state
 * (e.g. the notification badge's lastSeen) listens for this and re-reads
 * storage. Hydration also fires DM_READ_EVENT so unread-DM counts recompute;
 * it deliberately does NOT fire READSTATE_CHANGED_EVENT (no publish echo).
 */
export const READSTATE_HYDRATED_EVENT = "readstate-hydrated";

export function readDmLastRead(pk: string): number {
  try {
    return parseInt(localStorage.getItem(DM_READ_PREFIX + pk) || "0", 10) || 0;
  } catch {
    return 0;
  }
}

export function writeDmLastRead(pk: string, ts: number): void {
  try {
    if (ts > readDmLastRead(pk)) {
      localStorage.setItem(DM_READ_PREFIX + pk, String(ts));
      window.dispatchEvent(new CustomEvent(DM_READ_EVENT));
      window.dispatchEvent(new CustomEvent(READSTATE_CHANGED_EVENT));
    }
  } catch {
    /* ignore quota / private-mode */
  }
}
