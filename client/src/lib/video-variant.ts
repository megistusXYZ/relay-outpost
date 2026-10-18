/**
 * One player per clip. A NIP-71 video post can list the same clip at several
 * sizes, one imeta tag each; the feed plays the smallest that is still sharp at
 * the width it is drawn (a phone screen never needs the 1080p file).
 */
export interface VideoVariant {
  url: string;
  dimensions?: { width: number; height: number };
}

/** Pixels needed across: drawn width × density, density capped at 2 (a third
 *  density step costs a lot of data for little visible gain in a feed). */
export function videoTargetWidth(cssWidth: number, devicePixelRatio: number): number {
  return Math.ceil(cssWidth * Math.min(Math.max(devicePixelRatio || 1, 1), 2));
}

export function pickVideoVariant<T extends VideoVariant>(variants: T[], targetWidth: number): T | undefined {
  const sized = variants.filter((v) => v.dimensions && v.dimensions.width > 0);
  if (sized.length === 0) return variants[0];
  const byWidth = [...sized].sort((a, b) => a.dimensions!.width - b.dimensions!.width);
  return byWidth.find((v) => v.dimensions!.width >= targetWidth) ?? byWidth[byWidth.length - 1];
}
