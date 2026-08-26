/**
 * Concord group-chat list data for the Chats page: local communities from the
 * key store, plus the kind-13302 self-backup pull so a second browser (or a
 * cache-cleared one) rehydrates its group chats on load.
 *
 * The 13302 sync effect is transplanted from Outposts.tsx's Concord state block
 * — the hub keeps its own copy this PR (intentional, idempotent duplication);
 * PR 3 deletes the hub copy once this one has shipped.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Event } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { combineLatest, of } from "rxjs";
import { getCommunities, syncCommunityList, type StoredCommunity } from "@/lib/concord/concord-keys";
import { KIND_COMMUNITY_LIST } from "@/lib/concord/concord-events";
import { useConcordEnabled } from "@/lib/concord/concord-prefs";
import { ensureConcordUnreadWatcher } from "@/lib/concord/concord-unread";
import { getRosterSnapshot, resolveGroupName, ROSTER_CHANGED_EVENT } from "@/lib/concord/concord-roster";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { queryAnswered } from "@/lib/relay-reach";
import { publishEvent, persistentPoolSubscribe, eventStore, fetchProfilesCached } from "@/lib/nostr";
import { getDisplayName, KIND_METADATA, shortenNpub, formatNpub } from "@/lib/nostr-helpers";
import { getActiveDefaultRelays } from "@/lib/outpost-relays";
import { RECORD_RECONCILED_EVENT } from "@/components/concord/useConcordGovernance";

interface UseGroupChats {
  groups: StoredCommunity[];
  /** Re-pull the local store (e.g. after an invite is accepted). */
  reload: () => void;
  /** Whether the group-chat feature is on (gates the "New group chat" affordance). */
  concordEnabled: boolean;
}

/** Own the Concord communities backing the merged conversation list. */
export function useGroupChats(pubkey: string | null | undefined): UseGroupChats {
  const concordEnabled = useConcordEnabled();
  const [groups, setGroups] = useState<StoredCommunity[]>([]);

  const reload = useCallback(() => {
    if (!concordEnabled || !pubkey) { setGroups([]); return; }
    getCommunities(pubkey).then(setGroups).catch(() => {});
  }, [concordEnabled, pubkey]);

  // Load local communities + pull the 13302 backup on mount so a second
  // browser with the same account rehydrates. (Transplanted from Outposts.tsx.)
  useEffect(() => {
    if (!concordEnabled || !pubkey) { setGroups([]); return; }
    let cancelled = false;
    const load = () => getCommunities(pubkey).then((cs) => { if (!cancelled) setGroups(cs); });
    load();
    const signer = getGlobalSigner();
    if (signer) {
      // Read FIRST, and only sync if the relays actually answered.
      //
      // syncCommunityList merges local with remote and then publishes the local
      // list when it holds anything remote didn't. An unanswered read looks
      // exactly like "remote has nothing", so a browser with a PARTIAL local
      // list — a second device, or one whose cache was cleared — would publish
      // that partial list over a richer kind-13302 and drop every community it
      // had never heard of. kind-13302 is replaceable; the publish is the wipe.
      //
      // The old shape could not express this: it resolved `latest` on both EOSE
      // and a 4s timer, so "nobody answered" and "there is no backup" arrived
      // as the same `null`. The 4s was itself under nostr-tools' own give-up.
      (async () => {
        const { events, answered } = await queryAnswered(
          getActiveDefaultRelays(),
          { kinds: [KIND_COMMUNITY_LIST], authors: [pubkey], limit: 1 },
        );
        if (!answered || cancelled) return;
        const latest = events.length
          ? [...events].sort((a, b) => b.created_at - a.created_at)[0]
          : null;
        const added = await syncCommunityList(
          signer,
          pubkey,
          async () => latest,
          (e) => publishEvent(e, getActiveDefaultRelays()),
        );
        if (added && !cancelled) load();
      })().catch(() => {});
    }
    // A freshly-received direct invite may be accepted from anywhere (the
    // pending-invites card lives at the top of the list) — refresh on it.
    const onInvite = () => { void load(); };
    window.addEventListener("concord-invite-received", onInvite);
    // The reconciler just wrote a folded value (a rename, a description, a newly
    // seated channel) into the record. This list has no fold of its own, so it
    // is exactly the surface those mirrors always claimed to serve and never
    // reached — they wrote to IndexedDB and notified nobody.
    window.addEventListener(RECORD_RECONCILED_EVENT, onInvite);
    return () => {
      cancelled = true;
      window.removeEventListener("concord-invite-received", onInvite);
      window.removeEventListener(RECORD_RECONCILED_EVENT, onInvite);
    };
  }, [concordEnabled, pubkey]);

  // Keep the shared unread/activity watcher alive (idempotent across mounts).
  useEffect(() => { void ensureConcordUnreadWatcher(pubkey); }, [pubkey, groups.length]);

  return { groups, reload, concordEnabled };
}

