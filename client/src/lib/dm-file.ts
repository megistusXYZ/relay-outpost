/**
 * NIP-17 kind-15 encrypted file messages (DM attachments).
 *
 * A DM attachment (image/video/audio/file) is AES-256-GCM encrypted client-side
 * with a fresh random key + 16-byte nonce; the CIPHERTEXT is uploaded to a
 * ciphertext-friendly Blossom host, and the key/nonce ride inside the gift-
 * wrapped kind-15 rumor as top-level tags (`decryption-key` / `decryption-nonce`,
 * hex). This is the interoperable NIP-17 shape.
 *
 * Interop is matched byte-for-byte against Amethyst's quartz `AESGCM`:
 *   • algorithm `aes-gcm`, 32-byte key, 16-byte nonce, all hex-encoded
 *   • 128-bit auth tag appended to the ciphertext (WebCrypto's default output,
 *     identical to JCE `AES/GCM/NoPadding` doFinal) — so a blob we encrypt
 *     decrypts on Amethyst and vice-versa.
 *
 * WHY: before this, DM images were uploaded in the CLEAR and wrapped as kind-15
 * with only an `m` tag (no key). A conformant client (Amethyst) sees kind-15,
 * expects the decryption tags, downloads the URL and tries to AES-decrypt the
 * plaintext blob → it fails → "could not decrypt the message". We still PARSE
 * that legacy shape (no key ⇒ treat the URL as plaintext) so old DM history and
 * clients that send unencrypted kind-15 keep rendering.
 *
 * The tag codec is pure + unit-tested; the crypto + upload/fetch I/O is not.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  getBlossomServers,
  uploadToBlossomServer,
  stripImageMetadata,
} from "@/lib/media-upload";
import {
  encryptedUploadServers,
  summarizeUploadFailures,
} from "@/lib/concord/concord-media";

export const FILE_ENCRYPTION_ALGO = "aes-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 16; // matches Amethyst quartz AESGCM default nonce length

export interface DmFileRef {
  /** URL of the (encrypted, when a key is present) file. */
  url: string;
  mime?: string;
  /** hex AES-256-GCM key — present ⇒ the blob at `url` is ciphertext. */
  key?: string;
  /** hex 16-byte AES-GCM nonce. */
  nonce?: string;
  /** encryption-algorithm tag value (`aes-gcm`). */
  algo?: string;
  /** SHA-256 (hex) of the encrypted bytes (NIP-17 `x`). */
  sha256?: string;
  /** Encrypted file size in bytes. */
  size?: number;
  /** "WxH" for images/video — powers aspect ratio before the blob resolves. */
  dim?: string;
}

/** True when the ref carries decryption material (a real NIP-17 encrypted file). */
export const isEncryptedFile = (r: DmFileRef): boolean => !!r.key && !!r.nonce;

// ── kind-15 tag codec (pure) ─────────────────────────────────────────────────

/** Build the NIP-17 kind-15 tags for a file ref (content carries the URL). */
export function buildFileMessageTags(ref: DmFileRef): string[][] {
  const tags: string[][] = [];
  if (ref.mime) tags.push(["file-type", ref.mime]);
  if (ref.key && ref.nonce) {
    tags.push(["encryption-algorithm", ref.algo || FILE_ENCRYPTION_ALGO]);
    tags.push(["decryption-key", ref.key]);
    tags.push(["decryption-nonce", ref.nonce]);
  }
  if (ref.sha256) tags.push(["x", ref.sha256]);
  if (typeof ref.size === "number" && ref.size > 0) tags.push(["size", String(ref.size)]);
  if (ref.dim) tags.push(["dim", ref.dim]);
  return tags;
}

/**
 * Parse a kind-15 rumor's tags + content into a file ref, or null if there's no
 * URL. Tolerates the legacy plaintext shape (an `m` mime tag and no key) so old
 * history and unencrypted senders still render.
 */
export function parseFileMessage(tags: string[][] | undefined, content: string): DmFileRef | null {
  const url = (content || "").trim();
  if (!url) return null;
  const get = (name: string) => tags?.find((t) => t[0] === name)?.[1];
  const sizeRaw = get("size");
  const size = sizeRaw ? parseInt(sizeRaw, 10) : undefined;
  return {
    url,
    mime: get("file-type") || get("m"),
    algo: get("encryption-algorithm"),
    key: get("decryption-key"),
    nonce: get("decryption-nonce"),
    sha256: get("x"),
    size: size && !Number.isNaN(size) ? size : undefined,
    dim: get("dim"),
  };
}

// ── encrypt + upload (I/O) ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Signer = { signEvent: (e: any) => Promise<any> } | null | undefined;

/**
 * Strip metadata, AES-256-GCM encrypt, upload the ciphertext to a
 * ciphertext-friendly Blossom host, and return the NIP-17 file ref (with the
 * hex key/nonce the recipient needs). The returned ref feeds
 * `buildFileMessageTags` for the kind-15 rumor.
 */
export async function encryptAndUploadDmFile(
  file: File,
  signer: Signer,
  onStatus?: (s: string) => void,
): Promise<DmFileRef> {
  // Same privacy pass as the public path: scrub EXIF (GPS!) + downscale BEFORE
  // encrypting, so the recipient decrypts the exact bytes we uploaded.
  let source = file;
  if (file.type.startsWith("image/")) {
    onStatus?.("Scrubbing metadata…");
    source = (await stripImageMetadata(file).catch(() => ({ file, stripped: false }))).file;
  }

  onStatus?.("Encrypting…");
  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const plain = new Uint8Array(await source.arrayBuffer());
  const ck = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, ck, plain),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ct));
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

  const dim = await imageDimensions(source).catch(() => undefined);
  return {
    url: uploaded.url,
    mime: source.type || file.type || "application/octet-stream",
    key: bytesToHex(key),
    nonce: bytesToHex(nonce),
    algo: FILE_ENCRYPTION_ALGO,
    sha256: bytesToHex(digest),
    size: ct.byteLength,
    dim,
  };
}

// ── decrypt to a cached object URL (I/O) ─────────────────────────────────────
const blobUrlCache = new Map<string, string>(); // ciphertext url → object url

/**
 * Resolve a file ref to a displayable URL: public/legacy refs return their URL
 * unchanged; encrypted refs fetch the ciphertext and AES-GCM decrypt to a cached
 * blob URL.
 */
export async function resolveDmFileUrl(ref: DmFileRef): Promise<string> {
  if (!isEncryptedFile(ref)) return ref.url;
  const hit = blobUrlCache.get(ref.url);
  if (hit) return hit;
  const res = await fetch(ref.url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const ct = new Uint8Array(await res.arrayBuffer());
  const ck = await crypto.subtle.importKey("raw", hexToBytes(ref.key!), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(ref.nonce!), tagLength: 128 },
    ck,
    ct,
  );
  const url = URL.createObjectURL(new Blob([plain], { type: ref.mime || "application/octet-stream" }));
  blobUrlCache.set(ref.url, url);
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
