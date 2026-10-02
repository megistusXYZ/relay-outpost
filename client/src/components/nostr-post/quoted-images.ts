/**
 * The pictures a quoted post shows: the image links in its text, each ONCE,
 * four at most.
 *
 * A note that pastes the same link twice used to show the picture twice — and
 * the two tiles shared a React key (the URL), which React warns can make a
 * child render twice or not at all (seen in the feed, 2026-10-02).
 */
const IMAGE_URL = /https?:\/\/\S+\.(jpeg|jpg|gif|png|webp)(\?[^\s]*)?/gi;

export function quotedImageUrls(content: string, max = 4): string[] {
  return Array.from(new Set(content.match(IMAGE_URL) || [])).slice(0, max);
}
