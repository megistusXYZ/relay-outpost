/**
 * "Your space" — who is inside it while an account's wider network is off
 * (owner, 2026-10-10; the switch lives in lib/network-mode.ts).
 *
 * The floor relays are public inboxes, so a brand-new account can be
 * reached by anyone on them from minute one: a stranger's message, a bot's
 * mention. These rules decide what reaches the account's ATTENTION — the
 * Primary chat list, the badges, the open sections of Activity — while the
 * wider network is off: the people it follows, and nobody else. Everything
 * from outside still exists (Requests, a folded section); it just doesn't
 * get the account's first look. With the wider network on, or for any
 * account from before the switch, every rule is exactly what it was. Pure.
 */

export interface YourSpace {
  widerNetworkOn: boolean;
  follows: ReadonlySet<string>;
}

/** Is this person inside the account's space? On → everyone is. */
export function inYourSpace(space: YourSpace, pubkey: string): boolean {
  return space.widerNetworkOn || space.follows.has(pubkey);
}

export interface DmPrimaryInput {
  space: YourSpace;
  /** Chats the person moved to Requests by hand: always Requests. */
  demoted: ReadonlySet<string>;
  /** Chats the person moved to Primary by hand: always Primary. */
  promoted: ReadonlySet<string>;
  /** Chats the person wrote first in: their own choice to talk. */
  initiatedByMe: ReadonlySet<string>;
  /** The chat's key (the peer, or a group key) — what demoted/promoted/initiated are keyed by. */
  key?: string;
  /** The people in the chat (one for a one-to-one chat). */
  members: readonly string[];
  /** People who follow the account (the server graph; no score check). */
  followedBy?: ReadonlySet<string>;
  tierOf: (pubkey: string) => string;
}

/**
 * Does a chat land in Primary? Off: someone you follow, someone you wrote
 * to first, or a chat you moved there — a stranger who followed first (the
 * bot pattern) or who scores well is still a stranger. On: today's rule.
 */
export function dmLandsInPrimary(o: DmPrimaryInput): boolean {
  const key = o.key ?? o.members[0] ?? "";
  if (o.demoted.has(key)) return false;
  if (o.promoted.has(key)) return true;
  if (o.initiatedByMe.has(key)) return true;
  for (const m of o.members) {
    if (o.space.follows.has(m)) return true;
    if (!o.space.widerNetworkOn) continue;
    if (o.followedBy?.has(m)) return true;
    const tier = o.tierOf(m);
    if (tier === "strong" || tier === "moderate") return true;
  }
  return false;
}

/** May this notification raise the Activity badge? Senderless items (a ticket, an accepted join) always may. */
export function badgeCountsNotification(space: YourSpace, fromPubkey: string | undefined): boolean {
  if (!fromPubkey) return true;
  return inYourSpace(space, fromPubkey);
}

/** May this chat raise the Chats badge? Off: people you follow or moved to Primary. */
export function badgeCountsChat(space: YourSpace, peer: string, promoted: ReadonlySet<string>): boolean {
  if (space.widerNetworkOn) return true;
  return space.follows.has(peer) || promoted.has(peer);
}

/** Items from outside the space, folded away from the rest. Senderless items stay inside. */
export function splitOutsideYourSpace<T>(items: readonly T[], space: YourSpace, senderOf: (item: T) => string | undefined): { inside: T[]; outside: T[] } {
  const inside: T[] = [];
  const outside: T[] = [];
  for (const item of items) {
    const from = senderOf(item);
    (!from || inYourSpace(space, from) ? inside : outside).push(item);
  }
  return { inside, outside };
}
