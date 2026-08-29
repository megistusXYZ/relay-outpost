/**
 * Encrypted media for Concord messages. Uploaded files (image/video/audio) are
 * AES-256-GCM encrypted client-side with a fresh random key; the ciphertext goes
 * to Blossom and the key/iv ride inside the already-E2E message (as an imeta
 * tag), so the file is unreadable without outpost access. Viewers fetch the
 * ciphertext and decrypt to a blob URL in-app.
 *
 * GIFs/stickers picked from the picker are ALREADY public URLs, so they carry no
 * key — they render as a plain URL (nothing user-private to protect).
 *
 * The imeta tag codec is pure + unit-tested; the crypto + upload/fetch I/O is not.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { getBlossomServers, uploadToBlossomServer, stripImageMetadata, stripVideoMetadata } from "@/lib/media-upload";

export interface ConcordMedia {
  url: string;
  mime: string;
  /** AES-GCM key (hex, 32 bytes) — absent for public media (GIFs). */
  key?: string;
  /** AES-GCM iv (hex, 12 bytes) — absent for public media. */
  iv?: string;
  name?: string;
  /** "WxH" for images/video, powers aspect-ratio before decrypt. */
  dim?: string;
}

export const isEncrypted = (m: ConcordMedia): boolean => !!m.key && !!m.iv;
export const mediaKind = (m: ConcordMedia): "image" | "video" | "audio" | "file" =>
  m.mime.startsWith("image/") ? "image" : m.mime.startsWith("video/") ? "video" : m.mime.startsWith("audio/") ? "audio" : "file";

// ── imeta tag codec (NIP-92 shaped) ──────────────────────────────────────────
/** Serialize to a rumor tag: ["imeta","url …","m …","decryption-key …", …]. */
export function mediaToTag(m: ConcordMedia): string[] {
  const parts = [`url ${m.url}`, `m ${m.mime}`];
  if (m.key) parts.push("encryption-algorithm aes-gcm", `decryption-key ${m.key}`);
  if (m.iv) parts.push(`decryption-nonce ${m.iv}`);
  if (m.dim) parts.push(`dim ${m.dim}`);
  if (m.name) parts.push(`name ${m.name}`);
  return ["imeta", ...parts];
}

/** Parse an imeta tag back to a descriptor, or null if it has no url. */
export function tagToMedia(tag: string[]): ConcordMedia | null {
  if (tag[0] !== "imeta") return null;
  const kv: Record<string, string> = {};
  for (const entry of tag.slice(1)) {
    const sp = entry.indexOf(" ");
    if (sp > 0) kv[entry.slice(0, sp)] = entry.slice(sp + 1);
  }
  if (!kv.url) return null;
  return {
    url: kv.url,
    mime: kv.m || "application/octet-stream",
    key: kv["decryption-key"],
    iv: kv["decryption-nonce"],
    dim: kv.dim,
    name: kv.name,
  };
}

/** Pull all media descriptors out of a rumor's tags. */
export function mediaFromTags(tags: string[][]): ConcordMedia[] {
  return tags.filter((t) => t[0] === "imeta").map(tagToMedia).filter((m): m is ConcordMedia => m !== null);
}

// ── Encrypt + upload (I/O) ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Signer = { signEvent: (e: any) => Promise<any> } | null | undefined;

/**
 * Blossom hosts verified to store OPAQUE blobs (application/octet-stream).
 * AES-GCM ciphertext is indistinguishable from random bytes, and the popular
 * media hosts sniff upload CONTENT (not just the header): blossom.primal.net
 * 415s anything that isn't a recognizable image/video regardless of the
 * declared Content-Type, and nostr.build's Blossom service (blossom.band)
 * allow-lists media types too. So the user's own server list — tuned for
 * public photos — routinely contains ZERO servers that can host an encrypted
 * attachment. These fallbacks keep encrypted chat media working; the user's
 * own servers are still tried first in case they run a permissive host.
 */
export const ENCRYPTED_MEDIA_FALLBACK_SERVERS = [
  "https://nostr.download",
  "https://files.sovbit.host",
];

