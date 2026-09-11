/**
 * Per-channel unread dots for the Concord channel sidebar/sheet.
 *
 * Read ledger: ConcordChat already persists a per-channel last-read mark —
 * ro_concord_read_<community>_<channel> (ms, effectively monotonic: it always
 * writes the newest visible message time on open/scroll-bottom). This module
 * adds the channel-side compare against the newest KNOWN activity per channel:
 * the IDB cache of already-decrypted messages plus the metadata-only wrap
 * clock the group-level unread watcher maintains. Zero new relay or decrypt
 * work — everything here is pure compare logic over data we already have.
 */
import { READSTATE_CHANGED_EVENT } from "@/lib/dm-read";

/** Monotonic merge: newest of several activity clocks (undefined/0 ignored). */
export function newestActivity(...times: Array<number | undefined>): number {
  let max = 0;
  for (const t of times) {
    if (t && t > max) max = t;
  }
  return max;
}

/**
 * Is a channel unread? `latest` is the newest known activity (ms; undefined
 * when we know nothing about the channel — never fetched, empty cache), and
 * `lastRead` the persisted read mark (0 = never read).
 *
 * - unknown channel (no known activity) → NOT unread (no dot on silence)
 * - never read + any known activity → unread (new-to-you content)
 * - otherwise: unread iff something is newer than the mark
 */
export function isChannelUnread(latest: number | undefined, lastRead: number): boolean {
  return (latest ?? 0) > lastRead;
}

/**
 * The set of channel ids that should show an unread dot. The active channel is
 * excluded — it's being read right now (its mark persists on open/scroll).
 */
export function computeUnreadChannels(
  channelIds: string[],
  latestById: ReadonlyMap<string, number>,
  lastReadById: (channelId: string) => number,
  activeChannelId?: string,
): Set<string> {
  const out = new Set<string>();
  for (const id of channelIds) {
    if (id === activeChannelId) continue;
    if (isChannelUnread(latestById.get(id), lastReadById(id))) out.add(id);
  }
  return out;
}

/** Where each room's read mark lives: `${prefix}${communityId}_${channelId}` (ms). */
export const CONCORD_READ_PREFIX = "ro_concord_read_";

/** The per-channel read mark ConcordChat persists (ms; 0 = never read). */
export function readChannelLastRead(communityId: string, channelId: string): number {
  try {
    return Number(localStorage.getItem(`${CONCORD_READ_PREFIX}${communityId}_${channelId}`)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Move a room's read mark forward, never back. Tells the group's unread dot
 * and mention badges ("concord-read", with the group id) and the cross-device
 * read-state sync, so the room reads as read on your other devices too.
 * Returns whether the mark moved.
 */
export function writeChannelLastRead(communityId: string, channelId: string, ms: number): boolean {
  if (!(ms > readChannelLastRead(communityId, channelId))) return false;
  try { localStorage.setItem(`${CONCORD_READ_PREFIX}${communityId}_${channelId}`, String(ms)); } catch { return false; }
  try { window.dispatchEvent(new CustomEvent("concord-read", { detail: communityId })); } catch {}
  try { window.dispatchEvent(new CustomEvent(READSTATE_CHANGED_EVENT)); } catch {}
  return true;
}
