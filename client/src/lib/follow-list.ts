// Shared safeguards for publishing the kind-3 follow list.
//
// The follow-list wipe footgun: an incremental follow/unfollow builds the new
// kind-3 from the CURRENT list, but if that current list can't be loaded (relay
// lag, narrow relay set, not-yet-hydrated in-memory state) a follow built on an
// empty base publishes a 1-entry kind-3 that replaces the user's whole list.
//
// The old per-handler guard used in-memory `follows.length > 0` as "this user
// has follows" — but during the post-login hydration window that's empty for
// EXISTING users too, so the guard failed open and wiped lists. This module
// replaces that with a DURABLE last-known-good cache (localStorage) that
// survives the hydration race, plus a broad authoritative fetch.

import type { Event } from "nostr-tools";
import { pool, eventStore, DEFAULT_RELAYS } from "@/lib/nostr";
import { getWriteRelays, getReadRelays } from "@/lib/outbox";
import { KIND_FOLLOW_LIST, parseFollowList } from "@/lib/nostr-helpers";

// Broad, history-keeping relays so an existing kind-3 is reliably found even if
// it isn't on the user's primary set (mirrors RecoverFollows' scan set).
const FOLLOW_SCAN_RELAYS = [
  "wss://relay.nostr.band", "wss://purplepag.es", "wss://relay.primal.net",
  "wss://relay.damus.io", "wss://nos.lol", "wss://nostr21.com",
];

const cacheKey = (pubkey: string) => `relay_outpost_follow_event_${pubkey}`;
// Legacy snapshot written by NostrAuthContext / MyOutpost ({ pubkeys, timestamp }).
const legacySnapshotKey = (pubkey: string) => `flight_log_contacts_${pubkey.slice(0, 16)}`;

function pCount(ev: Event | null | undefined): number {
  return ev ? ev.tags.filter((t) => t[0] === "p").length : 0;
}

/** Read the durable last-known-good kind-3 for this account, if any. */
export function getCachedFollowEvent(pubkey: string): Event | null {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey));
    if (!raw) return null;
    const ev = JSON.parse(raw) as Event;
    return ev && ev.kind === KIND_FOLLOW_LIST && Array.isArray(ev.tags) ? ev : null;
  } catch {
    return null;
  }
}

/**
 * Persist a kind-3 as the last-known-good base.
 * - `force` (after a user-initiated publish): always store — it's the user's
 *   intended list, even a deliberate unfollow that shrinks it.
 * - default (during hydration): only store if it's at least as full as what we
 *   already cached, so a wipe (tiny list) can never overwrite a good cache.
 */
export function cacheFollowEvent(ev: Event | null | undefined, opts?: { force?: boolean }): void {
  if (!ev || ev.kind !== KIND_FOLLOW_LIST || !ev.pubkey) return;
  try {
    if (!opts?.force) {
      const existing = getCachedFollowEvent(ev.pubkey);
      // Never shrink the cache on hydration, and skip rewriting the same/older
      // snapshot (hydration fires once per relay that has the kind-3).
      if (existing && (pCount(ev) < pCount(existing) || ev.created_at <= existing.created_at)) return;
    }
    localStorage.setItem(cacheKey(ev.pubkey), JSON.stringify(ev));
  } catch {}
}

/** True if we have durable evidence this account already follows people. */
export function hasKnownFollows(pubkey: string): boolean {
  if (pCount(getCachedFollowEvent(pubkey)) > 0) return true;
  try {
    const raw = localStorage.getItem(legacySnapshotKey(pubkey));
    if (raw) {
      const snap = JSON.parse(raw);
      if (Array.isArray(snap?.pubkeys) && snap.pubkeys.length > 0) return true;
    }
  } catch {}
  return false;
}

export interface FollowBase {
  /** The authoritative current kind-3 to append/remove from (null = none found). */
  base: Event | null;
  /** True when we could NOT obtain an authoritative base but the account is known
   *  to have follows — caller MUST abort rather than publish (would wipe). */
  blocked: boolean;
}

/**
 * Resolve the authoritative base kind-3 for an incremental follow change, safely.
 * Order: eventStore cache → broad relay fetch → durable localStorage cache.
 * Returns blocked=true only when no base is obtainable yet we know the account
 * has follows (so the caller aborts and asks the user to retry — never wipes).
 * Returns base=null, blocked=false ONLY for a genuinely new account (no kind-3
 * anywhere and no durable evidence of prior follows) → safe to create the first list.
 */
export async function loadFollowBase(myPubkey: string, knownFollowCount = 0): Promise<FollowBase> {
  let base: Event | null = eventStore.getReplaceable(KIND_FOLLOW_LIST, myPubkey) ?? null;

  if (!base) {
    try {
      const relays = Array.from(new Set([
        ...getWriteRelays(myPubkey), ...getReadRelays(myPubkey),
        ...DEFAULT_RELAYS, ...FOLLOW_SCAN_RELAYS,
      ])).filter(Boolean);
      const fetched = await pool.querySync(
        relays,
        { kinds: [KIND_FOLLOW_LIST], authors: [myPubkey], limit: 1 },
        { maxWait: 6000 } as any,
      );
      if (fetched.length) {
        fetched.sort((a, b) => b.created_at - a.created_at);
        base = fetched[0];
        eventStore.add(base);
        cacheFollowEvent(base);
      }
    } catch {}
  }

  // Fall back to the durable cache. Prefer whichever kind-3 is NEWER (created_at):
  // never let a stale-but-larger cache override a fresh authoritative base, or a
  // cross-device unfollow (newer, fewer follows) would be resurrected on the next
  // publish.
  const cached = getCachedFollowEvent(myPubkey);
  if (cached && (!base || cached.created_at > base.created_at)) base = cached;

  if (base) return { base, blocked: false };

  // No base anywhere. Block if we have durable evidence of prior follows OR the
  // in-memory list (passed by the caller) is non-empty — covers a fresh device
  // with existing remote follows where the relay fetch came back empty/slow.
  return { base: null, blocked: hasKnownFollows(myPubkey) || knownFollowCount > 0 };
}
