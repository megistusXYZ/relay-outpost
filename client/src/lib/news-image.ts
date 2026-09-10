/**
 * Whether a story's image is worth showing, and at what size. The calm News
 * column shows a picture only when it's good: never an outlet logo, avatar or
 * tracking pixel posing as the story's photo. A story without a usable image
 * is a text row. See news-image.test.ts.
 */

export type ImageFit = { fit: "lead" | "thumb"; verified: boolean };

export interface ImageHints {
  /** The image's width in px, when the feed states it (media:content / media:thumbnail). */
  width?: number;
  /** The feed's own artwork: on an article it's the outlet's logo, not a photo. */
  feedImage?: string;
}

/** Wide enough to fill the lead story's picture without looking blown up. */
const LEAD_MIN_WIDTH = 640;
/** Below this an image is an icon, not a picture worth showing. */
const THUMB_MIN_WIDTH = 120;

/** URLs that are never a story's photo: tracking pixels, emoji, avatars. */
const NOT_A_PHOTO: RegExp[] = [
  /feedburner\.com\/~(r|ff)\//i,
  /(^|[/_.-])(pixel|spacer|blank|1x1)([_.-]|$)/i,
  /\/\/s\.w\.org\/images\/core\/emoji\//i,
  /gravatar\.com\/avatar\//i,
];

/**
 * A width stated in the image address itself: `?width=` / `?w=` (image CDNs,
 * The Guardian), WordPress's `-150x150.jpg` resized copies, and BBC's
 * `/ace/standard/240/` path.
 */
function widthFromUrl(u: string): number | undefined {
  try {
    const url = new URL(u);
    const param = url.searchParams.get("width") ?? url.searchParams.get("w");
    if (param && /^\d+$/.test(param)) return Number(param);
    const wordpress = url.pathname.match(/-(\d{2,4})x\d{2,4}\.(?:jpe?g|png|webp|gif)$/i);
    if (wordpress) return Number(wordpress[1]);
    const bbc = url.pathname.match(/\/ace\/(?:standard|ws)\/(\d{2,4})\//i);
    if (bbc) return Number(bbc[1]);
  } catch {}
  return undefined;
}

export function imageFit(url: string, hints: ImageHints): ImageFit | null {
  const u = (url || "").trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  if (NOT_A_PHOTO.some((re) => re.test(u))) return null;
  if (hints.feedImage && u === hints.feedImage) return null;
  const width = hints.width ?? widthFromUrl(u);
  if (width && width > 0) {
    if (width >= LEAD_MIN_WIDTH) return { fit: "lead", verified: true };
    if (width >= THUMB_MIN_WIDTH) return { fit: "thumb", verified: true };
    return null;
  }
  // Size unknown: a lead candidate, checked against the real image once it loads.
  return { fit: "lead", verified: false };
}
