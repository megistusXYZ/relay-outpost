// Safe read/write of the standard NIP-51 "Interests" list (kind-10015) — the
// PORTABLE followed-hashtag list that other clients (Amethyst, Primal, …) also
// maintain. Hashtags live as ["t", "<tag>"] tags (lowercase, no leading "#").
//
// This mirrors the follow-list (kind-3) wipe-guard exactly, because kind-10015
// is a single replaceable event shared across every one of the user's Nostr
// apps: an incremental follow/unfollow must be built from the CURRENT list, and
// if that current list can't be loaded (relay lag, narrow relay set, not-yet-
// hydrated) a write built on an empty base would REPLACE — and thereby wipe —
// the hashtags another client added. The whole point of this module is that no
// code path can ever publish a kind-10015 that drops tags present in the user's
// existing list: every write merges into a freshly-loaded, durably-cached base
// (see mergeAddTag/removeTag), and if no authoritative base is obtainable for an
// account we know has interests, we ABORT rather than publish.
//
// The pure logic (parse/merge/cache/wipe-guard decision) lives in
// interests-core.ts so it can be unit-tested without the heavy nostr.ts graph.
//
// Note: our own custom feeds are kind-30078 (namespaced, in use-nostr-feeds.ts)
// and are deliberately kept SEPARATE — we never migrate feed hashtags into
// interests; only an explicit user "Follow" action writes kind-10015.

import type { Event } from "nostr-tools";
import { pool, eventStore, DEFAULT_RELAYS, publishEvent, verifySignedEventKind } from "@/lib/nostr";
import { getWriteRelays, getReadRelays } from "@/lib/outbox";
import { signWithTimeout } from "@/lib/signer-timeout";
import type { ISigner } from "applesauce-signers";
import {
  KIND_INTERESTS,
  INTERESTS_CHANGED_EVENT,
  normalizeHashtag,
  parseInterests,
  cacheInterestsEvent,
  getCachedInterestsEvent,
  getFollowedHashtags,
  hasKnownInterests,
  isHashtagFollowed,
  mergeAddTag,
  removeTag,
  resolveBase,
  type InterestsBase,
} from "@/lib/interests-core";

// Re-export the pure surface so callers import everything from "@/lib/interests".
export {
  KIND_INTERESTS,
  INTERESTS_CHANGED_EVENT,
  normalizeHashtag,
  parseInterests,
  cacheInterestsEvent,
  getCachedInterestsEvent,
  getFollowedHashtags,
  hasKnownInterests,
  isHashtagFollowed,
  type InterestsBase,
};

// Broad, history-keeping relays so an existing kind-10015 is reliably found even
// if it isn't on the user's primary set (mirrors follow-list's scan set).
const INTERESTS_SCAN_RELAYS = [
  "wss://relay.nostr.band", "wss://purplepag.es", "wss://relay.primal.net",
  "wss://relay.damus.io", "wss://nos.lol", "wss://nostr21.com",
];

/**
 * Resolve the authoritative base kind-10015 for an incremental change, safely.
 * Order: eventStore cache → broad relay fetch → durable localStorage cache.
 * Returns blocked=true only when no base is obtainable yet we know the account
 * has an interests list (caller aborts — never wipes).
 */
export async function loadInterestsBase(myPubkey: string): Promise<InterestsBase> {
  let candidate: Event | null = eventStore.getReplaceable(KIND_INTERESTS, myPubkey) ?? null;

  if (!candidate) {
    try {
      const relays = Array.from(new Set([
        ...getWriteRelays(myPubkey), ...getReadRelays(myPubkey),
        ...DEFAULT_RELAYS, ...INTERESTS_SCAN_RELAYS,
      ])).filter(Boolean);
      const fetched = await pool.querySync(
        relays,
        { kinds: [KIND_INTERESTS], authors: [myPubkey], limit: 1 },
        { maxWait: 6000 } as any,
      );
      if (fetched.length) {
        fetched.sort((a, b) => b.created_at - a.created_at);
        candidate = fetched[0];
        eventStore.add(candidate);
        cacheInterestsEvent(candidate);
      }
    } catch {}
  }

  return resolveBase(myPubkey, candidate, getCachedInterestsEvent(myPubkey));
}

/** Warm the durable cache on login/hydration so later writes are always safe. */
export async function warmInterestsCache(myPubkey: string): Promise<void> {
  if (!myPubkey) return;
  try { await loadInterestsBase(myPubkey); } catch {}
}

export interface WriteResult {
  ok: boolean;
  /** true when we refused to publish to avoid wiping a not-yet-loaded list. */
  blocked?: boolean;
  hashtags: string[];
}

/**
 * Shared merge+publish core for follow/unfollow. Loads the freshest base,
 * enforces the wipe-guard, applies `mutate` to the FULL preserved tag set, then
 * republishes the complete kind-10015 (preserving content + any non-"t" tags)
 * with a fresh created_at. Never publishes on an unknown base.
 */
async function publishInterests(
  myPubkey: string,
  signer: ISigner,
  mutate: (tags: string[][]) => string[][],
): Promise<WriteResult> {
  let { base, blocked } = await loadInterestsBase(myPubkey);

  // If blocked (known list, but not loadable), force one more load before giving
  // up — we must NEVER publish on an unknown base and clobber another client.
  if (blocked && !base) {
    ({ base, blocked } = await loadInterestsBase(myPubkey));
    if (blocked && !base) {
      return { ok: false, blocked: true, hashtags: getFollowedHashtags(myPubkey) };
    }
  }

  // Preserve EVERYTHING the base carried — every tag (t and non-t) plus content —
  // then apply the mutation so no other client's data can be dropped.
  const baseTags: string[][] = base ? base.tags.map((t) => [...t]) : [];
  const newTags = mutate(baseTags);
  const event = {
    kind: KIND_INTERESTS,
    created_at: Math.floor(Date.now() / 1000),
    tags: newTags,
    content: base?.content || "",
  };

  const signed = await signWithTimeout(signer, event);
  if (!verifySignedEventKind(signed, KIND_INTERESTS)) {
    return { ok: false, hashtags: getFollowedHashtags(myPubkey) };
  }
  await publishEvent(signed);
  cacheInterestsEvent(signed as Event, { force: true });
  const hashtags = parseInterests(signed as Event);
  try { window.dispatchEvent(new CustomEvent(INTERESTS_CHANGED_EVENT, { detail: { pubkey: myPubkey, hashtags } })); } catch {}
  return { ok: true, hashtags };
}

/** Add a hashtag to the portable interests list (merge, dedup, preserve). */
export async function followHashtag(myPubkey: string, signer: ISigner, tag: string): Promise<WriteResult> {
  const norm = normalizeHashtag(tag);
  if (!norm) return { ok: false, hashtags: getFollowedHashtags(myPubkey) };
  return publishInterests(myPubkey, signer, (tags) => mergeAddTag(tags, norm));
}

/** Remove a hashtag from the portable interests list (preserve everything else). */
export async function unfollowHashtag(myPubkey: string, signer: ISigner, tag: string): Promise<WriteResult> {
  const norm = normalizeHashtag(tag);
  if (!norm) return { ok: false, hashtags: getFollowedHashtags(myPubkey) };
  return publishInterests(myPubkey, signer, (tags) => removeTag(tags, norm));
}
