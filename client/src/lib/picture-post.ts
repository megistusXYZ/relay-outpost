/**
 * NIP-68 picture-first posts (kind 20) — the opt-in publish path.
 *
 * MEDIA_FEED_PLAN decision 9 said "read kinds 20/21/22, keep publishing kind 1",
 * because a kind-20 photo is invisible to clients without NIP-68. That reasoning
 * still holds as the DEFAULT — which is why everything here is gated twice:
 * the post must be picture-dominant (all attachments are pictures, caption-length
 * prose) AND the author must flip the "post as picture" toggle. Nobody's photo
 * goes invisible by accident; people who live in Olas/Amethyst get to speak
 * those clients' native kind.
 *
 * Pure functions only — the composer owns state, signing and publishing.
 * The relay target is the composer's existing `publishTargets` (curated picker
 * selection + NIP-65 outbox floor); kind 20 must never grow its own relay rules.
 */
import { KIND_PICTURE, MEDIA_DOMINANT_PROSE_LIMIT, proseLength } from "./media-frame";
import { buildImetaTag } from "./blossom-media";

/**
 * The media types NIP-68 accepts — kind 20 is pictures only (video is NIP-71),
 * and the spec enumerates exactly these six.
 */
export const PICTURE_POST_MIMES: readonly string[] = [
  "image/apng",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** What the composer's media attachments must expose to qualify. */
export interface PicturePostAttachment {
  url: string;
  type: "image" | "video";
  mime?: string;
  sha256?: string;
  /** Pixel dimensions as `WxH` (NIP-94 `dim`). */
  dim?: string;
  /** Mirror URL recorded by the background BUD-04 auto-mirror. */
  fallbackUrl?: string;
}

/**
 * Can THIS attachment ride in a kind-20 event? Stricter than "is an image":
 * NIP-68 requires `url` + `m` per picture, and we additionally insist on the
 * sha256 fingerprint (same bar as buildImetaTag) so every picture we publish
 * as picture-first is content-addressed and healable. Attachments that fail
 * this (old drafts, exotic mime types) still post fine as kind 1.
 */
export function isPictureAttachment(a: PicturePostAttachment): boolean {
  return (
    a.type === "image" &&
    !!a.url &&
    !!a.sha256 &&
    !!a.mime &&
    PICTURE_POST_MIMES.includes(a.mime.toLowerCase())
  );
}

/**
 * Is the composer's current state eligible for the picture-post toggle?
 *
 * The rule mirrors `isMediaDominant` from the read side: the post has to BE
 * the picture. Audio, polls and picker GIFs (external URLs with no
 * fingerprint) are different objects; a caption longer than the
 * media-dominance limit means the writing is the post, and that belongs in
 * kind 1 where every client can read it.
 */
export function canPostAsPicture(args: {
  attachments: PicturePostAttachment[];
  hasAudio: boolean;
  hasGif: boolean;
  isPoll: boolean;
  caption: string;
}): boolean {
  if (args.isPoll || args.hasAudio || args.hasGif) return false;
  if (args.attachments.length === 0) return false;
  if (!args.attachments.every(isPictureAttachment)) return false;
  return proseLength(args.caption) <= MEDIA_DOMINANT_PROSE_LIMIT;
}

export interface PictureEventTemplate {
  kind: typeof KIND_PICTURE;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * Assemble the kind-20 template per NIP-68:
 *
 * - `content` is the DESCRIPTION only. Media URLs are NOT appended (that is
 *   kind-1's shape) — NIP-68 clients render from imeta, and a URL in the
 *   description would double-render the picture in every one of them.
 * - optional `title` tag when the author gave one.
 * - one `imeta` per picture: url / m / dim / x / fallback, straight from the
 *   Blossom upload pipeline.
 * - top-level `m` (per distinct type) and `x` (per picture) filter tags, as
 *   the spec shows, so relays can query pictures by type and hash.
 *
 * Returns null when any attachment fails the picture bar — the caller should
 * have gated on canPostAsPicture, so null means "publish as kind 1 instead",
 * never "publish a half-formed kind 20".
 */
export function buildPictureEvent(args: {
  /** Mention-resolved caption; becomes `content` verbatim (trimmed). */
  caption: string;
  title?: string;
  attachments: PicturePostAttachment[];
  /** Composer extras: mention `p`s, emoji, hashtag `t`s, client tag, NIP-70 `-`. */
  extraTags?: string[][];
  createdAt: number;
}): PictureEventTemplate | null {
  if (args.attachments.length === 0) return null;

  const tags: string[][] = [];
  const title = args.title?.trim();
  if (title) tags.push(["title", title]);

  const mimes: string[] = [];
  const hashes: string[] = [];
  for (const a of args.attachments) {
    if (!isPictureAttachment(a)) return null;
    const imeta = buildImetaTag({
      url: a.url,
      mime: a.mime,
      sha256: a.sha256,
      dim: a.dim,
      fallbacks: a.fallbackUrl ? [a.fallbackUrl] : undefined,
    });
    if (!imeta) return null;
    tags.push(imeta);
    const mime = a.mime!.toLowerCase();
    if (!mimes.includes(mime)) mimes.push(mime);
    const hash = a.sha256!.toLowerCase();
    if (!hashes.includes(hash)) hashes.push(hash);
  }

  for (const m of mimes) tags.push(["m", m]);
  for (const x of hashes) tags.push(["x", x]);
  for (const t of args.extraTags ?? []) tags.push(t);

  return {
    kind: KIND_PICTURE,
    created_at: args.createdAt,
    tags,
    content: args.caption.trim(),
  };
}
