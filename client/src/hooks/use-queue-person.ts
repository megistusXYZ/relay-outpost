import { useEffect } from "react";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { getAvatarUrl, getDisplayName, formatNpub, shortenNpub, KIND_METADATA } from "@/lib/nostr-helpers";

/**
 * Who a person IS, for the moderation queues — and ASK for it if we don't know.
 *
 * Both queues read `eventStore.replaceable(KIND_METADATA, …)` and stopped there.
 * The store only holds what the app has already seen, and the people in these
 * queues are strangers by definition: someone knocking on a closed room, or
 * someone a member just reported. Those are precisely the pubkeys the store has
 * never encountered, so both rows rendered a bare npub — at the exact moment the
 * product claims your community proves who's real, and at the exact moment a
 * moderator is deciding about a person.
 *
 * The fetch already existed. CommsTab — the legacy surface the admission queue
 * replaced — calls `fetchProfilesCached(reqs.map(r => r.pubkey))` for its join
 * requests. The new queues were written reading the store without ever asking
 * anyone to fill it, and both then re-implemented the same name/npub/avatar
 * derivation separately. Hence one hook: the two rows lay out differently, but
 * identity resolution is not where they should differ, and it is what drifted.
 *
 * `fetchProfilesCached` dedupes against a global cache and batches on a timer,
 * so N rows each asking for one pubkey coalesce into a single REQ. Calling it
 * per-row is the intended use, not a stampede.
 */
export function useQueuePerson(pubkey: string): {
  profile: Event | null;
  /** Display name, falling back to a shortened npub. Never empty. */
  name: string;
  avatarUrl: string | undefined;
  /** Route to their profile, or "#" if the pubkey won't encode. */
  profileUrl: string;
  /** True once a real kind-0 backs `name` — false means it is still an npub. */
  resolved: boolean;
} {
  const profile = (use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]) ?? null) as Event | null;

  // Ask only while we're still missing it. fetchProfilesCached is idempotent,
  // but re-requesting a pubkey we already have is pointless work on every render
  // pass of a list that refetches.
  useEffect(() => {
    if (!profile && pubkey) fetchProfilesCached([pubkey]);
  }, [profile, pubkey]);

  const short = shortenNpub(formatNpub(pubkey));
  const name = profile ? getDisplayName(profile, short) ?? short : short;
  const profileUrl = (() => {
    try { return `/profile/${nip19.npubEncode(pubkey)}`; } catch { return "#"; }
  })();

  return {
    profile,
    name,
    avatarUrl: getAvatarUrl(profile ?? undefined),
    profileUrl,
    resolved: !!profile,
  };
}
