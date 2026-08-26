/**
 * Per-room (NIP-29 group) last-read timestamps.
 *
 * Extracted from CommsTab so the Chats list can compute an HONEST unread for a
 * joined room: "newest activity we actually heard about is newer than the last
 * message you saw here." The storage lives in exactly one module so the room
 * screen and the chat list cannot fork.
 *
 * KEYED BY RELAY + GROUP ID, and the relay half is load-bearing. A NIP-29
 * group id is only unique per relay — every relay's unnamed default room is
 * literally `"_"` (nip29.ts defaults a 39000 without a `d` tag to it) — so a
 * groupId-only key makes two different rooms share one read mark. That was
 * latent while marks were only read inside one relay's own room screen; the
 * moment the Chats list compared them against per-relay activity, the busier
 * relay's mark would forever mute the quieter room's unread dot. Reads fall
 * back to the legacy unscoped key so upgrading doesn't mark every room unread;
 * writes are scoped only, so the fallback ages out room by room as they're
 * opened.
 *
 * Deliberately LOCAL, like the news/channel read marks — see the cross-device
 * read-sync work (NIP-78): channel marks were excluded from the synced ledger
 * on purpose, and moving these into it is that initiative's call, not this
 * file's.
 */
const CHANNEL_READ_PREFIX = "ro_chan_read_";

/** Same identity rule as pinned-feeds' normalizeUrl / helpers' sameRelay:
 *  trailing slashes and case are not differences. Local copy, because this
 *  module is imported by both CommsTab and the chat list and must stay
 *  dependency-free. */
function relayKeyOf(relayUrl: string): string {
  return relayUrl.trim().replace(/\/+$/, "").toLowerCase();
}

function scopedKey(relayUrl: string, groupId: string): string {
  return `${CHANNEL_READ_PREFIX}${relayKeyOf(relayUrl)}|${groupId}`;
}

function readRaw(key: string): number {
  try {
    return parseInt(localStorage.getItem(key) || "0", 10) || 0;
  } catch {
    return 0;
  }
}

/** Seconds of the newest message the user has seen in this room; 0 = never. */
export function readChannelLastRead(relayUrl: string, groupId: string): number {
  const scoped = readRaw(scopedKey(relayUrl, groupId));
  if (scoped > 0) return scoped;
  // Legacy fallback: marks written before the key carried the relay. Read-only
  // — the next write for this room is scoped, and this stops mattering.
  return readRaw(CHANNEL_READ_PREFIX + groupId);
}

/** Monotonic: an older timestamp never overwrites a newer one. */
export function writeChannelLastRead(relayUrl: string, groupId: string, ts: number): void {
  try {
    if (ts > readChannelLastRead(relayUrl, groupId)) {
      localStorage.setItem(scopedKey(relayUrl, groupId), String(ts));
    }
  } catch {}
}
