/**
 * What shape is this media, and what box do we reserve for it right now?
 *
 * The feed reserves a box BEFORE the media loads, so a late-arriving image can
 * never change a row's height (the layout-shift vector the virtualizer depends
 * on). That is correct. What was wrong is what it reserved when it didn't know:
 * a 16/10 box for images and 16/9 for video, both paired with a fill that
 * cropped or pillarboxed anything portrait. A guess became a crop.
 *
 * Sampling the live feed found real image ratios from 0.462 to 2.215 — there is
 * no single box, so the answer is to LEARN the shape instead of guessing it:
 *
 *   1. `imeta dim` on the event   → exact, free, no work at all
 *   2. otherwise, the element itself reports its natural size on load — and
 *      because media mounts 1500px before it scrolls into view, that lands
 *      about two screens early, off-screen, costing no extra request
 *   3. until then, a neutral box with the media CONTAINED (never cropped)
 *
 * The invariant that makes tier 2 safe is the freeze: a box that is currently
 * on screen never changes size. Without it, a correction can land while someone
 * is reading and shove the post out from under them. With it, the worst case is
 * one slightly letterboxed post until it scrolls past — and the ratio is cached
 * per URL, so it is right the next time and everywhere else it appears.
 */

/** The box for media whose shape we do not know yet. Portrait-leaning because
 *  the observed median of real feed images is ~0.83, not 16/10 (1.6). */
export const NEUTRAL_RATIO = 4 / 5;

/* ── Every tunable number for a media box, in one place ───────────────────────
 *
 * These were inline in JSX and that is exactly how the original bug survived:
 * a 16/10 fallback and a 500px cap, each defensible on its own line, neither
 * visible as a decision. A number with a name and a reason can be argued with;
 * a number buried in a className cannot. Changing the feed's proportions should
 * be one edit here, not a hunt.
 */

/** Video's ceiling. A true 9:16 clip is ~620px at phone feed width, so the old
 *  500px cap silently re-letterboxed the exact case this module exists to fix.
 *  Viewport-relative also means desktop needs no second rule: the same
 *  expression bounds a 714px-wide column without a breakpoint. */
export const VIDEO_MAX_HEIGHT = "85vh";

/** Images stop shorter than video on purpose. A photo is scanned and scrolled
 *  past; a vertical clip is watched. Same ceiling for both would either crush
 *  the video or let a tall screenshot eat the screen. */
export const IMAGE_MAX_HEIGHT = "75vh";

/**
 * Space held for an image whose shape we do not know yet, until it decodes.
 * Deliberately small: it is a placeholder, not a guess at the real height, so
 * the settle reads as a nudge instead of the lurch a full fabricated box gives.
 */
export const UNKNOWN_PLACEHOLDER_HEIGHT = 160;

/** Quoted/embedded contexts, where media is a reference and not the subject. */
export const COMPACT_MAX_HEIGHT = 280;

/** 9:16 is as tall as a real clip gets; past 16:9 it is a banner, not a video.
 *  Images are deliberately NOT clamped — 0.462 and 2.215 both occur in the
 *  wild and both are what the person meant to post. */
export const VIDEO_TALLEST_RATIO = 9 / 16;
export const VIDEO_WIDEST_RATIO = 16 / 9;

/** How early media mounts, and therefore how much head start the shape probe
 *  gets. ~2 screens: enough that the box settles off-screen, which is the
 *  entire reason the freeze below rarely has to hold a wrong guess. */
export const MEDIA_MOUNT_LEAD = "1500px 0px";

/** Keep a video box within the range a real clip occupies. */
export function clampVideoRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return VIDEO_WIDEST_RATIO;
  return Math.min(Math.max(ratio, VIDEO_TALLEST_RATIO), VIDEO_WIDEST_RATIO);
}

/** Learned width/height ratios, keyed by media URL. Memory-only and unbounded
 *  in principle, but bounded in practice by how much media one session sees. */
const learned = new Map<string, number>();

/** width/height, or null for anything that isn't a usable pair of dimensions. */
export function ratioFromSize(width?: number | null, height?: number | null): number | null {
  if (!width || !height) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return width / height;
}

export function rememberRatio(url: string, width?: number | null, height?: number | null): void {
  const ratio = ratioFromSize(width, height);
  if (ratio === null || !url) return;
  learned.set(url, ratio);
}

export function recallRatio(url: string): number | undefined {
  return url ? learned.get(url) : undefined;
}

/** Tests only — the cache is process-lifetime otherwise. */
export function clearRatioMemory(): void {
  learned.clear();
}

/**
 * The box to reserve on this render.
 *
 * Precedence is frozen → imeta → learned → fallback, and the order of the
 * middle two is deliberate: `imeta` is available on the very first paint while
 * `learned` arrives later, so preferring imeta means the box never changes even
 * when a publisher's `dim` disagrees slightly with the real pixels. Stability
 * beats a fractional accuracy gain nobody can see.
 */
export function reservedRatio(input: {
  imetaRatio?: number | null;
  learnedRatio?: number | null;
  frozenRatio?: number | null;
  fallback?: number;
}): number {
  const fallback = input.fallback ?? NEUTRAL_RATIO;
  const candidate = input.frozenRatio ?? input.imetaRatio ?? input.learnedRatio ?? fallback;
  return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}

/**
 * The freeze, as a pure step: capture the ratio when the box becomes visible,
 * hold it for as long as it stays visible, release it when it leaves.
 *
 * Releasing on exit is what lets a wrong guess self-correct — the box takes the
 * learned ratio the moment the reader is no longer looking at it.
 */
export function nextFrozenRatio(
  previous: number | undefined,
  visible: boolean,
  current: number,
): number | undefined {
  if (!visible) return undefined;
  if (previous !== undefined) return previous;
  return current;
}

/**
 * Does the reserved box match the media's true shape?
 *
 * The caller uses this to decide between `cover` (safe only when they match —
 * an exact box makes cover and contain identical) and `contain` plus a fill
 * (honest when they don't). Getting this backwards is the original bug: cover
 * against a guessed box is what centre-cropped people's photos.
 */
export function boxMatchesMedia(reserved: number, trueRatio?: number | null): boolean {
  if (!trueRatio || !Number.isFinite(trueRatio)) return false;
  return Math.abs(reserved - trueRatio) < 0.01;
}
