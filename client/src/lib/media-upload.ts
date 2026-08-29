import { pool, eventStore, publishEvent, DEFAULT_RELAYS } from "./nostr";
import { signWithTimeout } from "@/lib/signer-timeout";
import { createBlossomAuthHeader, mirrorBlob, pickMirrorTarget, type MirrorResult } from "@/lib/blossom-media";

const NOSTR_BUILD_API = "https://nostr.build/api/v2/upload/files";
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/avif", "image/bmp"];
const ALLOWED_MEDIA_TYPES = ["image/", "video/", "audio/"];
const STRIPPABLE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/bmp"];
const STRIPPABLE_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/wave", "audio/x-wav", "audio/flac", "audio/x-flac"];

const KIND_BLOSSOM_SERVER_LIST = 10063;
const BLOSSOM_STORAGE_KEY = "relay-outpost-blossom-servers";

// Recommended media hosts. Single source of truth — used by Settings'
// "Use recommended" button and seeded automatically for new accounts.
export const DEFAULT_BLOSSOM_SERVERS = [
  "https://blossom.primal.net",
  "https://nostr.build",
];

export interface UploadResult {
  url: string;
  mime?: string;
  metadataStripped?: boolean;
  /** sha256 of the uploaded bytes — the Blossom content fingerprint (NIP-92 `x`). */
  sha256?: string;
  /** Pixel dimensions as `WxH` (NIP-94 `dim`) — images only, best-effort. */
  dim?: string;
  size?: number;
  /**
   * Present when a background auto-mirror to a second Blossom server was
   * started. Never rejects; callers may ignore it (fire-and-forget) or `.then`
   * it to record the mirror URL as an imeta `fallback`.
   */
  mirror?: Promise<MirrorResult>;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export function validateFile(file: File, imageOnly = false): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new UploadError("File too large. Maximum size is 100 MB.");
  }

  if (imageOnly) {
    if (!ALLOWED_IMAGE_TYPES.some((t) => file.type === t)) {
      throw new UploadError("Only image files (JPG, PNG, GIF, WebP, SVG, AVIF) are supported.");
    }
  } else {
    if (!ALLOWED_MEDIA_TYPES.some((t) => file.type.startsWith(t))) {
      throw new UploadError("Only images, videos, and audio files are supported.");
    }
  }
}

function readExifOrientation(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (file.type !== "image/jpeg") {
      resolve(1);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const view = new DataView(e.target?.result as ArrayBuffer);
        if (view.getUint16(0, false) !== 0xFFD8) {
          resolve(1);
          return;
        }

        let offset = 2;
        while (offset < view.byteLength - 2) {
          const marker = view.getUint16(offset, false);
          offset += 2;

          if (marker === 0xFFE1) {
            const exifLength = view.getUint16(offset, false);
            offset += 2;

            if (view.getUint32(offset, false) !== 0x45786966) {
              resolve(1);
              return;
            }
            offset += 6;

            const littleEndian = view.getUint16(offset, false) === 0x4949;
            offset += 2;
            offset += 2;
            const ifdOffset = view.getUint32(offset, littleEndian);
            offset = offset - 4 + ifdOffset;

            const entries = view.getUint16(offset, littleEndian);
            offset += 2;

            for (let i = 0; i < entries; i++) {
              const tag = view.getUint16(offset + i * 12, littleEndian);
              if (tag === 0x0112) {
                resolve(view.getUint16(offset + i * 12 + 8, littleEndian));
                return;
              }
            }
            resolve(1);
            return;
          } else if ((marker & 0xFF00) === 0xFF00) {
            offset += view.getUint16(offset, false);
          } else {
            break;
          }
        }
        resolve(1);
      } catch {
        resolve(1);
      }
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

function applyOrientation(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  orientation: number
) {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      canvas.width = height;
      canvas.height = width;
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      canvas.width = height;
      canvas.height = width;
      ctx.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      canvas.width = height;
      canvas.height = width;
      ctx.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      canvas.width = height;
      canvas.height = width;
      ctx.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break;
  }
}

