/**
 * Live governance fold for a Concord community: subscribes the control +
 * guestbook planes (across EVERY held base epoch — pre-rekey joins/audit stay
 * readable, CORD-03 §3), folds control editions, computes the roster, and
 * APPLIES incoming rekeys (CORD-06): a base rotation moves this member to the
 * new epoch (or detects their own removal); a channel-scoped rotation delivers
 * or rotates a private channel's key. Shared by ConcordChat and ConcordMembers.
 *
 * The pure aggregation (membership events, audit log) lives in concord-activity
 * so it stays node-testable; this hook just accumulates rumors and folds.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { persistentPoolSubscribe } from "@/lib/nostr";
import { subscribeGovernance, type DecodedRumor } from "@/lib/concord/concord-stream";
import { parseControlEdition, editionKey, parseSnapshotRumor, foldEditions, computeRoster, KIND_CONTROL_EDITION, KIND_JOIN_LEAVE, KIND_AUDIT, KIND_REKEY, KIND_SNAPSHOT, type ControlEdition, type FoldedState, type Member, type AuditEntry } from "@/lib/concord/concord-events";
import { computeMembershipEvents, computeAuditLog, type RawRumor, type MembershipEvent } from "@/lib/concord/concord-activity";
import { receiveRekey, receiveChannelGrant } from "@/lib/concord/concord-rekey";
import { saveRosterSnapshot } from "@/lib/concord/concord-roster";
import { putCommunity, updateCommunity, deleteCommunity, adoptBaseRekey, type StoredCommunity } from "@/lib/concord/concord-keys";
import { reconcilePatch } from "@/lib/concord/concord-reconcile";

export type { MembershipEvent };

/** window event (detail: communityId) fired when a rekey changed the stored
 *  community record (new epoch, channel key delivered, or self-removal). The
 *  owning page re-reads the record; a null read means "you were removed". */
export const COMMUNITY_UPDATED_EVENT = "concord-community-updated";

/**
 * A cosmetic record refresh — NOT a key change.
 *
 * Deliberately a different event from COMMUNITY_UPDATED_EVENT, whose contract is
 * "a rekey changed your KEYS; re-read, and a null read means you were removed".
 * Riding that channel would make every reconcile clear five rumor maps, blank
 * `myMember` (so the invite gate fails closed on its own writer) and re-issue the
 * REQ — while delivering nothing to the fold-less surfaces this write exists for.
 */
export const RECORD_RECONCILED_EVENT = "concord-record-reconciled";

/** Quiet interval before persisting a fold. See the effect for why. */
const RECONCILE_QUIET_MS = 1500;

// ONE writer per community. This hook is mounted by ConcordChat, ConcordMembers,
// ConcordOutpost and InviteToGroupDialog — on the outpost page with the drawer
// open, several are live at once, each with its own subscription and its own
// partially-refilled edition map. Un-elected, they would persist each other's
// intermediate folds in turn.
const reconcilerClaims = new Map<string, object>();
const RECONCILER_FREE = "concord-reconciler-free";

function useReconcilerElection(communityId: string | undefined): boolean {
  const token = useRef({});
  const [owns, setOwns] = useState(false);
  useEffect(() => {
    if (!communityId) { setOwns(false); return; }
    const mine = token.current;
    const claim = () => {
      if (!reconcilerClaims.has(communityId)) reconcilerClaims.set(communityId, mine);
      setOwns(reconcilerClaims.get(communityId) === mine);
    };
    claim();
    window.addEventListener(RECONCILER_FREE, claim);
    return () => {
      window.removeEventListener(RECONCILER_FREE, claim);
      if (reconcilerClaims.get(communityId) === mine) {
        reconcilerClaims.delete(communityId);
        window.dispatchEvent(new Event(RECONCILER_FREE)); // a survivor takes over
      }
    };
  }, [communityId]);
  return owns;
}

const BASE_SCOPE = "00".repeat(32);