/**
 * Upload order for an encrypted blob: the user's Blossom servers first (they
 * chose them), then the ciphertext-friendly fallbacks. Normalized (trailing
 * slashes stripped) + deduped, so a user who already lists a fallback host
 * doesn't hit it twice. Pure — unit-tested.
 */
export function encryptedUploadServers(
  userServers: string[],
  fallbacks: string[] = ENCRYPTED_MEDIA_FALLBACK_SERVERS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...userServers, ...fallbacks]) {
    const s = (raw || "").trim().replace(/\/+$/, "");
    if (!s) continue;
    const dedupeKey = s.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(s);
  }
  return out;
}

/**
 * Collapse per-server failures into ONE actionable toast line: the real reason
 * from the first server (usually the user's primary), plus how many were
 * tried — instead of a generic "failed on all servers". Pure — unit-tested.
 */
export function summarizeUploadFailures(failures: { server: string; message: string }[]): string {
  if (failures.length === 0) return "No media servers are configured for encrypted uploads.";
  const first = failures[0];
  let host = first.server;
  try { host = new URL(first.server).hostname; } catch { /* keep raw */ }
  const detail = (first.message || "Unknown error").replace(/\s+/g, " ").trim().slice(0, 160);
  if (failures.length === 1) return `Upload failed — ${host}: ${detail}`;
  return `Upload failed on all ${failures.length} servers — ${host}: ${detail}`;
}

export async function encryptAndUpload(file: File, signer: Signer, onStatus?: (s: string) => void): Promise<ConcordMedia> {
  // Same privacy pass as the public upload path: strip EXIF (GPS!) and downsize
  // BEFORE encrypting — group members decrypt the exact bytes we upload.
  let uploadSource = file;
  if (file.type.startsWith("image/")) {
    onStatus?.("Scrubbing metadata…");
    uploadSource = (await stripImageMetadata(file).catch(() => ({ file, stripped: false }))).file;
  } else if (file.type.startsWith("video/")) {
    // Videos carry GPS (©xyz) + device model too — scrub before encrypting.
    onStatus?.("Scrubbing metadata…");
    uploadSource = (await stripVideoMetadata(file).catch(() => ({ file, stripped: false }))).file;
  }

  onStatus?.("Encrypting…");
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(await uploadSource.arrayBuffer());
  const ck = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, ck, plain));
  const ctFile = new File([ct], "blob.enc", { type: "application/octet-stream" });

  onStatus?.("Uploading…");
  const servers = encryptedUploadServers(getBlossomServers());
  const failures: { server: string; message: string }[] = [];
  let uploaded: { url: string } | null = null;
  for (const s of servers) {
    try {
      uploaded = await uploadToBlossomServer(s, ctFile, signer as never, onStatus);
      break;
    } catch (err) {
      failures.push({ server: s, message: String((err as Error)?.message ?? err) });
    }
  }
  if (!uploaded) throw new Error(summarizeUploadFailures(failures));

  const dim = await imageDimensions(uploadSource).catch(() => undefined);
  return { url: uploaded.url, mime: uploadSource.type || "application/octet-stream", key: bytesToHex(key), iv: bytesToHex(iv), name: file.name, dim };
}

// ── Decrypt to a cached object URL (I/O) ─────────────────────────────────────
const blobUrlCache = new Map<string, string>(); // ciphertext url → object url

export async function resolveMediaUrl(m: ConcordMedia): Promise<string> {
  if (!isEncrypted(m)) return m.url; // public (GIF) — use directly
  const hit = blobUrlCache.get(m.url);
  if (hit) return hit;
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const ct = new Uint8Array(await res.arrayBuffer());
  const ck = await crypto.subtle.importKey("raw", hexToBytes(m.key!), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(m.iv!) }, ck, ct);
  const url = URL.createObjectURL(new Blob([plain], { type: m.mime }));
  blobUrlCache.set(m.url, url);
  return url;
}

function imageDimensions(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(undefined);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { resolve(`${img.naturalWidth}x${img.naturalHeight}`); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(undefined); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
