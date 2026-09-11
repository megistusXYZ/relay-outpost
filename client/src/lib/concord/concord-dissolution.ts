/**
 * Dissolution (CORD-02 §9): how a group its owner deleted ends for everyone.
 *
 * The owner signs one tombstone at an address derived from the group's id
 * alone, so every member past or present resolves the same address and a
 * Refounding can never strand it. The tombstone is terminal and chainless:
 * its presence is the state. On sight a client seals the group: read-only,
 * subscriptions halted, history still readable.
 *
 * That address needs no secret, so anyone holding the id can publish there.
 * The one thing nobody else can make is the owner's signed tombstone, and it
 * names the group it deletes: one lifted off another group the same owner runs
 * must not kill this one, so a verifier refuses any other `eid`.
 */
import { hexToBytes } from "@noble/hashes/utils.js";
import { groupKey, type GroupKey } from "./concord-crypto";
import { KIND_CONTROL_EDITION, VSK, type RumorTemplate, type FoldedState } from "./concord-events";

/**
 * Has this group been deleted? The owner's tombstone at its address, or an
 * owner's dissolution on the admin plane (what we published before we wrote
 * tombstones), each counting only when it names this group.
 */
export function isDeleted(
  group: { community_id: string; owner: string },
  state: FoldedState,
  tombstones: { kind: number; pubkey: string; tags: string[][] }[],
): boolean {
  return state.dissolvedEids.has(group.community_id) || tombstones.some((r) => isDissolution(r, group));
}

/** Appendix A.6: secret = community_id, id = 0…0, no epoch. */
export const LABEL_DISSOLVED = "concord/dissolved";

/** Where a group's tombstone lives: the same address for every member, from its id alone. */
export function dissolvedPlaneKey(communityId: string): GroupKey {
  return groupKey(LABEL_DISSOLVED, hexToBytes(communityId), new Uint8Array(32));
}

/** The owner's tombstone: one edition carrying nothing but its binding. */
export function buildDissolutionRumor(owner: string, communityId: string, createdAt: number): RumorTemplate {
  return {
    kind: KIND_CONTROL_EDITION, pubkey: owner, created_at: createdAt, content: "",
    tags: [["vsk", String(VSK.DISSOLVED)], ["eid", communityId]],
  };
}

/**
 * Is this the owner's tombstone for this group? The rumor's author is already
 * the seal's signer when it comes from decodeStreamEvent.
 */
export function isDissolution(
  rumor: { kind: number; pubkey: string; tags: string[][] },
  group: { community_id: string; owner: string },
): boolean {
  const tag = (name: string) => rumor.tags.find((t) => t[0] === name)?.[1];
  return rumor.kind === KIND_CONTROL_EDITION
    && rumor.pubkey === group.owner
    && tag("vsk") === String(VSK.DISSOLVED)
    && tag("eid") === group.community_id;
}
