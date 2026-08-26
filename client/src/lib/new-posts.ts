/**
 * Pure logic for the X-style "new posts" pill (NewPostsPill / Home feed).
 *
 * Three concerns, extracted so they're unit-testable and can't drift:
 *  1. Label formatting — a real count up to NEW_POSTS_DISPLAY_CAP, then "99+"
 *     (the mainstream pattern; the underlying buffer is NOT capped, only the
 *     displayed number is).
 *  2. Mode gating — the pill (and its buffer bookkeeping) must exist only on
 *     feed modes that genuinely receive live inserts. Static / fetch-once
 *     surfaces (Trending archives, the Saved macro media feeds, empty states)
 *     must never grow a count.
 *  3. Reveal ordering — on ranked feeds (Discover "mix", engagement sorts) a
 *     just-arrived post has no engagement yet and ranks BELOW the fold, so a
 *     plain cutoff-bump merge changes nothing above the viewport and the tap
 *     reads as dead. The revealed posts are therefore pinned, newest-first,
 *     ahead of the ranked remainder — one tap, posts visibly appear.
 */

/** Display cap for the pill count — "99+" beyond this. The buffer itself is uncapped. */
export const NEW_POSTS_DISPLAY_CAP = 99;

export function formatNewPostsLabel(count: number): string {
  if (count === 1) return "1 new post";
  const shown = count > NEW_POSTS_DISPLAY_CAP ? `${NEW_POSTS_DISPLAY_CAP}+` : String(count);
  return `${shown} new posts`;
}

/**
 * Does this Home feed mode actually receive live inserts?
 *
 * Live (the always-on firehose subscription — subscribeToFeedPersistent in
 * lib/nostr — streams into eventStore, and the mode's filter pipeline passes
 * matching events through to the visible feed):
 *  - "raw_signal"  (For You / global)
 *  - "open_comms"  (Following — firehose filtered to follows)
 *  - "custom_<id>" (saved feeds — firehose filtered to the feed's authors/tags)
 *
 * Static / not this pipeline (the pill must never show):
 *  - "deep_scan"    Trending/archives — fetch-once charts, no live inserts.
 *  - "custom_all"   Saved macro media feeds — Home renders the embedded
 *                   Images/Video/Polls feed components, which own their
 *                   content AND their own new-content affordance; Home's
 *                   kind-1 pipeline still runs but is invisible, so its
 *                   counts are phantom.
 *  - "custom_empty" No feed rendered at all.
 *  - anything else  Fail closed.
 */
export function isLiveFeedMode(feedMode: string): boolean {
  if (feedMode === "raw_signal" || feedMode === "open_comms") return true;
  if (feedMode.startsWith("custom_")) {
    return feedMode !== "custom_all" && feedMode !== "custom_empty";
  }
  return false;
}

/**
 * Order the just-revealed (previously buffered) posts first — newest-first
 * among themselves — ahead of the rest of the feed in its existing order.
 * No-ops (returns the input array identity) when nothing matches, so memo
 * consumers don't churn.
 */
export function orderRevealedFirst<T extends { id: string; created_at: number }>(
  events: T[],
  revealedIds: ReadonlySet<string>
): T[] {
  if (revealedIds.size === 0) return events;
  const revealed: T[] = [];
  const rest: T[] = [];
  for (const e of events) {
    if (revealedIds.has(e.id)) revealed.push(e);
    else rest.push(e);
  }
  if (revealed.length === 0) return events;
  revealed.sort((a, b) => b.created_at - a.created_at);
  return revealed.concat(rest);
}
