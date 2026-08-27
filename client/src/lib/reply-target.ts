/**
 * Reply-target resolution across both reply generations.
 *
 * NIP-10 (kind 1): lowercase e-tags, "reply"/"root" markers in slot 3, plus
 * the marker-less legacy orderings every old client left behind.
 *
 * NIP-22 (kind 1111): lowercase e = PARENT, uppercase E = thread ROOT, and
 * slot 3 is a PUBKEY, not a marker — NIP-10 logic must never read it.
 *
 * Why this exists (2026-08-27): Amethyst switched its kind-1 replies to
 * NIP-22 comments. Thread fetching/splicing gated on kind 1 and NIP-10 tag
 * shapes, so those replies were invisible here. This is the one place that
 * knows both shapes; fetchers and tree-builders consume it.
 */
import type { Event } from "nostr-tools";

export const KIND_NIP22_COMMENT = 1111;

/** What a thread fetch asks relays for: both reply generations. */
export const THREAD_REPLY_KINDS: readonly number[] = [1, KIND_NIP22_COMMENT];

type TagEvent = Pick<Event, "kind" | "tags">;

/** The event this reply directly answers, or null when it isn't a reply. */
export function replyTargetOf(event: TagEvent): string | null {
  if (event.kind === KIND_NIP22_COMMENT) {
    const eTags = event.tags.filter((t) => t[0] === "e" && t[1]);
    return eTags.length > 0 ? eTags[eTags.length - 1][1] : null;
  }
  const eTags = event.tags.filter((t) => t[0] === "e" && t[1]);
  if (eTags.length === 0) return null;
  const replyTag = eTags.find((t) => t[3] === "reply");
  if (replyTag) return replyTag[1];
  const rootTag = eTags.find((t) => t[3] === "root");
  if (rootTag) {
    const nonRoot = eTags.filter((t) => t[3] !== "root");
    if (nonRoot.length > 0) return nonRoot[nonRoot.length - 1][1];
    return rootTag[1];
  }
  if (eTags.length === 1) return eTags[0][1];
  return eTags[eTags.length - 1][1];
}

/** The thread's root event, or null when the event doesn't name one. */
export function threadRootOf(event: TagEvent): string | null {
  if (event.kind === KIND_NIP22_COMMENT) {
    const rootTag = event.tags.find((t) => t[0] === "E" && t[1]);
    return rootTag ? rootTag[1] : null;
  }
  const eTags = event.tags.filter((t) => t[0] === "e" && t[1]);
  if (eTags.length === 0) return null;
  const rootTag = eTags.find((t) => t[3] === "root");
  if (rootTag) return rootTag[1];
  return eTags[0][1];
}
