/**
 * What the pinned bar and list say when a pinned message has no words to
 * show: a photo, a GIF, a video. The preview drops media links, so without
 * this a media-only pin read "Handled:" and nothing else. Pure.
 */
import { mediaFromTags, type ConcordMedia } from "./concord-media";

/** A pinned message as the Pinned list shows it: its words and its media. */
export interface PinnedCard {
  text: string;
  media: ConcordMedia[];
  /** This device holds an edit newer than the pin's proof. */
  edited: boolean;
  /** The room's timeline holds it, so the list can jump to it. */
  inRoom: boolean;
}

/**
 * The message a pin points at. The room's copy wins when this device holds it
 * (an edit, its media); otherwise the pin's own proof, the author's rumor with
 * its tags, so a GIF or photo shows as itself rather than as nothing.
 */
export function pinnedCard(
  rumor: { content: string; tags: string[][] },
  held?: { content: string; media?: ConcordMedia[]; edited?: boolean },
): PinnedCard {
  const proofMedia = () => mediaFromTags(rumor.tags);
  if (!held) return { text: rumor.content, media: proofMedia(), edited: false, inRoom: false };
  return {
    text: held.content || rumor.content,
    media: held.media?.length ? held.media : proofMedia(),
    edited: !!held.edited,
    inRoom: true,
  };
}

export function pinMediaLabel(rumor: { content: string; tags: string[][] }): string {
  const media = mediaFromTags(rumor.tags);
  if (media.some((m) => m.mime === "image/gif")) return "GIF";
  if (media.some((m) => m.mime.startsWith("image/"))) return "Photo";
  if (media.some((m) => m.mime.startsWith("video/"))) return "Video";
  if (media.length > 0) return "Attachment";
  // A GIF pasted as a link: the message's only words are the link.
  if (/^\s*https?:\/\/\S+(\.gif(\?\S*)?|tenor\.com\/\S*|giphy\.com\/\S*)\s*$/i.test(rumor.content)) return "GIF";
  return "";
}