/** The SHARED identity a group shows in the chat list: its member pubkeys (for
 *  the facepile), the resolved member display names (for search + the unnamed
 *  fallback), and the single shared name every member sees. */
export interface GroupIdentity {
  members: string[];
  memberNames: string[];
  name: string;
}

/**
 * Resolve every group's SHARED identity for the merged chat list — the same
 * for every member, so a group can't show a different name per viewer.
 *
 * For each community: read its roster snapshot (member pubkeys, drives the
 * facepile), resolve those pubkeys' display names reactively from the app
 * profile store, then compute the shared name via `resolveGroupName` —
 * folded/record name wins (the record is kept fresh by useConcordGovernance
 * mirroring the folded name back), falling back to a deterministic join of the
 * sorted member names only when the group was never named. Rosters come from
 * the snapshots useConcordGovernance persists; the map re-reads them on
 * ROSTER_CHANGED.
 */
export function useGroupIdentities(
  groups: StoredCommunity[],
  myPubkey: string | null | undefined,
): Map<string, GroupIdentity> {
  // Re-read snapshots when a live governance fold persists a new roster.
  const [rosterVersion, setRosterVersion] = useState(0);
  useEffect(() => {
    const bump = () => setRosterVersion((v) => v + 1);
    window.addEventListener(ROSTER_CHANGED_EVENT, bump);
    return () => window.removeEventListener(ROSTER_CHANGED_EVENT, bump);
  }, []);

  // communityId → member pubkeys (from the persisted roster snapshot).
  const rosters = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of groups) map.set(c.community_id, getRosterSnapshot(c.community_id) ?? []);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rosterVersion re-reads localStorage
  }, [groups, rosterVersion]);

  // All member pubkeys across every group, deduped, for one batched fetch.
  const allPubkeys = useMemo(
    () => [...new Set([...rosters.values()].flat())].sort(),
    [rosters],
  );
  useEffect(() => { if (allPubkeys.length) fetchProfilesCached(allPubkeys); }, [allPubkeys]);
  const profileEvents = use$(
    () => (allPubkeys.length
      ? combineLatest(allPubkeys.map((pk) => eventStore.replaceable(KIND_METADATA, pk)))
      : of([] as (Event | undefined)[])),
    [allPubkeys.join(",")],
  );

  return useMemo(() => {
    const nameByPk = new Map<string, string>();
    allPubkeys.forEach((pk, i) => {
      const profile = profileEvents?.[i];
      nameByPk.set(pk, profile ? getDisplayName(profile) : shortenNpub(formatNpub(pk)));
    });
    const result = new Map<string, GroupIdentity>();
    for (const c of groups) {
      const members = rosters.get(c.community_id) ?? [];
      // Member names for search + the unnamed-group fallback exclude me (a
      // group named after "the other people" reads better and matches how a
      // member would search for it).
      const memberNames = members
        .filter((pk) => pk !== myPubkey)
        .map((pk) => nameByPk.get(pk) ?? shortenNpub(formatNpub(pk)));
      result.set(c.community_id, {
        members,
        memberNames,
        name: resolveGroupName({ recordName: c.name, memberNames }),
      });
    }
    return result;
  }, [groups, rosters, allPubkeys, profileEvents, myPubkey]);
}
