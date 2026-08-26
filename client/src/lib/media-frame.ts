/**
 * Is this post a picture, or a post that happens to contain a picture?
 *
 * The whole media-feed initiative hangs off that one distinction. A photo post
 * should be the photo — edge to edge, the caption underneath, the way Instagram
 * has trained every thumb on earth. An argument with a screenshot in it should
 * stay inset, because there the image is evidence and full-bleeding it would
 * shout over the writing.
 *
 * Nothing consumes this yet. It ships dark ahead of the frame itself so the rule
 * can be argued with, and tested, in one place instead of being discovered later
 * as a condition scattered through JSX.
 *
 * See MEDIA_FEED_PLAN.md, decision 6.
 */
import { extractMediaFromContent } from "./media-utils";

/**
 * Roughly three lines at feed text size on a 393px screen: the length at which
 * text still reads as a CAPTION UNDER A PICTURE rather than as the post itself.
 *
 * Stated plainly: this is a guess dressed as a threshold, and it will be wrong
 * at the margins in both directions. No character count captures intent. It is a
 * named constant precisely so that tuning it against real posts is one edit
 * rather than an archaeology expedition.
 */
export const MEDIA_DOMINANT_PROSE_LIMIT = 220;

/** NIP-68 picture, NIP-71 video, NIP-71 short-form portrait video. */
export const KIND_PICTURE = 20;
export const KIND_VIDEO = 21;
export const KIND_SHORT_VIDEO = 22;

/**
 * NIP-71's ORIGINAL addressable video kinds, and they are not historical.
 *
 * The spec later moved video to the regular kinds 21/22 above, but the
 * addressable pair never went away in practice — divine.video publishes 34236
 * today, and a profile there was measured holding 82 of them and zero kind-1s.
 * Recognising only 21/22 meant an account whose entire contribution is video
 * read as an account with nothing on it: "No videos yet" over 82 videos.
 *
 * Kept as a separate list because they are addressable (author + `d`), so
 * anything that dedupes or addresses events has to treat them differently from
 * 21/22 — merging the two lists would quietly invite that bug.
 */
export const KIND_VIDEO_ADDRESSABLE = 34235;
export const KIND_SHORT_VIDEO_ADDRESSABLE = 34236;
export const ADDRESSABLE_VIDEO_KINDS: readonly number[] = [
  KIND_VIDEO_ADDRESSABLE,
  KIND_SHORT_VIDEO_ADDRESSABLE,
];

/** Kinds whose entire purpose is a picture or a clip. */
export const MEDIA_EVENT_KINDS: readonly number[] = [
  KIND_PICTURE,
  KIND_VIDEO,
  KIND_SHORT_VIDEO,
  ...ADDRESSABLE_VIDEO_KINDS,
];

export function isMediaEventKind(kind: number): boolean {
  return MEDIA_EVENT_KINDS.includes(kind);
}

export type PostFrameKind = "full-bleed" | "inset";

/** The minimum an event needs to expose to be classified. */
export interface FramableEvent {
  kind: number;
  content: string;
  tags: string[][];
}

const NOSTR_URI = /\bnostr:[a-z0-9]+/gi;
const HASHTAG = /(^|\s)#[^\s#]+/g;
const QUOTE_URI = /\bnostr:(nevent1|note1|naddr1)[a-z0-9]+/i;

/**
 * How much PROSE a post really has, as the reader experiences it.
 *
 * A raw `content` length lies in two directions that both matter here:
 *
 *  - `nostr:npub1…` is ~70 characters that render as "@alice". Counting the
 *    raw token would push a photo with one mention over the limit on its own.
 *  - a wall of hashtags is metadata, not writing. Fifteen tags is 200-odd
 *    characters and would flip an obvious photo post to inset.
 *
 * Whitespace is collapsed because stripping a URL leaves the blank lines that
 * surrounded it behind, and blank lines are not prose either.
 */
export function proseLength(text: string): number {
  if (!text) return 0;
  return text
    .replace(NOSTR_URI, "")
    .replace(HASHTAG, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Does this post render a quoted-note card?
 *
 * Both signals are pure: an explicit `q` tag (NIP-18) or a `nostr:` URI in the
 * body pointing at an event rather than a person.
 */
export function hasQuotedNote(event: Pick<FramableEvent, "content" | "tags">): boolean {
  if ((event.tags ?? []).some((t) => t[0] === "q")) return true;
  return QUOTE_URI.test(event.content ?? "");
}

/** Does the body carry a picture or clip we render inline ourselves? */
export function hasInlineMedia(content: string): boolean {
  const { media } = extractMediaFromContent(content ?? "");
  // Deliberately image/video only. A YouTube link is an embed with its own
  // chrome, controls and branding — full-bleeding someone else's player does
  // not make it feel like Instagram, it makes it feel like a bigger iframe.
  return media.some((m) => m.type === "image" || m.type === "video");
}

/**
 * The rule, in the order it was decided.
 *
 * 1. a quoted-note card → inset, whatever else is going on. A full-bleed photo
 *    plus an embedded quote is two focal points and the hierarchy collapses.
 * 2. a dedicated media kind → full-bleed. The author picked kind 20/21/22;
 *    that IS the declaration, and second-guessing it by caption length would
 *    override an explicit choice with a heuristic.
 * 3. no inline picture or clip → inset. Nothing to bleed.
 * 4. otherwise, prose length decides.
 */
export function isMediaDominant(event: FramableEvent): boolean {
  if (hasQuotedNote(event)) return false;
  if (isMediaEventKind(event.kind)) return true;
  const content = event.content ?? "";
  if (!hasInlineMedia(content)) return false;
  const { text } = extractMediaFromContent(content);
  return proseLength(text) <= MEDIA_DOMINANT_PROSE_LIMIT;
}

/** The same answer, named the way a component wants to consume it. */
export function frameFor(event: FramableEvent): PostFrameKind {
  return isMediaDominant(event) ? "full-bleed" : "inset";
}

/**
 * Is this URL a video? The FALLBACK answer, for links that describe nothing.
 *
 * Four copies of this regex existed — Profile, MediaSection,
 * IdentityProfileMain, MyOutpost — and each had drifted slightly (one knew
 * about `.m3u8`, three did not). One classifier means a media type can no
 * longer be recognised on the profile grid and missed by the montage beside it.
 */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(url);
}

/**
 * What the EVENT declared, falling back to the filename.
 *
 * Extension-sniffing is a heuristic and it fails hardest on the accounts that
 * are most video: divine.video serves `https://media.divine.video/<sha256>`
 * with no extension at all, so a profile holding 82 NIP-71 clips filed every
 * one of them as an image and reported "No videos yet".
 *
 * A NIP-71 event says `imeta … m video/mp4` outright. When something has told
 * us what it is, guessing from its name is strictly worse.
 */
export function isVideoMedia(url: string, declared?: { isVideo?: boolean }): boolean {
  return declared?.isVideo ?? isVideoUrl(url);
}
