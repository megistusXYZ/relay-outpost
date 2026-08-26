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

/** The per-channel read mark ConcordChat persists (ms; 0 = never read). */
export function readChannelLastRead(communityId: string, channelId: string): number {
  try {
    return Number(localStorage.getItem(`ro_concord_read_${communityId}_${channelId}`)) || 0;
  } catch {
    return 0;
  }
}