export function useConcordGovernance(community: StoredCommunity | null | undefined): { state: FoldedState; roster: Member[]; myMember?: Member; events: MembershipEvent[]; auditLog: AuditEntry[] } {
  const { pubkey } = useNostrAuth();
  const [editions, setEditions] = useState<Map<string, ControlEdition>>(new Map());
  const [joinLeave, setJoinLeave] = useState<Map<string, RawRumor>>(new Map());
  const [audit, setAudit] = useState<Map<string, RawRumor & { content: string }>>(new Map());
  const [rekeys, setRekeys] = useState<Map<string, DecodedRumor>>(new Map());
  const [snapshots, setSnapshots] = useState<Map<string, DecodedRumor>>(new Map());

  // The subscription's identity is its PLANES, not the whole record. Keyed on
  // the record, ANY cosmetic write — a folded name landing in IDB — cleared all
  // five rumor maps, re-issued the REQ across every relay, and blanked
  // `myMember` with it, so a legitimately-permitted member's invite gate went
  // false on every mirror write. That is also what makes a fold-driven writer
  // safe to add below: it cannot tear down the fold that produced it.
  const planeSig = useMemo(() => (community ? JSON.stringify([
    community.community_id, community.community_root, community.root_epoch,
    (community.priorRoots ?? []).map((p) => [p.root, p.epoch]),
    community.relays,
    community.channels.filter((c) => c.isPrivate && c.key).map((c) => [c.id, c.key, c.epoch]),
  ]) : ""), [community]);
  // Read the CURRENT record inside the effect without making it a dependency.
  const communityRef = useRef(community);
  communityRef.current = community;

  useEffect(() => {
    const live = communityRef.current;
    if (!pubkey || !live) return;
    setEditions(new Map()); setJoinLeave(new Map()); setAudit(new Map()); setRekeys(new Map()); setSnapshots(new Map());
    const sub = subscribeGovernance(pubkey, live, (rumor) => {
      // DEDUP on immutable keys: the same rumor is redelivered constantly (every
      // relay in the set echoes it, reconnects replay it, and right after create
      // the just-published editions echo from all 5 relays at once). Editions are
      // content-addressed (eid is a hash) and every other rumor is keyed by its
      // immutable event id, so a repeat delivery carries identical content —
      // return `prev` unchanged rather than minting a new Map. Without this, each
      // duplicate produced a new Map → new folded `state` → new `activeChannel`
      // object in ConcordChat → its message subscription tore down + `setMessages([])`
      // + re-subscribed on every echo, a post-create churn storm that froze slower
      // machines / chatty relay sets (reload was clean because the editions had
      // settled to a single delivery). Mirrors the dedup ConcordChat's own message
      // handlers already do (`if (prev.has(id)) return prev`).
      if (rumor.kind === KIND_CONTROL_EDITION) {
        const ed = parseControlEdition(rumor);
        if (ed) setEditions((prev) => {
          // The rumor id is part of the key because the premise above — "eid is a
          // hash", so one coordinate+version means one payload — is false for
          // exactly one entity. The banlist is published at a FIXED eid, so two
          // genuinely different banlists share the key `4:ba…ba:1`, and keying
          // without the rumor id silently dropped the second at ingest: the fold
          // never saw it, its tie-break never ran, and which snapshot survived
          // came down to which relay echoed first — so two devices could hold
          // different banlists from identical relay data.
          //
          // The churn this dedup exists to stop is REDELIVERY of the same rumor,
          // which still collapses here: same rumor, same id, same key.
          const key = editionKey(ed);
          return prev.has(key) ? prev : new Map(prev).set(key, ed);
        });
      } else if (rumor.kind === KIND_JOIN_LEAVE) {
        setJoinLeave((prev) => prev.has(rumor.id) ? prev : new Map(prev).set(rumor.id, rumor));
      } else if (rumor.kind === KIND_AUDIT) {
        setAudit((prev) => prev.has(rumor.id) ? prev : new Map(prev).set(rumor.id, rumor));
      } else if (rumor.kind === KIND_REKEY) {
        setRekeys((prev) => prev.has(rumor.id) ? prev : new Map(prev).set(rumor.id, rumor));
      } else if (rumor.kind === KIND_SNAPSHOT) {
        // Refounding guestbook snapshot (CORD-06 §3): seeds pre-Refounding
        // survivors into the roster fold; keyed by rumor id so a dual-delivered
        // chunk folds once. Absent snapshots leave the roster untouched.
        setSnapshots((prev) => prev.has(rumor.id) ? prev : new Map(prev).set(rumor.id, rumor));
      }
    }, (relays, filter, onevent) => persistentPoolSubscribe(relays, filter, { onevent }));
    return () => sub.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, planeSig]);

  const owner = community?.owner ?? "";
  const folded = useMemo(() => {
    const state = foldEditions([...editions.values()], owner);
    const snaps = [...snapshots.values()].map(parseSnapshotRumor).filter((s): s is NonNullable<typeof s> => s !== null);
    const roster = owner ? computeRoster([...joinLeave.values()], state, owner, snaps) : [];
    const myMember = pubkey ? roster.find((m) => m.pubkey === pubkey) : undefined;
    const events = computeMembershipEvents([...joinLeave.values()]);
    const auditLog = computeAuditLog([...audit.values()]);
    return { state, roster, myMember, events, auditLog };
  }, [editions, joinLeave, audit, snapshots, owner, pubkey]);

  // ── Apply incoming rekeys (CORD-06 receive side) ───────────────────────────
  // A rotation arrives as kind-3303 chunk rumors on the (old-epoch) control
  // plane. Grouped by (rotator, scope):
  //  - base scope → receiveRekey against the community_root: "rekeyed" moves
  //    this device to the new epoch (retaining the prior root for history);
  //    "removed" means WE were evicted — drop the local keys.
  //  - channel scope, key held → rotate/drop that private channel's key.
  //  - channel scope, key NOT held → an explicit grant delivery (the ONLY way
  //    a member gains a private channel; invites never carry those keys).
  // Everything here is idempotent: an already-applied rotation filters out on
  // the prevepoch/continuity checks, so re-runs (and the second hook instance
  // on another tab) are no-ops.
  useEffect(() => {
    if (!pubkey || !community || rekeys.size === 0) return;
    const signer = getGlobalSigner();
    if (!signer?.nip44) return;
    let cancelled = false;
    const notify = () => window.dispatchEvent(new CustomEvent(COMMUNITY_UPDATED_EVENT, { detail: community.community_id }));
    (async () => {
      const groups = new Map<string, { rotator: string; scope: string; rumors: DecodedRumor[] }>();
      for (const r of rekeys.values()) {
        const scope = r.tags.find((t) => t[0] === "scope")?.[1];
        if (!scope) continue;
        const key = `${r.pubkey}:${scope}`;
        const g = groups.get(key) ?? { rotator: r.pubkey, scope, rumors: [] };
        g.rumors.push(r);
        groups.set(key, g);
      }
      const auth = { ownerPubkey: owner, roster: folded.roster };
      for (const g of groups.values()) {
        if (cancelled) return;
        try {
          if (g.scope === BASE_SCOPE) {
            const res = await receiveRekey(signer, pubkey, g.rotator,
              { scopeId: g.scope, myCurrentKey: hexToBytes(community.community_root), myCurrentEpoch: community.root_epoch },
              g.rumors, auth);
            if (cancelled) return;
            if (res.status === "rekeyed") {
              await putCommunity(pubkey, adoptBaseRekey(community, bytesToHex(res.newKey), res.newEpoch));
              notify();
              return; // the refreshed record re-runs this effect with new planes
            }
            if (res.status === "removed") {
              await deleteCommunity(pubkey, community.community_id);
              notify();
              return;
            }
          } else {
            const ch = community.channels.find((c) => c.id === g.scope);
            if (ch?.isPrivate && ch.key) {
              const res = await receiveRekey(signer, pubkey, g.rotator,
                { scopeId: g.scope, myCurrentKey: hexToBytes(ch.key), myCurrentEpoch: ch.epoch },
                g.rumors, auth);
              if (cancelled) return;
              if (res.status === "rekeyed") {
                await putCommunity(pubkey, { ...community, channels: community.channels.map((c) => c.id === g.scope ? { ...c, key: bytesToHex(res.newKey), epoch: res.newEpoch } : c) });
                notify();
                return;
              }
              if (res.status === "removed") {
                await putCommunity(pubkey, { ...community, channels: community.channels.filter((c) => c.id !== g.scope) });
                notify();
                return;
              }
            } else if (!ch) {
              const grant = await receiveChannelGrant(signer, pubkey, g.rotator, g.scope, g.rumors, auth);
              if (cancelled) return;
              if (grant) {
                const meta = folded.state.channels.get(g.scope);
                await putCommunity(pubkey, {
                  ...community,
                  channels: [...community.channels, { id: g.scope, key: bytesToHex(grant.key), epoch: grant.epoch, name: meta?.name || "private", isPrivate: true }],
                });
                notify();
                return;
              }
            }
          }
        } catch { /* pending — retried when more chunks / roster arrive */ }
      }
    })();
    return () => { cancelled = true; };
  }, [pubkey, community, rekeys, folded.roster, folded.state, owner]);

  // Persist the member pubkeys so surfaces without a live fold (the merged
  // chat list) can apply the 2-person "present as person" rule. Only once the
  // fold has seen a join (≥2 members): right after subscribe the roster is
  // just the owner — computeRoster seats them without a rumor — and that
  // partial state must not clobber a known snapshot.
  const communityId = community?.community_id;
  useEffect(() => {
    if (communityId && folded.roster.length >= 2) {
      saveRosterSnapshot(communityId, folded.roster.map((m) => m.pubkey));
    }
  }, [communityId, folded.roster]);

  // ── Reconcile the stored record with the fold ──────────────────────────────
  // Subsumes the two ad-hoc mirrors that used to live here (a NAME write, and an
  // additive CHANNEL seat + retraction). They were right in shape and invisible
  // in effect: neither dispatched COMMUNITY_UPDATED_EVENT, so their writes
  // landed in IndexedDB and only surfaced on the next reload — which is also why
  // neither was ever browser-verified.
  //
  // Everything that makes this safe lives outside the write. `reconcilePatch` is
  // pure and returns null when there is nothing to do, so it terminates by
  // construction rather than by a dependency array. `updateCommunity` applies the
  // patch inside ONE transaction against the row as it exists there, so no field
  // the patch does not name can regress and a row the user just deleted is never
  // recreated. And the subscription above is keyed on plane identity, so this
  // write cannot tear down the fold that produced it.
  const isReconciler = useReconcilerElection(communityId);
  useEffect(() => {
    if (!pubkey || !communityId || !isReconciler) return;
    // No admitted edition yet — nothing POSITIVE to say about anything.
    if (folded.state.heads.size === 0) return;
    // Wait for quiet. The fold is not monotone: on a cold subscribe it walks
    // through older editions in arrival order, so "the fold currently says X" is
    // not worth persisting until it stops moving.
    const t = setTimeout(() => {
      void updateCommunity(pubkey, communityId, (row) => reconcilePatch(row, folded.state))
        .then((wrote) => {
          if (wrote) window.dispatchEvent(new CustomEvent(RECORD_RECONCILED_EVENT, { detail: communityId }));
        });
    }, RECONCILE_QUIET_MS);
    return () => clearTimeout(t);
  }, [pubkey, communityId, isReconciler, folded.state]);

  return folded;
}
