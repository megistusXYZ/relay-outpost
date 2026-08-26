// Pure read-state logic for notifications.
//
// The bug this fixes ("notifications are a few days behind"): read-state used to
// be `readIds.has(id) || created_at <= lastSeen`, where `lastSeen` advances to
// wall-clock now merely by OPENING the notifications page. So a mention authored
// 3 days ago but only reaching the client now (relay propagation delay, or the
// client was offline) had `created_at <= lastSeen` → silently pre-read, dated
// days ago, with no badge. It felt days behind.
//
// Fix: id-based. A notification is read iff you've explicitly marked its id read,
// OR it's a HISTORICAL event (one we'd already seen before this delivery) whose
// author-time predates the last open. A FIRST-TIME arrival is never auto-read by
// the timestamp rule — so a late-arriving old mention stays unread and badges.

export interface ReadStateInputs {
  /** Event ids the user has explicitly marked read (cross-device synced). */
  readIds: Set<string>;
  /**
   * Whether this event id was ALREADY in the local seen-set before this
   * delivery — i.e. it's a re-delivery / cache-seed of something we've seen, not
   * a first-time arrival. The timestamp fallback applies only to these, keeping
   * backward-compatible read-state for existing history while never pre-reading a
   * genuinely new arrival.
   */
  alreadySeen: boolean;
  /** Monotonic "last opened the list" wall-clock in seconds; 0 if never. */
  lastSeen: number;
}

export function computeNotificationRead(
  id: string,
  createdAt: number,
  s: ReadStateInputs,
): boolean {
  if (s.readIds.has(id)) return true;
  return s.alreadySeen && s.lastSeen > 0 && createdAt <= s.lastSeen;
}
