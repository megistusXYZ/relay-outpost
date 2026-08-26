/**
 * The per-relay half of "pin this room".
 *
 * ONE pin button, TWO stores, and that was always the design: this one floats a
 * room to the top of its own community's room list (and feeds the "Pinned"
 * filter chip there), while `pinned-feeds.ts` is the shared store the Outposts
 * hub, the sidebar and the Chats list read to show the room nested under its
 * community. CommsTab's handleTogglePin writes both together, deliberately, so
 * there is no separate star to keep in sync.
 *
 * It lived as two private functions inside CommsTab, which was fine while
 * CommsTab was the only writer. It stopped being fine the moment a second
 * surface grew an Unpin: clearing only the shared store removes the row from
 * Chats while the room stays pinned at the top of its own list with a filled
 * pin icon — a half-unpin, and exactly the kind of "it didn't work" a first-time
 * member reads as the app being broken.
 *
 * So the store moved here and `unpinRoomEverywhere` is the single act. Keeping
 * the two stores is still right — they answer different questions — but "unpin"
 * must mean one thing.
 */
import { unpinFeed, normalizeUrl } from "@/lib/pinned-feeds";

const PINS_STORAGE_PREFIX = "comms_pinned_";

/**
 * Trailing slashes only — NOT lowercased.
 *
 * Deliberately not `normalizeUrl`, which also lowercases. This prefix is the
 * key of a store that already has data in it under the original casing, and
 * silently changing the key would orphan every pin anyone has made rather than
 * migrate it. `pinned-feeds` is free to normalize harder because it derives its
 * ids afresh; this one is stuck with what it wrote.
 */
function keyFor(relayUrl: string): string {
  return PINS_STORAGE_PREFIX + relayUrl.replace(/\/+$/, "");
}

export function getPinnedRooms(relayUrl: string): Set<string> {
  try {
    const stored = localStorage.getItem(keyFor(relayUrl));
    return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export function setPinnedRooms(relayUrl: string, pinned: Set<string>): void {
  try {
    localStorage.setItem(keyFor(relayUrl), JSON.stringify([...pinned]));
  } catch {}
}

/**
 * Unpin a room from BOTH stores, so one press means one thing wherever it is
 * pressed.
 *
 * `unpinFeed` dispatches `pinned-feeds-changed`, which every reading surface
 * already subscribes to, so it is called LAST: the per-relay write lands first
 * and any listener that re-reads on that event sees both stores already
 * agreeing rather than catching them mid-update.
 */
export function unpinRoomEverywhere(relayUrl: string, channelId: string, pinnedFeedId: string): void {
  const rooms = getPinnedRooms(relayUrl);
  if (rooms.delete(channelId)) setPinnedRooms(relayUrl, rooms);
  unpinFeed(pinnedFeedId);
}

/** Exported for the guard test — the two stores must key on the same relay. */
export const __roomPinKeyFor = keyFor;
export const __sharedKeyFor = normalizeUrl;
