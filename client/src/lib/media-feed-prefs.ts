/**
 * Kill switch for the media feed — full-bleed picture posts and everything
 * that lands on top of them.
 *
 * Default ON, fail-open: only a literal "0" turns it off. Same shape as the IA
 * flag and the Concord flag, and for the same reason — an absent or damaged
 * value must never be mistaken for a deliberate opt-out. Someone whose storage
 * was cleared should get the current app, not a silently older one.
 *
 * Default-OFF was considered and rejected: nobody would see it, so nothing
 * would be learned. Shipping with no flag at all was also rejected: this
 * changes the primary surface for every user, and a bad result on real devices
 * has to be undoable without a deploy.
 *
 * See MEDIA_FEED_PLAN.md, decision 13.
 */
const KEY = "ro_media_feed";
const OFF = "0";
const CHANGE_EVENT = "media-feed-changed";

export function isMediaFeedEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== OFF;
  } catch {
    // Private mode / blocked storage must not resurrect the old presentation.
    return true;
  }
}

export function setMediaFeedEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, OFF);
  } catch {}
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {}
}

export const MEDIA_FEED_CHANGE_EVENT = CHANGE_EVENT;