export async function stripImageMetadata(
  file: File,
  options?: { maxDimension?: number }
): Promise<{ file: File; stripped: boolean }> {
  if (!STRIPPABLE_TYPES.includes(file.type)) {
    return { file, stripped: false };
  }

  const orientation = await readExifOrientation(file);
  const maxDim = options?.maxDimension ?? 2048;

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        let targetW = img.naturalWidth;
        let targetH = img.naturalHeight;

        if (maxDim && (targetW > maxDim || targetH > maxDim)) {
          const ratio = Math.min(maxDim / targetW, maxDim / targetH);
          targetW = Math.round(targetW * ratio);
          targetH = Math.round(targetH * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve({ file, stripped: false });
          return;
        }

        if (orientation > 1) {
          applyOrientation(ctx, canvas, targetW, targetH, orientation);
        }

        ctx.drawImage(img, 0, 0, targetW, targetH);

        const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const quality = file.type === "image/png" ? undefined : 0.85;

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl);
            if (!blob) {
              resolve({ file, stripped: false });
              return;
            }
            const cleanFile = new File([blob], file.name, {
              type: outputType,
              lastModified: Date.now(),
            });
            resolve({ file: cleanFile, stripped: true });
          },
          outputType,
          quality
        );
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve({ file, stripped: false });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ file, stripped: false });
    };

    img.src = objectUrl;
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

function readSyncsafeInt(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

function stripMp3Metadata(buffer: ArrayBuffer): ArrayBuffer | null {
  const bytes = new Uint8Array(buffer);
  let start = 0;
  let end = bytes.length;

  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const view = new DataView(buffer);
    const tagSize = readSyncsafeInt(view, 6);
    start = 10 + tagSize;
    const flags = view.getUint8(5);
    if (flags & 0x10) start += 10;
  }

  if (end >= 128) {
    const tagStart = end - 128;
    if (bytes[tagStart] === 0x54 && bytes[tagStart + 1] === 0x41 && bytes[tagStart + 2] === 0x47) {
      end = tagStart;
    }
  }

  if (start === 0 && end === bytes.length) return null;
  if (start >= end) return null;

  return buffer.slice(start, end);
}

function getChunkId(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function stripWavMetadata(buffer: ArrayBuffer): ArrayBuffer | null {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);

  const riffId = getChunkId(view, 0);
  const waveId = getChunkId(view, 8);
  if (riffId !== "RIFF" || waveId !== "WAVE") return null;

  const keepChunks: Array<{ offset: number; size: number }> = [];
  const essentialIds = new Set(["fmt ", "data"]);
  let offset = 12;
  let hadMetadata = false;
  let hasFmt = false;
  let hasData = false;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = getChunkId(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const paddedSize = chunkSize + (chunkSize % 2);
    const totalChunkSize = 8 + paddedSize;

    if (offset + totalChunkSize > buffer.byteLength) break;

    if (essentialIds.has(chunkId)) {
      keepChunks.push({ offset, size: totalChunkSize });
      if (chunkId === "fmt ") hasFmt = true;
      if (chunkId === "data") hasData = true;
    } else {
      hadMetadata = true;
    }

    offset += totalChunkSize;
  }

  if (!hadMetadata || !hasFmt || !hasData) return null;

  let dataSize = 4;
  for (const chunk of keepChunks) dataSize += chunk.size;

  const result = new ArrayBuffer(8 + dataSize);
  const out = new Uint8Array(result);
  const outView = new DataView(result);

  out.set([0x52, 0x49, 0x46, 0x46], 0);
  outView.setUint32(4, dataSize, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);

  let writeOffset = 12;
  for (const chunk of keepChunks) {
    out.set(new Uint8Array(buffer, chunk.offset, chunk.size), writeOffset);
    writeOffset += chunk.size;
  }

  return result;
}

