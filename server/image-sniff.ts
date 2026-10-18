/**
 * Which raster format a buffer holds, judged by its first bytes rather than by
 * what the sending server claims. Anything else, SVG included, is null: pictures
 * fetched from other people's servers are only decoded when they are one of
 * these formats.
 */
export type RasterKind = "jpeg" | "png" | "gif" | "webp" | "avif";

export function rasterImageKind(buf: Buffer): RasterKind | null {
  if (buf.length < 12) {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
    if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString("latin1", 0, 6))) return "gif";
    if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return "png";
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return "png";
  if (/^GIF8[79]a$/.test(buf.toString("latin1", 0, 6))) return "gif";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (buf.toString("latin1", 4, 8) === "ftyp" && /^avi[fs]$/.test(buf.toString("latin1", 8, 12))) return "avif";
  return null;
}
