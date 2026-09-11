/**
 * What one device remembers about the Community List, per account.
 *
 * - The groups left here. Leaving deletes the keys, so this lives apart from
 *   the key store. It is how the leave reaches the List when the relays were
 *   out of reach at the time, and how the List is kept from undoing it first.
 *   Clearing local data (wipeConcordKeys) does NOT write here: clearing a
 *   device is not leaving, and must not take the group off your other devices.
 * - Whether this device has ever seen a List. A relay that answers with none,
 *   after we have seen one, lost it or isn't the one holding it; that is no
 *   licence to start a new List (the mute-list "seen" marker, same reason).
 */
const leftKey = (pubkey: string) => `concord-left-groups:${pubkey}`;
const seenKey = (pubkey: string) => `concord-community-list-seen:${pubkey}`;

export function leftGroups(pubkey: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(leftKey(pubkey)) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

export function markLeft(pubkey: string, communityId: string, at = Date.now()): void {
  try {
    const left = leftGroups(pubkey);
    left[communityId] = Math.max(at, left[communityId] ?? 0);
    localStorage.setItem(leftKey(pubkey), JSON.stringify(left));
  } catch { /* storage refused: the leave still holds here; it just can't reach your other devices */ }
}

export function hasSeenList(pubkey: string): boolean {
  try { return localStorage.getItem(seenKey(pubkey)) === "1"; } catch { return false; }
}

export function markListSeen(pubkey: string): void {
  try { localStorage.setItem(seenKey(pubkey), "1"); } catch { /* best-effort */ }
}
