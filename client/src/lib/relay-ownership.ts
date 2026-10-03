/**
 * "Is this your relay?" — decided from what the relay itself says, never
 * guessed (owner, 2026-10-03: the operator has the last word, so the relay
 * is the authority on who manages it).
 *
 * Two kinds of evidence, either enough on its own:
 *   - its public info (NIP-11) names your key as owner or moderator;
 *   - it accepts your signed management request and lists management
 *     methods for you (lib/relay-capabilities.ts).
 *
 * Pure: the page does the asking.
 */
import type { Nip11Document } from "./nip11";
import { canDo, canManage, type RelayCapabilities } from "./relay-capabilities";

export type Ownership =
  /** You run it (or moderate it). */
  | { kind: "runs-it"; via: "named" | "relay-confirmed" }
  /** It answered, and the answer is someone else. */
  | { kind: "not-yours" }
  /** It names nobody and doesn't answer management — nothing to go on. */
  | { kind: "cannot-tell" }
  /** We never got an answer. Not a verdict about who runs it. */
  | { kind: "unreachable" };

const sameKey = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

export function decideOwnership(input: {
  pubkey: string;
  /** Its NIP-11 document, or null when it couldn't be fetched. */
  nip11: Nip11Document | null;
  caps: RelayCapabilities;
  /** The management request got an answer of any kind (not a dead socket). */
  managementReached: boolean;
}): Ownership {
  const { pubkey, nip11, caps, managementReached } = input;
  // Named first: when both are true, "it lists you as its operator" is the
  // plainer thing to tell someone.
  if (nip11 && (sameKey(nip11.pubkey, pubkey) || (nip11.moderators ?? []).some((m) => sameKey(m, pubkey)))) {
    return { kind: "runs-it", via: "named" };
  }
  if (canManage(caps)) return { kind: "runs-it", via: "relay-confirmed" };
  if (!nip11 && !managementReached) return { kind: "unreachable" };
  // A list without management methods is the relay saying "not you".
  if (caps.listed) return { kind: "not-yours" };
  if (nip11?.pubkey) return { kind: "not-yours" };
  if (!nip11) return { kind: "unreachable" };
  return { kind: "cannot-tell" };
}

export interface ManagementSummary {
  /** What you can do from here, in plain words. */
  can: string[];
  /** What the relay has but doesn't let apps change — done at the host. */
  elsewhere: string[];
  /** When the relay didn't list anything: what that means. */
  note?: string;
}

export function describeManagement(caps: RelayCapabilities, opts: { speaks86: boolean }): ManagementSummary {
  if (!caps.listed) {
    return {
      can: [],
      elsewhere: [],
      note: opts.speaks86
        ? "This relay didn't say which controls it supports, so we'll offer the usual ones and tell you if it turns one down."
        : "This relay can't be managed from apps. You can still see everything on it, handle reports and publish to it here; its settings are changed on its server.",
    };
  }
  const can: string[] = [];
  const elsewhere: string[] = [];
  const ban = canDo(caps, "ban"), allow = canDo(caps, "allow");
  if (ban && allow) can.push("Ban people and choose who may post");
  else if (ban) can.push("Ban people");
  else if (allow) can.push("Choose who may post");
  if (ban) {
    if (canDo(caps, "unban")) can.push("Lift bans");
    else elsewhere.push("Lifting bans");
  }
  if (canDo(caps, "removeEvent")) can.push("Remove posts");
  const look = [
    canDo(caps, "name") && "name",
    canDo(caps, "description") && "description",
    canDo(caps, "icon") && "picture",
  ].filter(Boolean) as string[];
  if (look.length) can.push(`Change its ${look.length === 1 ? look[0] : `${look.slice(0, -1).join(", ")} and ${look[look.length - 1]}`}`);
  if (canDo(caps, "allowKind") || canDo(caps, "disallowKind")) can.push("Choose which kinds of posts it accepts");
  if (canDo(caps, "banner")) can.push("Change its banner"); else elsewhere.push("Its banner");
  if (canDo(caps, "moderators")) can.push("Choose its moderators"); else elsewhere.push("Its moderators");
  return { can, elsewhere };
}