function stripFlacMetadata(buffer: ArrayBuffer): ArrayBuffer | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8) return null;

  if (bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null;

  const blocks: Array<{ type: number; data: Uint8Array; isLast: boolean }> = [];
  let offset = 4;
  let hadStrippableBlock = false;
  let lastBlockEnd = 4;

  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const isLast = !!(header & 0x80);
    const blockType = header & 0x7f;
    const blockSize = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];

    if (offset + 4 + blockSize > bytes.length) break;

    const blockData = bytes.slice(offset + 4, offset + 4 + blockSize);

    if (blockType === 0 || blockType === 3 || blockType === 5) {
      blocks.push({ type: blockType, data: blockData, isLast: false });
    } else if (blockType === 4) {
      hadStrippableBlock = true;
    } else if (blockType === 6) {
      hadStrippableBlock = true;
    } else {
      blocks.push({ type: blockType, data: blockData, isLast: false });
    }

    lastBlockEnd = offset + 4 + blockSize;
    if (isLast) break;
    offset += 4 + blockSize;
  }

  if (!hadStrippableBlock) return null;

  const hasVorbisComment = blocks.some(b => b.type === 4);
  if (!hasVorbisComment) {
    const emptyVendor = new Uint8Array(8);
    blocks.push({ type: 4, data: emptyVendor, isLast: false });
  }

  if (blocks.length > 0) {
    blocks[blocks.length - 1].isLast = true;
  }

  const audioFrames = bytes.slice(lastBlockEnd);

  let totalSize = 4;
  for (const block of blocks) {
    const dataLen = block.type === 4 && block.data.length === 0 ? 8 : block.data.length;
    totalSize += 4 + dataLen;
  }
  totalSize += audioFrames.length;

  const result = new Uint8Array(totalSize);
  result.set([0x66, 0x4c, 0x61, 0x43], 0);
  let writeOffset = 4;

  for (const block of blocks) {
    let headerByte = block.type;
    if (block.isLast) headerByte |= 0x80;

    if (block.type === 4 && block.data.length === 0) {
      result[writeOffset] = headerByte;
      result[writeOffset + 1] = 0;
      result[writeOffset + 2] = 0;
      result[writeOffset + 3] = 8;
      writeOffset += 4;
      const emptyComment = new DataView(new ArrayBuffer(8));
      emptyComment.setUint32(0, 0, true);
      emptyComment.setUint32(4, 0, true);
      result.set(new Uint8Array(emptyComment.buffer), writeOffset);
      writeOffset += 8;
    } else {
      result[writeOffset] = headerByte;
      result[writeOffset + 1] = (block.data.length >> 16) & 0xff;
      result[writeOffset + 2] = (block.data.length >> 8) & 0xff;
      result[writeOffset + 3] = block.data.length & 0xff;
      writeOffset += 4;
      result.set(block.data, writeOffset);
      writeOffset += block.data.length;
    }
  }

  result.set(audioFrames, writeOffset);

  return result.buffer;
}

// MP4/QuickTime videos from phones carry location (the `©xyz` atom inside
// `udta`) and device model. Images are stripped, so a user reasonably assumes
// videos are too — they weren't.
const STRIPPABLE_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v"];

/**
 * Neutralize the ISO-BMFF metadata boxes that carry GPS/device info (`udta`,
 * `meta`) by renaming them to `free` padding IN PLACE and zeroing their payload.
 *
 * The safety property that matters: this is SIZE-PRESERVING. We never remove
 * bytes, so `mdat` never shifts and the `stco`/`co64` chunk-offset tables stay
 * valid — the video can't be corrupted, and there is no re-encode. A `free` box
 * is padding every MP4 parser skips, so the metadata is simply gone.
 *
 * Only touches a file that actually starts with an `ftyp` box (a real MP4/MOV),
 * and only the `udta`/`meta` box types — anything else is left byte-for-byte.
 * Exported for unit testing. Mutates `bytes` in place; returns whether anything
 * was neutralized.
 */
