/**
 * The Invite Registry (CORD-05 §5): the member-facing shadow of each creator's
 * links. A creator lists their live links by locator only (the author of the
 * link's kind-33301 bundle), never a token or URL, at `invite-links(community_id,
 * creator)`, so members can see that links exist without being able to use one.
 *
 * The union across creators still allowed to create invites is the group's
 * Public/Private truth: any live link means Public, none means Private.
 */
import { VSK, PERM, hasPermissionBit, memberPermissions, type FoldedState } from "./concord-events";
import { inviteLinksLocator } from "./concord-locators";
import type { StoredInviteSigner } from "./concord-keys";

const isLocator = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** Every live link the group's creators list, honoured only while each may create invites. Sorted, no repeats. */
export function activeInviteLinks(state: FoldedState, ownerPubkey: string, communityId: string): string[] {
  const out = new Set<string>();
  for (const [eid, { author, links }] of state.registries) {
    // Each creator owns exactly their own list (the fold refuses the rest; an
    // owner's edition is admitted unchecked, so check the binding here too).
    if (eid !== inviteLinksLocator(communityId, author)) continue;
    const may = author === ownerPubkey ||
      hasPermissionBit(memberPermissions(state.grants.get(author) ?? [], state.roles), PERM.CREATE_INVITE);
    if (!may) continue;
    for (const l of links) if (isLocator(l)) out.add(l);
  }
  return [...out].sort();
}

/** The group's live links once my own list reads `mine`: whether turning a link off leaves it Public. */
export function groupLinksWith(state: FoldedState, ownerPubkey: string, communityId: string, me: string, mine: string[]): string[] {
  const registries = new Map(state.registries);
  registries.set(inviteLinksLocator(communityId, me), { author: me, links: mine });
  return activeInviteLinks({ ...state, registries }, ownerPubkey, communityId);
}

// The head this device last published per list, until the fold echoes it: a
// second link made before the first edition comes back must chain past it,
// or the two land at one version and only one survives.
type Floor = { ev: number; hash: string; links: string[] };
const floors = new Map<string, Floor>();
export function registryFloor(communityId: string, me: string): Floor | undefined {
  return floors.get(`${communityId}:${me}`);
}
export function rememberRegistryHead(communityId: string, me: string, head: Floor): void {
  floors.set(`${communityId}:${me}`, head);
}

export interface NextRegistryEdition {
  eid: string;
  version: number;
  /** The head it chains onto; absent for a first list. */
  prevHash?: string;
  links: string[];
}

/**
 * My next Registry edition. What the group holds for me (so links made on my
 * other devices stay listed), plus this device's live links, minus any turned
 * off or expired, chained one past the highest head known: the fold's, or one
 * this device already published that the fold hasn't echoed yet.
 */
export function nextRegistryEdition(
  state: FoldedState,
  communityId: string,
  me: string,
  local: StoredInviteSigner[],
  now: number,
  floor?: { ev: number; hash: string },
): NextRegistryEdition {
  const eid = inviteLinksLocator(communityId, me);
  const held = state.registries.get(eid);
  const mine = held && held.author === me ? held.links : [];
  const ours = local.filter((l) => l.communityId === communityId);
  const dead = new Set(ours.filter((l) => l.revoked || (l.expiresAt !== undefined && l.expiresAt <= now)).map((l) => l.linkSignerPubkey));
  const links = [...new Set([...mine, ...ours.map((l) => l.linkSignerPubkey)])]
    .filter((l) => isLocator(l) && !dead.has(l))
    .sort();
  const head = [state.heads.get(`${VSK.REGISTRY}:${eid}`), floor]
    .filter((h): h is { ev: number; hash: string } => !!h?.hash)
    .reduce<{ ev: number; hash: string } | undefined>((best, h) => (!best || h.ev > best.ev ? h : best), undefined);
  return { eid, version: head ? head.ev + 1 : 1, ...(head ? { prevHash: head.hash } : {}), links };
}
