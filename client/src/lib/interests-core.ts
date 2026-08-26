// Pure, dependency-free core of the kind-10015 "Interests" (followed hashtags)
// logic — split out from interests.ts so it imports NOTHING from the heavy
// nostr.ts graph (IndexedDB at load) and can be unit-tested directly, without
// mocks, in a node environment. interests.ts composes these with the impure
// relay fetch / sign / publish parts.
//
// The wipe-guard DECISION lives here as the pure `resolveBase`: kind-10015 is a
// single replaceable event shared across every one of the user's Nostr apps, so
// an incremental follow/unfollow that can't obtain the CURRENT list must ABORT
// rather than publish a fresh list that replaces (wipes) hashtags another client
// added. See interests.ts for the full rationale.

import type { Event } from "nostr-tools";

export const KIND_INTERESTS = 10015;

/** Fired on the window after a successful interests write so UI can refresh. */
export const INTERESTS_CHANGED_EVENT = "interests-changed";

const cacheKey = (pubkey: string) => `relay_outpost_interests_event_${pubkey}`;
// Durable "we have seen a real interests list for this account" marker, kept
// INDEPENDENT of the event cache (mirrors follow-list's legacy snapshot). This
// is what lets the wipe-guard still fire on a device where the cached event was
// cleared/corrupted but a list is known to exist remotely: without it, an empty
// cache + a slow relay fetch would look like a brand-new account and a first
// write would replace (wipe) the remote list.
const seenKey = (pubkey: string) => `relay_outpost_interests_seen_${pubkey}`;

/** Normalize a hashtag to its canonical stored form: trimmed, lowercase, no "#". */
export function normalizeHashtag(tag: string): string {
  return (tag || "").trim().replace(/^#+/, "").trim().toLowerCase();
}

/** The hashtags (lowercased "t" tag values) carried by a kind-10015 event. */
export function parseInterests(event: Event | null | undefined): string[] {
  if (!event || !Array.isArray(event.tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of event.tags) {
    if (t[0] === "t" && typeof t[1] === "string") {
      const norm = normalizeHashtag(t[1]);
      if (norm && !seen.has(norm)) { seen.add(norm); out.push(norm); }
    }
  }
  return out;
}

export function tCount(ev: Event | null | undefined): number {
  return ev ? ev.tags.filter((t) => t[0] === "t").length : 0;
}

function markInterestsSeen(pubkey: string): void {
  try { localStorage.setItem(seenKey(pubkey), "1"); } catch {}
}
function wasInterestsSeen(pubkey: string): boolean {
  try { return localStorage.getItem(seenKey(pubkey)) === "1"; } catch { return false; }
}

/** Read the durable last-known-good kind-10015 for this account, if any. */
export function getCachedInterestsEvent(pubkey: string): Event | null {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey));
    if (!raw) return null;
    const ev = JSON.parse(raw) as Event;
    return ev && ev.kind === KIND_INTERESTS && Array.isArray(ev.tags) ? ev : null;
  } catch {
    return null;
  }
}

/**
 * Persist a kind-10015 as the last-known-good base.
 * - `force` (after a user-initiated publish): always store — it's the user's
 *   intended list, even a deliberate unfollow that shrinks it.
 * - default (during hydration): only store if it's at least as full as what we
 *   already cached and not older, so a wipe (tiny/stale list) can never
 *   overwrite a good cache.
 */
export function cacheInterestsEvent(ev: Event | null | undefined, opts?: { force?: boolean }): void {
  if (!ev || ev.kind !== KIND_INTERESTS || !ev.pubkey) return;
  try {
    if (!opts?.force) {
      const existing = getCachedInterestsEvent(ev.pubkey);
      if (existing && (tCount(ev) < tCount(existing) || ev.created_at <= existing.created_at)) return;
    }
    localStorage.setItem(cacheKey(ev.pubkey), JSON.stringify(ev));
    // Any real list we've held (even one the user later empties) proves the
    // account HAS an interests list — remember that durably for the wipe-guard.
    if (tCount(ev) > 0) markInterestsSeen(ev.pubkey);
  } catch {}
}

/** True if we have durable evidence this account already has an interests list. */
export function hasKnownInterests(pubkey: string): boolean {
  return getCachedInterestsEvent(pubkey) !== null || wasInterestsSeen(pubkey);
}

/** The current followed hashtags for this account, from the durable cache. */
export function getFollowedHashtags(pubkey: string): string[] {
  return parseInterests(getCachedInterestsEvent(pubkey));
}

/** True if the given hashtag is currently in the durable interests cache. */
export function isHashtagFollowed(pubkey: string, tag: string): boolean {
  const norm = normalizeHashtag(tag);
  return norm ? getFollowedHashtags(pubkey).includes(norm) : false;
}

/**
 * Add a hashtag to a tag set, preserving EVERY existing tag (both "t" and any
 * other-client tags) and dedup/normalizing the new one. Idempotent.
 */
export function mergeAddTag(tags: string[][], tag: string): string[][] {
  const norm = normalizeHashtag(tag);
  if (!norm) return tags;
  const already = tags.some((t) => t[0] === "t" && normalizeHashtag(t[1]) === norm);
  return already ? tags : [...tags, ["t", norm]];
}

/** Remove a hashtag from a tag set, preserving everything else verbatim. */
export function removeTag(tags: string[][], tag: string): string[][] {
  const norm = normalizeHashtag(tag);
  if (!norm) return tags;
  return tags.filter((t) => !(t[0] === "t" && normalizeHashtag(t[1]) === norm));
}

export interface InterestsBase {
  /** The authoritative current kind-10015 to add/remove from (null = none found). */
  base: Event | null;
  /** True when we could NOT obtain an authoritative base but the account is known
   *  to have interests — caller MUST abort rather than publish (would wipe). */
  blocked: boolean;
}

/**
 * The wipe-guard decision, pure. Given the freshest candidate we could obtain
 * (from the eventStore or a relay fetch) and the durable cache, choose the base
 * to build the incremental change on — preferring whichever is NEWER so a stale
 * cache can't resurrect a cross-device unfollow. If nothing is obtainable,
 * block ONLY when the account is known to have a list (never wipe); a genuinely
 * new account returns base=null, blocked=false → safe to create the first list.
 */
export function resolveBase(pubkey: string, candidate: Event | null, cached: Event | null): InterestsBase {
  let base = candidate;
  if (cached && (!base || cached.created_at > base.created_at)) base = cached;
  if (base) return { base, blocked: false };
  return { base: null, blocked: hasKnownInterests(pubkey) };
}
