/**
 * Decrypted last-message teasers for the encrypted group rows in the merged
 * Chats list ("Vitor: testing from amethyst").
 *
 * Source = the already-decrypted IDB message cache ONLY (concord-keys'
 * messages store, written by ConcordChat as streams decode). The list-level
 * unread watcher (concord-unread) stays metadata-only — this hook NEVER
 * decrypts a wrap; a group whose stream hasn't been opened on this device
 * simply has no teaser yet and keeps the generic "N rooms · encrypted"
 * line. Re-polls when the metadata activity clock moves (a new wrap arrived —
 * if the chat is open it lands in the cache moments later) and on read events.
 */
import { useEffect, useMemo, useState } from "react";
import type { Event } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { combineLatest, of } from "rxjs";
import { getCachedMessages, type CachedMessage, type StoredCommunity } from "@/lib/concord/concord-keys";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { getDisplayName, KIND_METADATA, shortenNpub, formatNpub } from "@/lib/nostr-helpers";
import { formatGroupTeaser } from "./helpers";

/** communityId → formatted teaser (absent ⇒ show the generic encrypted line). */
export function useGroupTeasers(
  groups: StoredCommunity[],
  myPubkey: string | null | undefined,
  /** Per-community activity clocks (useConcordActivity) — the re-poll trigger. */
  activity: Map<string, number>,
): Map<string, { teaser: string; channelId: string }> {
  // Latest message per community + the channel it came from — multi-channel
  // groups prefix the teaser with "#general · " so the row says WHERE, and the
  // channel id lets a tap open the SAME channel the teaser is showing.
  const [latest, setLatest] = useState<Map<string, { msg: CachedMessage; prefix: string; channelId: string }>>(new Map());

  // Cheap change key: re-read the cache only when a community's clock moves
  // (or the set of groups changes) — not on unrelated re-renders.
  const activityKey = groups
    .map((c) => `${c.community_id}:${activity.get(c.community_id) ?? 0}`)
    .join("|");

  useEffect(() => {
    if (!myPubkey || groups.length === 0) { setLatest(new Map()); return; }
    let cancelled = false;
    (async () => {
      const next = new Map<string, { msg: CachedMessage; prefix: string; channelId: string }>();
      for (const c of groups) {
        let best: { msg: CachedMessage; channelName: string; channelId: string } | null = null;
        for (const ch of c.channels) {
          const msgs = await getCachedMessages(myPubkey, c.community_id, ch.id).catch(() => [] as CachedMessage[]);
          // msgs are sorted ascending — walk back to the newest non-deleted one.
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m.deleted) continue;
            if (!best || m.t > best.msg.t) best = { msg: m, channelName: ch.name, channelId: ch.id };
            break;
          }
        }
        if (best) {
          // Single-channel groups read as plain group chats — no channel jargon.
          const prefix = c.channels.length > 1 ? `#${best.channelName} · ` : "";
          next.set(c.community_id, { msg: best.msg, prefix, channelId: best.channelId });
        }
      }
      if (!cancelled) setLatest(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activityKey covers groups+activity
  }, [myPubkey, activityKey]);

  // Resolve the (few) latest-message senders' display names reactively, the
  // same way useGroupIdentities resolves the facepile names.
  const senderPks = useMemo(
    () => [...new Set([...latest.values()].map((e) => e.msg.pubkey))].sort(),
    [latest],
  );
  useEffect(() => { if (senderPks.length) fetchProfilesCached(senderPks); }, [senderPks]);
  const profileEvents = use$(
    () => (senderPks.length
      ? combineLatest(senderPks.map((pk) => eventStore.replaceable(KIND_METADATA, pk)))
      : of([] as (Event | undefined)[])),
    [senderPks.join(",")],
  );

  return useMemo(() => {
    const nameByPk = new Map<string, string>();
    senderPks.forEach((pk, i) => {
      const profile = profileEvents?.[i];
      nameByPk.set(pk, profile ? getDisplayName(profile) : shortenNpub(formatNpub(pk)));
    });
    const out = new Map<string, { teaser: string; channelId: string }>();
    for (const [communityId, { msg, prefix, channelId }] of latest) {
      const sender = msg.pubkey === myPubkey
        ? "You"
        : (nameByPk.get(msg.pubkey) ?? shortenNpub(formatNpub(msg.pubkey)));
      const teaser = formatGroupTeaser(msg, sender);
      if (teaser) out.set(communityId, { teaser: `${prefix}${teaser}`, channelId });
    }
    return out;
  }, [latest, senderPks, profileEvents, myPubkey]);
}
