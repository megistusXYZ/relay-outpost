/**
 * Who belongs in Following: people you follow, you, and posts a person you
 * follow reposted. One rule, applied to every list Following shows — the fresh
 * one AND the one held on screen while you're scrolled down.
 *
 * An empty follow list means "not known yet" as often as "follows no one" (the
 * list loads after the app opens), so it lets nothing through. Treating it as
 * "no filter" put strangers' posts into Following on a cold start, and the
 * held list kept them there after your follows arrived.
 */
export interface FollowingGate {
  follows: ReadonlySet<string>;
  me: string | null | undefined;
  /** Who reposted this post into the feed, when it came in as a repost. */
  reposterOf: (id: string) => string | undefined;
}

export function inFollowing(e: { id: string; pubkey: string }, gate: FollowingGate): boolean {
  if (gate.follows.size === 0) return false;
  if (gate.follows.has(e.pubkey) || (!!gate.me && e.pubkey === gate.me)) return true;
  const by = gate.reposterOf(e.id);
  return !!by && (gate.follows.has(by) || by === gate.me);
}
