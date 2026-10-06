import { badgeSvg, type BadgeDesign } from "@/lib/badge-design";

/** The design's picture as a data URL, for the live preview. */
export function badgeDataUrl(d: Pick<BadgeDesign, "shape" | "colour" | "symbol">): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg(d))}`;
}

/**
 * Rasterise the design's drawing to a square PNG — the same drawing the
 * preview shows, so the published picture can't differ from it. NIP-58
 * recommends 1024×1024 for the picture and 256×256 among the thumbnails.
 */
export async function renderBadgePng(d: Pick<BadgeDesign, "shape" | "colour" | "symbol">, size: number): Promise<Blob> {
  const img = new Image();
  img.decoding = "async";
  img.width = size;
  img.height = size;
  img.src = badgeDataUrl(d);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.drawImage(img, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}
