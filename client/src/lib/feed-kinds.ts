import { KIND_TEXT_NOTE } from "./nostr-helpers";
import { KIND_POLL } from "./polls";
import { KIND_PICTURE, KIND_VIDEO, KIND_SHORT_VIDEO, ADDRESSABLE_VIDEO_KINDS } from "./media-frame";

/**
 * What the timeline asks relays for.
 *
 * This existed as the literal `[KIND_TEXT_NOTE, KIND_POLL]` written out at
 * seven separate call sites in Home.tsx — which is the shape of bug this
 * codebase keeps producing: a list duplicated until the copies disagree.
 * Adding a kind meant finding all seven, and missing one meant a kind that
 * loads on first paint but not on load-more, or vice versa.
 *
 * The three media kinds are NEW here. Probing relay.damus.io, nos.lol and
 * relay.primal.net for the last 300 events of kinds 20/21/22 returned 240/27/33,
 * 191/55/54 and 80/7/30 respectively — hundreds of picture and video events per
 * relay that our feed has never asked for and therefore never shown. Kind 22 is
 * NIP-71 short-form portrait video: the shorts kind, and the entire reason the
 * media feed exists.
 *
 * On the publish side, kind 1 with `imeta` stays the DEFAULT — a photo posted
 * as kind 20 is invisible to every client without NIP-68, which is most of
 * them. Kind 20 is published only through the composer's explicit "post as
 * picture" opt-in (lib/picture-post.ts) — see MEDIA_FEED_PLAN.md decision 9,
 * as amended. Kinds 21/22 are still never published.
 */
export const FEED_KINDS: readonly number[] = [
  KIND_TEXT_NOTE,
  KIND_POLL,
  KIND_PICTURE,
  KIND_VIDEO,
  KIND_SHORT_VIDEO,
];

/** Mutable copy — nostr-tools filters take `number[]`, not a readonly array. */
export function feedKinds(): number[] {
  return [...FEED_KINDS];
}

/**
 * What a person's profile shows as *their posts*.
 *
 * This was `[KIND_TEXT_NOTE]` written out at five places in Profile.tsx, which
 * meant a picture-first account looked EMPTY in this app — their entire photo
 * output invisible on their own page, with no hint anything was missing. That
 * is a worse failure than the feed one: a feed omission looks like quiet
 * relays, but a blank profile looks like the person doesn't post.
 *
 * No polls here: this list is "posts by this author", and the profile's poll
 * surface is separate.
 */
export const PROFILE_POST_KINDS: number[] = [
  KIND_TEXT_NOTE,
  KIND_PICTURE,
  KIND_VIDEO,
  KIND_SHORT_VIDEO,
  // NIP-71's addressable video kinds. Without these a video-first account —
  // divine.video publishes 34236 — has an empty profile: 82 videos, and the
  // timeline filter never asked for a single one of them.
  ...ADDRESSABLE_VIDEO_KINDS,
];

/**
 * How many slots of a page belong to media.
 *
 * NIP-01 `limit` is answered with the newest N events across every kind a
 * filter names, and kind 1 outnumbers kinds 20/21/22 by orders of magnitude —
 * so media in a shared filter wins no slots at all. Measured against a live
 * relay, kinds [1,6,20,21,22,1068] with limit 120 in ONE filter:
 *
 *   117 text, 3 reposts, ZERO media
 *
 * The fix is not a second filter on the same subscription: the pool merges an
 * array of filters back into one, which is exactly how the first attempt at
 * this failed silently. Media needs its OWN subscription, and this is the
 * budget it gets — a third of the page, enough that pictures appear without
 * the feed ceasing to be a feed.
 */
export const MEDIA_LIMIT_SHARE = 1 / 3;

export function mediaPageLimit(pageLimit: number): number {
  if (!Number.isFinite(pageLimit) || pageLimit <= 0) return 1;
  return Math.max(1, Math.round(pageLimit * MEDIA_LIMIT_SHARE));
}
