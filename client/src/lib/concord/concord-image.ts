/**
 * Group photos as CORD-02 §6 carries them: an encrypted blob behind a pointer
 * `{url, key, nonce, hash}` (plus Vector's optional `ext`), so the media server
 * learns nothing and a swapped blob fails closed.
 *
 * The spec names no cipher. Vector, the reference client, uses AES-256-GCM with
 * a 16-byte nonce, the 16-byte tag appended to the ciphertext, and `hash` =
 * SHA-256 of the plaintext (vector-core crypto::encrypt_data, CommunityImage).
 * That layout is exactly WebCrypto's, so it's used here; our own photos always
 * get a 16-byte nonce, because Vector's decryptor accepts nothing else.
 *
 * Before this, every such photo from another app was dropped, and a group's
 * photo only ever showed as a plain URL in `picture`.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export interface CommunityImage {
  /** Where the encrypted blob lives (https only). */
  url: string;
  /** AES-256-GCM key, hex. */
  key: string;
  /** AES-GCM nonce, hex: 16 bytes as Vector writes, 12 accepted. */
  nonce: string;
  /** SHA-256 of the plaintext image, hex. */
  hash: string;
  /** File-extension hint ("png"). */
  ext?: string;
}

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`, "i");

/** A pointer we can safely fetch and open, or null (a plain URL is the legacy `picture`, not this). */
export function parseCommunityImage(v: unknown): CommunityImage | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const { url, key, nonce, hash, ext } = o;
  if (typeof url !== "string" || !/^https:\/\/\S+$/i.test(url)) return null;
  if (typeof key !== "string" || !HEX(64).test(key)) return null;
  if (typeof nonce !== "string" || !(HEX(32).test(nonce) || HEX(24).test(nonce))) return null;
  if (typeof hash !== "string" || !HEX(64).test(hash)) return null;
  return {
    url, key: key.toLowerCase(), nonce: nonce.toLowerCase(), hash: hash.toLowerCase(),
    ...(typeof ext === "string" && /^[a-z0-9]{1,8}$/i.test(ext) ? { ext: ext.toLowerCase() } : {}),
  };
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

/** The image, or null when the blob doesn't decrypt or isn't the image its pointer names. */
export async function openCommunityImage(ciphertext: Uint8Array, img: CommunityImage): Promise<Uint8Array | null> {
  try {
    const ck = await crypto.subtle.importKey("raw", hexToBytes(img.key), "AES-GCM", false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(img.nonce), tagLength: 128 }, ck, ciphertext));
    return (await sha256Hex(plain)) === img.hash ? plain : null;
  } catch {
    return null;
  }
}

/** Seal a photo for upload: a fresh key, a 16-byte nonce, and the plaintext's hash. */
export async function sealCommunityImage(plain: Uint8Array): Promise<{ ciphertext: Uint8Array; key: string; nonce: string; hash: string }> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const ck = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, ck, plain));
  return { ciphertext, key: bytesToHex(key), nonce: bytesToHex(nonce), hash: await sha256Hex(plain) };
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif" };
/** A MIME type for the decrypted image, from its extension hint. */
export function imageMime(ext?: string): string {
  return (ext && MIME[ext]) || "image/*";
}
/** The extension hint for a photo we upload ("jpg" for image/jpeg), if it's a known image type. */
export function imageExt(mime: string): string | undefined {
  return Object.keys(MIME).find((ext) => MIME[ext] === mime);
}

// ── Showing a photo (I/O) ─────────────────────────────────────────────────────
// Keyed by the plaintext hash: whatever pointer names it, an opened image with
// that hash is that image. A failure isn't kept, so the next look tries again.
const inFlight = new Map<string, Promise<string | null>>();
const opened = new Map<string, string>();

/** The photo's local URL if it's already open, so a remount doesn't flash initials. */
export function peekCommunityImage(img: CommunityImage): string | undefined {
  return opened.get(img.hash);
}

/** Fetch, open and verify a group photo once per session; a local URL for it, or null. */
export function resolveCommunityImage(
  img: CommunityImage,
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<string | null> {
  const pending = inFlight.get(img.hash);
  if (pending) return pending;
  const p = (async () => {
    try {
      const res = await fetchFn(img.url);
      if (!res.ok) return null;
      const plain = await openCommunityImage(new Uint8Array(await res.arrayBuffer()), img);
      if (!plain) return null;
      const url = URL.createObjectURL(new Blob([plain as BlobPart], { type: imageMime(img.ext) }));
      opened.set(img.hash, url);
      return url;
    } catch {
      return null;
    }
  })();
  inFlight.set(img.hash, p);
  void p.then((url) => { if (!url) inFlight.delete(img.hash); });
  return p;
}

/** Tests only. */
export function __clearCommunityImageCache(): void {
  inFlight.clear();
  opened.clear();
}
