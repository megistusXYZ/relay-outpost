/**
 * The outpost hero's pulse — the community translation of the profile's
 * Presence card, under the same honesty contract (three-outcomes rule,
 * RELAY_REACHABILITY.md): a number renders only when somebody measured it.
 * `undefined` means "we never got to ask" and the hero dashes or omits;
 * a measured zero is a real zero and prints.
 */
export interface OutpostPresenceInput {
  /** True once the member set actually loaded (not merely initialized empty). */
  membersMeasured: boolean;
  membersCount: number;
  /** Posts visible in the loaded feed — measured by construction. */
  postsCount: number;
  /** Newest activity in ms from fetchCommunityActivity; undefined = unreached/refused. */
  lastActivityMs: number | undefined;
}

export interface OutpostPresenceProps {
  members?: number;
  posts?: number;
  /** Unix seconds, matching IdentityPresence's clock. */
  lastActiveAt?: number;
}

export function outpostPresenceProps(input: OutpostPresenceInput): OutpostPresenceProps {
  return {
    members: input.membersMeasured ? input.membersCount : undefined,
    posts: input.postsCount,
    lastActiveAt: input.lastActivityMs !== undefined ? Math.floor(input.lastActivityMs / 1000) : undefined,
  };
}