export function scrubMp4MetadataBoxes(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const typeAt = (p: number) => String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
  // Require a real MP4/MOV signature so we never scribble on a mislabeled file.
  if (bytes.length < 8 || typeAt(0) !== "ftyp") return false;

  const NEUTRALIZE = new Set(["udta", "meta"]);
  const RECURSE = new Set(["moov", "trak"]); // where udta/meta actually live
  let stripped = false;

  const walk = (start: number, end: number, depth: number) => {
    if (depth > 8) return; // paranoia against a malformed nesting bomb
    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos);
      let headerSize = 8;
      if (size === 1) {
        // 64-bit largesize
        const hi = view.getUint32(pos + 8);
        const lo = view.getUint32(pos + 12);
        size = hi * 2 ** 32 + lo;
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos; // extends to the end
      }
      const boxEnd = pos + size;
      if (size < headerSize || boxEnd > end) break; // malformed — stop cleanly
      const type = typeAt(pos);
      if (NEUTRALIZE.has(type)) {
        bytes[pos + 4] = 0x66; bytes[pos + 5] = 0x72; bytes[pos + 6] = 0x65; bytes[pos + 7] = 0x65; // "free"
        bytes.fill(0, pos + headerSize, boxEnd); // wipe the payload bytes too
        stripped = true;
      } else if (RECURSE.has(type)) {
        walk(pos + headerSize, boxEnd, depth + 1);
      }
      pos = boxEnd;
    }
  };

  walk(0, bytes.length, 0);
  return stripped;
}

export async function stripVideoMetadata(file: File): Promise<{ file: File; stripped: boolean }> {
  if (!STRIPPABLE_VIDEO_TYPES.includes(file.type)) {
    return { file, stripped: false };
  }
  try {
    const buffer = await readFileAsArrayBuffer(file);
    const bytes = new Uint8Array(buffer); // owned copy from the File read — safe to mutate
    const stripped = scrubMp4MetadataBoxes(bytes);
    if (!stripped) return { file, stripped: false };
    const cleanFile = new File([bytes], file.name, { type: file.type, lastModified: Date.now() });
    return { file: cleanFile, stripped: true };
  } catch {
    return { file, stripped: false };
  }
}

export async function stripAudioMetadata(file: File): Promise<{ file: File; stripped: boolean }> {
  if (!STRIPPABLE_AUDIO_TYPES.includes(file.type)) {
    return { file, stripped: false };
  }

  try {
    const buffer = await readFileAsArrayBuffer(file);
    let cleanBuffer: ArrayBuffer | null = null;

    if (file.type === "audio/mpeg") {
      cleanBuffer = stripMp3Metadata(buffer);
    } else if (file.type === "audio/wav" || file.type === "audio/wave" || file.type === "audio/x-wav") {
      cleanBuffer = stripWavMetadata(buffer);
    } else if (file.type === "audio/flac" || file.type === "audio/x-flac") {
      cleanBuffer = stripFlacMetadata(buffer);
    }

    if (!cleanBuffer) {
      return { file, stripped: false };
    }

    const cleanFile = new File([cleanBuffer], file.name, {
      type: file.type,
      lastModified: Date.now(),
    });
    return { file: cleanFile, stripped: true };
  } catch {
    return { file, stripped: false };
  }
}

async function createNip98AuthHeader(
  url: string,
  method: string,
  signer?: { signEvent: (event: any) => Promise<any> } | null
): Promise<string | null> {
  if (!signer) return null;
  try {
    const authEvent = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", url],
        ["method", method.toUpperCase()],
      ],
      content: "",
    };
    const signed = await signWithTimeout(signer, authEvent);
    return "Nostr " + btoa(JSON.stringify(signed));
  } catch {
    return null;
  }
}

/**
 * Measure an image's pixel dimensions for the NIP-94 `dim` field. Measured on
 * the file we actually send (post-strip, so EXIF rotation is already baked
 * in). Best-effort: any failure returns undefined and the tag is simply
 * omitted — never worth failing an upload over.
 */
async function measureImageDim(file: File): Promise<string | undefined> {
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();
      return width > 0 && height > 0 ? `${width}x${height}` : undefined;
    }
    return await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? `${img.naturalWidth}x${img.naturalHeight}` : undefined);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(undefined);
      };
      img.src = url;
    });
  } catch {
    return undefined;
  }
}

