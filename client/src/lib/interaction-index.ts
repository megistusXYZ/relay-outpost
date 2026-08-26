import type { Event } from "nostr-tools";
import { KIND_REPOST, KIND_REACTION } from "./nostr-helpers";

const KIND_NOTE = 1;

/**
 * A read-model over the local event store's reactions / reposts / replies,
 * built once and updated incrementally instead of every post component scanning
 * the whole store on each insert.
 *
 * For a target event id we track:
 *  - `reactors`: reactorPubkey -> that reactor's reaction event (deduped, latest
 *    wins) so `size` is the distinct-reactor count and we can read the viewer's
 *    own reaction.
 *  - `reposters`: the set of pubkeys who reposted it (viewer membership = "you
 *    reposted").
 *  - `repliedByViewer`: target ids the viewer has replied to (viewer's kind-1
 *    with an `e` tag to the target). Only the viewer's replies are indexed —
 *    this mirrors the old author-scoped `#e` lookup, not a global reply count.
 */
export interface InteractionIndex {
  reactors: Map<string, Map<string, Event>>;
  reposters: Map<string, Set<string>>;
  repliedByViewer: Set<string>;
}

/** Every `e`-tag id an event references (deduped). Reactions/reposts/replies are
 *  matched by any `e` tag, to mirror the old `getByFilters({ "#e": [id] })`. */
export function eTagTargets(event: Event): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const t of event.tags) {
    if (t[0] === "e" && t[1] && !seen.has(t[1])) {
      seen.add(t[1]);
      ids.push(t[1]);
    }
  }
  return ids;
}

export function createInteractionIndex(): InteractionIndex {
  return { reactors: new Map(), reposters: new Map(), repliedByViewer: new Set() };
}

/**
 * Fold one event into the index. Returns the target ids whose derived state may
 * have changed (so a provider can notify just those subscribers), or an empty
 * array if the event is irrelevant.
 */
export function addToIndex(
  index: InteractionIndex,
  event: Event,
  viewerPubkey: string | null | undefined,
): string[] {
  if (event.kind === KIND_REACTION) {
    const targets = eTagTargets(event);
    for (const id of targets) {
      let m = index.reactors.get(id);
      if (!m) { m = new Map(); index.reactors.set(id, m); }
      const existing = m.get(event.pubkey);
      // Keep the reactor's latest reaction so emoji/content reflect their most
      // recent tap; dedupe means the count is distinct reactors.
      if (!existing || event.created_at >= existing.created_at) m.set(event.pubkey, event);
    }
    return targets;
  }
  if (event.kind === KIND_REPOST) {
    const targets = eTagTargets(event);
    for (const id of targets) {
      let s = index.reposters.get(id);
      if (!s) { s = new Set(); index.reposters.set(id, s); }
      s.add(event.pubkey);
    }
    return targets;
  }
  if (event.kind === KIND_NOTE && viewerPubkey && event.pubkey === viewerPubkey) {
    const targets = eTagTargets(event);
    for (const id of targets) index.repliedByViewer.add(id);
    return targets;
  }
  return [];
}

/** Build the index from a batch of events (initial seed; also used in tests). */
export function buildInteractionIndex(
  events: Iterable<Event>,
  viewerPubkey: string | null | undefined,
): InteractionIndex {
  const index = createInteractionIndex();
  for (const e of events) addToIndex(index, e, viewerPubkey);
  return index;
}

export interface DerivedInteraction {
  reactionCount: number;
  hasLiked: boolean;
  myReactionContent: string | null;
  myReactionEmojiUrl: string | undefined;
  hasReposted: boolean;
  hasReplied: boolean;
}

/** Read the derived state for one target — the exact shape the post UI needs. */
export function deriveInteraction(
  index: InteractionIndex,
  targetId: string,
  viewerPubkey: string | null | undefined,
): DerivedInteraction {
  const reactorMap = index.reactors.get(targetId);
  const myReaction = viewerPubkey ? reactorMap?.get(viewerPubkey) : undefined;
  const emojiTag = myReaction?.tags.find((t) => t[0] === "emoji" && t[2]);
  return {
    reactionCount: reactorMap?.size ?? 0,
    hasLiked: !!myReaction,
    myReactionContent: myReaction?.content ?? null,
    myReactionEmojiUrl: emojiTag?.[2],
    hasReposted: viewerPubkey ? (index.reposters.get(targetId)?.has(viewerPubkey) ?? false) : false,
    hasReplied: index.repliedByViewer.has(targetId),
  };
}
