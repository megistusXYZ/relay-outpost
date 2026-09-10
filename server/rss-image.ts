/**
 * Which image a feed item gets, and how wide it is. Big outlets carry their
 * story photos in media:content / media:thumbnail (The Guardian: 140px and
 * 460px versions; BBC: a 240px thumbnail). Knowing the width lets the News
 * page show a large lead picture only when the image is big enough, and a
 * small thumbnail otherwise. See rss-image.test.ts.
 */

/** rss-parser's shape for a repeated media element: attributes under `$`. */
interface MediaAttrs {
  url?: string;
  width?: string | number;
  medium?: string;
}
interface MediaNode {
  $?: MediaAttrs;
}

export interface FeedItemMedia {
  mediaContents?: MediaNode[];
  mediaThumbnails?: MediaNode[];
  enclosure?: { url?: string; type?: string };
  content?: string;
  "content:encoded"?: string;
}

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

/** An image attached to the item as its enclosure (not audio or video). */
function enclosureImage(enclosure: FeedItemMedia["enclosure"]): string | null {
  const url = enclosure?.url;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  return (enclosure?.type || "").startsWith("image/") || IMAGE_EXTENSION.test(url) ? url : null;
}

/** The first picture in the article's HTML. */
function firstContentImage(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match && /^https?:\/\//i.test(match[1]) ? match[1] : null;
}

export interface PickedImage {
  url: string;
  width?: number;
}

function widthOf(attrs: MediaAttrs): number {
  const w = Number(attrs.width);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

function isImage(attrs: MediaAttrs): attrs is MediaAttrs & { url: string } {
  return typeof attrs.url === "string" && /^https?:\/\//i.test(attrs.url) && (!attrs.medium || attrs.medium === "image");
}

/** The widest image among repeated media elements, or null. */
function widest(nodes: MediaNode[] | undefined): (MediaAttrs & { url: string }) | null {
  const candidates = (nodes ?? []).map((node) => node?.$ ?? {}).filter(isImage);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (widthOf(b) > widthOf(a) ? b : a));
}

export function pickItemImage(item: FeedItemMedia, _options: object = {}): PickedImage | null {
  const best = widest(item.mediaContents) ?? widest(item.mediaThumbnails);
  if (best) {
    const width = widthOf(best);
    return width ? { url: best.url, width } : { url: best.url };
  }
  const attached = enclosureImage(item.enclosure);
  if (attached) return { url: attached };
  const inArticle = firstContentImage(item.content || item["content:encoded"] || "");
  return inArticle ? { url: inArticle } : null;
}