export async function uploadToNostrBuild(
  file: File,
  onStatusChange?: (status: string) => void,
  signer?: { signEvent: (event: any) => Promise<any> } | null,
  imageOptions?: { maxDimension?: number }
): Promise<UploadResult> {
  validateFile(file);

  let uploadFile = file;
  let metadataStripped = false;

  if (isImageFile(file) && STRIPPABLE_TYPES.includes(file.type)) {
    onStatusChange?.("Scrubbing metadata...");
    const result = await stripImageMetadata(file, imageOptions);
    uploadFile = result.file;
    metadataStripped = result.stripped;
  } else if (isAudioFile(file) && STRIPPABLE_AUDIO_TYPES.includes(file.type)) {
    onStatusChange?.("Scrubbing audio metadata...");
    const result = await stripAudioMetadata(file);
    uploadFile = result.file;
    metadataStripped = result.stripped;
  } else if (isVideoFile(file) && STRIPPABLE_VIDEO_TYPES.includes(file.type)) {
    onStatusChange?.("Scrubbing video metadata...");
    const result = await stripVideoMetadata(file);
    uploadFile = result.file;
    metadataStripped = result.stripped;
  }

  const dim = isImageFile(file) ? await measureImageDim(uploadFile) : undefined;

  onStatusChange?.("Authenticating...");
  const authHeader = await createNip98AuthHeader(NOSTR_BUILD_API, "POST", signer);

  onStatusChange?.("Uploading...");

  const formData = new FormData();
  formData.append("fileToUpload", uploadFile);

  const headers: Record<string, string> = {};
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  const response = await fetch(NOSTR_BUILD_API, {
    method: "POST",
    body: formData,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new UploadError("Upload requires authentication. Please sign in with a Nostr extension.");
    }
    throw new UploadError(`Upload failed with status ${response.status}`);
  }

  const data = await response.json();
  if (data.status === "success" && data.data?.[0]?.url) {
    // Keep the fingerprint: prefer the server-reported hash (nostr.build may
    // re-process media, so its sha256 reflects the file it actually serves),
    // falling back to a client-side hash of the bytes we sent.
    let sha256: string | undefined =
      typeof data.data[0].sha256 === "string" && /^[0-9a-f]{64}$/i.test(data.data[0].sha256)
        ? data.data[0].sha256.toLowerCase()
        : undefined;
    if (!sha256) {
      try {
        sha256 = await computeSha256Hex(uploadFile);
      } catch {}
    }
    // Same preference order as the hash above: nostr.build may re-process
    // (resize) media, so its reported dimensions describe the file it serves;
    // our local measurement is the fallback.
    const serverDim =
      data.data[0].dimensions &&
      typeof data.data[0].dimensions === "object" &&
      Number(data.data[0].dimensions.width) > 0 &&
      Number(data.data[0].dimensions.height) > 0
        ? `${Number(data.data[0].dimensions.width)}x${Number(data.data[0].dimensions.height)}`
        : undefined;
    return {
      url: data.data[0].url,
      mime: data.data[0].mime || file.type,
      metadataStripped,
      sha256,
      dim: serverDim || dim,
      size: typeof data.data[0].size === "number" ? data.data[0].size : uploadFile.size,
    };
  }
  throw new UploadError("Upload failed: unexpected response from server");
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/");
}

export function canStripMetadata(file: File): boolean {
  return STRIPPABLE_TYPES.includes(file.type) || STRIPPABLE_AUDIO_TYPES.includes(file.type);
}

export function canStripAudioMetadata(file: File): boolean {
  return STRIPPABLE_AUDIO_TYPES.includes(file.type);
}

