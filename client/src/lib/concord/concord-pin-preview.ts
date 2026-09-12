/**
 * What the pinned bar and list say when a pinned message has no words to
 * show: a photo, a GIF, a video. The preview drops media links, so without
 * this a media-only pin read "Handled:" and nothing else. Pure.
 */
import { mediaFromTags } from "./concord-media";

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
