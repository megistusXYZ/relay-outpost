/**
 * Kind-aware commenting for media surfaces — the dispatch between the two
 * comment vocabularies the images feed now spans.
 *
 * kind-1 roots (notes with images) take kind-1 replies with NIP-10 e-tags —
 * the vocabulary every text client reads. NIP-68 kind-20 picture posts take
 * NIP-22 kind-1111 comments — the vocabulary Olas and Amethyst publish AND
 * read. Posting kind-1 replies at a kind-20 root would publish comments the
 * picture author's own client never surfaces (see media-thread.test.ts).
 *
 * The lowercase triple on top-level comments is deliberate: NIP-22 defines a
 * comment's lowercase e/k/p as its PARENT, and a top-level comment's parent
 * is the root itself. `buildNip22CommentTags` (shared with issue feedback)
 * omits lowercase tags when parent === root, so this module completes the
 * set rather than forking the builder its other caller depends on.
 */
import type { Event, Filter } from "nostr-tools";
import {
  KIND_TEXT_NOTE,
  KIND_COMMENT,
  buildReplyTags,
  buildNip22CommentTags,
} from "./nostr-helpers";

/** The kind a new comment on `target` must be published as. */
export function commentKindFor(target: Event): number {
  return target.kind === KIND_TEXT_NOTE ? KIND_TEXT_NOTE : KIND_COMMENT;
}

/** Tags for a new TOP-LEVEL comment on `target`, in that kind's vocabulary. */
export function buildMediaCommentTags(target: Event, relayHint?: string): string[][] {
  if (target.kind === KIND_TEXT_NOTE) return buildReplyTags(target, relayHint);
  const hint = relayHint || "";
  const tags = buildNip22CommentTags(target, null, hint);
  tags.push(["e", target.id, hint], ["k", String(target.kind)]);
  if (!tags.some((t) => t[0] === "p" && t[1] === target.pubkey)) {
    tags.push(["p", target.pubkey]);
  }
  return tags;
}

/**
 * Relay filters that find the existing comments under `target`. For non-kind-1
 * roots this is TWO filters on purpose: the NIP-22 set (#E) plus a legacy #e
 * sweep, because clients that predate NIP-22 still reply to pictures in
 * kind-1 — dropping either half silently undercounts the thread.
 */
export function commentFiltersFor(target: Event, limit = 200): Filter[] {
  if (target.kind === KIND_TEXT_NOTE) {
    return [{ kinds: [KIND_TEXT_NOTE], "#e": [target.id], limit }];
  }
  return [
    { kinds: [KIND_COMMENT], "#E": [target.id], limit },
    { kinds: [KIND_TEXT_NOTE, KIND_COMMENT], "#e": [target.id], limit },
  ];
}

/**
 * Is `candidate` a comment somewhere under root `rootId`? Used to admit live
 * inserts into an open comment section. Kind-gated: reactions, reposts, and
 * zap receipts all carry e-tags at the same id and are not comments.
 */
export function isCommentOn(candidate: Event, rootId: string): boolean {
  if (candidate.kind === KIND_TEXT_NOTE) {
    return candidate.tags.some((t) => t[0] === "e" && t[1] === rootId);
  }
  if (candidate.kind === KIND_COMMENT) {
    return candidate.tags.some((t) => (t[0] === "E" || t[0] === "e") && t[1] === rootId);
  }
  return false;
}