export function getBlossomServers(): string[] {
  try {
    const raw = localStorage.getItem(BLOSSOM_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function setBlossomServers(servers: string[]): void {
  try {
    localStorage.setItem(BLOSSOM_STORAGE_KEY, JSON.stringify(servers));
  } catch {}
}

export async function fetchBlossomServerList(pubkey: string, relays: string[] = DEFAULT_RELAYS): Promise<string[]> {
  return new Promise((resolve) => {
    const servers: string[] = [];
    let latestCreatedAt = 0;
    const timeout = setTimeout(() => resolve(servers), 8000);

    const sub = pool.subscribeMany(relays.slice(0, 4), { kinds: [KIND_BLOSSOM_SERVER_LIST], authors: [pubkey], limit: 1 }, {
      onevent(event: any) {
        if (event.created_at > latestCreatedAt) {
          latestCreatedAt = event.created_at;
          servers.length = 0;
          for (const tag of event.tags) {
            if (tag[0] === "server" && tag[1]) {
              servers.push(tag[1]);
            }
          }
        }
      },
      oneose() {
        clearTimeout(timeout);
        sub.close();
        if (servers.length > 0) {
          setBlossomServers(servers);
        }
        resolve(servers);
      },
    });
  });
}

export async function publishBlossomServerList(
  servers: string[],
  signer: { signEvent: (event: any) => Promise<any> },
): Promise<boolean> {
  const tags = servers.map((s) => ["server", s]);
  const event = {
    kind: KIND_BLOSSOM_SERVER_LIST,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  const signed = await signWithTimeout(signer, event);
  setBlossomServers(servers);
  return publishEvent(signed);
}

async function computeSha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function uploadToBlossomServer(
  serverUrl: string,
  file: File,
  signer?: { signEvent: (event: any) => Promise<any> } | null,
  onStatusChange?: (status: string) => void,
): Promise<UploadResult> {
  onStatusChange?.("Computing file hash...");
  const fileHash = await computeSha256Hex(file);

  onStatusChange?.("Authenticating with Blossom server...");
  const authHeader = await createBlossomAuthHeader(serverUrl, "PUT", fileHash, signer);

  const baseUrl = serverUrl.replace(/\/+$/, "");
  const uploadUrl = `${baseUrl}/upload`;

  onStatusChange?.("Uploading to Blossom server...");

  const headers: Record<string, string> = {
    "Content-Type": file.type || "application/octet-stream",
  };
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new UploadError(`Blossom upload failed (${response.status}): ${text || "Unknown error"}`);
  }

  // A 200 with a non-JSON body means the URL isn't actually a Blossom endpoint
  // (e.g. a website's catch-all route) — name that instead of a raw parse error.
  const data = await response.json().catch(() => {
    throw new UploadError("not a Blossom server (returned a non-JSON response)");
  });
  // Keep the fingerprint: the hash we computed for auth IS the blob's identity
  // (Blossom is content-addressed) — return it instead of discarding it.
  const sha256 =
    typeof data.sha256 === "string" && /^[0-9a-f]{64}$/i.test(data.sha256)
      ? data.sha256.toLowerCase()
      : fileHash;
  const size = typeof data.size === "number" ? data.size : file.size;

  if (data.url) {
    return {
      url: data.url,
      mime: data.type || data.mime || file.type,
      metadataStripped: false,
      sha256,
      size,
    };
  }

  if (data.sha256) {
    return {
      url: `${baseUrl}/${data.sha256}`,
      mime: data.type || data.mime || file.type,
      metadataStripped: false,
      sha256,
      size,
    };
  }

  throw new UploadError("Blossom upload failed: unexpected response format");
}

/**
 * Fire-and-forget resilience: after a successful primary upload, ask ONE other
 * Blossom server from the user's list (BUD-04 /mirror) to keep a second copy.
 * Never blocks and never throws — no eligible target, no signer, or a server
 * that doesn't support mirroring all resolve `{ ok: false }`. With the default
 * server list this is a no-op unless the primary host differs from the user's
 * Blossom server (nostr.build is skipped as a target — it's NIP-96).
 */
export function startAutoMirror(
  result: UploadResult,
  signer?: { signEvent: (event: any) => Promise<any> } | null,
): Promise<MirrorResult> {
  try {
    if (!result.sha256 || !signer) return Promise.resolve({ ok: false });
    const target = pickMirrorTarget(result.url, getBlossomServers());
    if (!target) return Promise.resolve({ ok: false });
    return mirrorBlob(result.url, result.sha256, target, signer).catch(() => ({ ok: false }));
  } catch {
    return Promise.resolve({ ok: false });
  }
}

export async function uploadMediaForOutpost(
  file: File,
  relayBlossomServers: string[],
  onStatusChange?: (status: string) => void,
  signer?: { signEvent: (event: any) => Promise<any> } | null,
  imageOptions?: { maxDimension?: number }
): Promise<UploadResult> {
  validateFile(file);

  let uploadFile = file;
  let metadataStripped = false;

  if (isImageFile(file) && STRIPPABLE_TYPES.includes(file.type)) {
    onStatusChange?.("Scrubbing metadata...");
    const result = await stripImageMetadata(file, imageOptions);
    uploadFile = result.file;
    metadataStripped = result.stripped;
  } else if (isAudioFile(file) && STRIPPABLE_AUDIO_TYPES.includes(file.type)) {
    onStatusChange?.("Scrubbing audio metadata...");
    const result = await stripAudioMetadata(file);
    uploadFile = result.file;
    metadataStripped = result.stripped;
  } else if (isVideoFile(file) && STRIPPABLE_VIDEO_TYPES.includes(file.type)) {
    onStatusChange?.("Scrubbing video metadata...");
    const result = await stripVideoMetadata(file);
    uploadFile = result.file;
    metadataStripped = result.stripped;
  }

  if (relayBlossomServers.length > 0) {
    for (const server of relayBlossomServers) {
      try {
        onStatusChange?.(`Uploading to ${new URL(server).hostname}...`);
        const result = await uploadToBlossomServer(server, uploadFile, signer, onStatusChange);
        result.metadataStripped = metadataStripped;
        result.mirror = startAutoMirror(result, signer);
        return result;
      } catch (err) {
        console.warn(`Relay Blossom upload to ${server} failed, trying next...`, err);
      }
    }
    onStatusChange?.("Relay Blossom servers unavailable, trying personal servers...");
  }

  const userServers = getBlossomServers();
  // (Both loops attach a background BUD-04 mirror to the result — see startAutoMirror.)
  if (userServers.length > 0) {
    for (const server of userServers) {
      try {
        onStatusChange?.(`Uploading to ${new URL(server).hostname}...`);
        const result = await uploadToBlossomServer(server, uploadFile, signer, onStatusChange);
        result.metadataStripped = metadataStripped;
        result.mirror = startAutoMirror(result, signer);
        return result;
      } catch (err) {
        console.warn(`Personal Blossom upload to ${server} failed, trying next...`, err);
      }
    }
    onStatusChange?.("Blossom servers unavailable, falling back to nostr.build...");
  }

  return uploadToNostrBuild(uploadFile, onStatusChange, signer);
}

export async function uploadMedia(
  file: File,
  onStatusChange?: (status: string) => void,
  signer?: { signEvent: (event: any) => Promise<any> } | null
): Promise<UploadResult> {
  validateFile(file);

  let uploadFile = file;
  let metadataStripped = false;

  if (isImageFile(file) && STRIPPABLE_TYPES.includes(file.type)) {
    onStatusChange?.("Scrubbing metadata...");
    const result = await stripImageMetadata(file);
    uploadFile = result.file;
    metadataStripped = result.stripped;
  } else if (isAudioFile(file) && STRIPPABLE_AUDIO_TYPES.includes(file.type)) {
    onStatusChange?.("Scrubbing audio metadata...");
    const result = await stripAudioMetadata(file);
    uploadFile = result.file;
    metadataStripped = result.stripped;
  } else if (isVideoFile(file) && STRIPPABLE_VIDEO_TYPES.includes(file.type)) {
    onStatusChange?.("Scrubbing video metadata...");
    const result = await stripVideoMetadata(file);
    uploadFile = result.file;
    metadataStripped = result.stripped;
  }

  const blossomServers = getBlossomServers();
  if (blossomServers.length > 0) {
    for (const server of blossomServers) {
      try {
        onStatusChange?.(`Uploading to ${new URL(server).hostname}...`);
        const result = await uploadToBlossomServer(server, uploadFile, signer, onStatusChange);
        result.metadataStripped = metadataStripped;
        // Fire-and-forget second copy on another of the user's servers.
        result.mirror = startAutoMirror(result, signer);
        return result;
      } catch (err) {
        console.warn(`Blossom upload to ${server} failed, trying next...`, err);
      }
    }
    onStatusChange?.("Blossom servers unavailable, falling back to nostr.build...");
  }

  return uploadToNostrBuild(uploadFile, onStatusChange, signer);
}
