/**
 * Petname photos — the uploaded half of "make it mine", LOCAL BY DESIGN.
 *
 * The rename dialog promises "it never leaves your account", and an image on
 * any media server — including our own Blossom infra — would break that
 * promise the moment it was uploaded. So photos live in IndexedDB on THIS
 * device only; the nickname/emoji/color still sync (they ride the encrypted
 * settings event), and on your other devices the emoji/color tile stands in.
 * An honest trade, stated in the dialog.
 *
 * Import-time processing is where the owner's requirements all land at once:
 *  - PERFORMANCE: center-cropped and downscaled to 160×160 (2× the largest
 *    render size), re-encoded WebP — a few KB, instant to paint.
 *  - "SCRAPING DATA": the canvas re-encode strips EVERY byte of metadata —
 *    EXIF, GPS, serial numbers — because none of it survives a redraw. There
 *    is nothing to scrub later; it never gets stored.
 *  - SAFE + EASY: type/size validated before decode, auto square crop, no
 *    cropper UI to learn.
 */
import { keyOf, getPetname, isShowingRealNames, type PetnameKind } from "./petnames";

const DB_NAME = "relay-outpost-petname-images";
const DB_VERSION = 1;
const STORE = "images";

export const AVATAR_SIZE = 160;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * The cover-crop rectangle: the largest centered square of the source.
 * Pure, because the only bug a cropper ever has is this arithmetic.
 */
export function coverCropRect(srcW: number, srcH: number): { sx: number; sy: number; size: number } {
  const size = Math.min(srcW, srcH);
  return { sx: Math.floor((srcW - size) / 2), sy: Math.floor((srcH - size) / 2), size };
}

/**
 * File → 160×160 WebP blob, metadata-free. Rejects non-images and >10MB
 * before decoding anything.
 */
export async function processImageToAvatar(file: File | Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Not an image");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Image is larger than 10MB");
  const bitmap = await createImageBitmap(file);
  try {
    const { sx, sy, size } = coverCropRect(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob) throw new Error("Could not encode image");
    return blob;
  } finally {
    bitmap.close();
  }
}

export async function putPetnameImage(kind: PetnameKind, id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, keyOf(kind, id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  invalidate(kind, id);
}

export async function deletePetnameImage(kind: PetnameKind, id: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(keyOf(kind, id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  invalidate(kind, id);
}

async function readPetnameImage(kind: PetnameKind, id: string): Promise<Blob | undefined> {
  const db = await openDB();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(keyOf(kind, id));
    req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : undefined);
    req.onerror = () => resolve(undefined);
  });
}

// ── Render cache: sync reads for rows, async hydration behind them ───────────
// Rows render at full speed from this map; a miss kicks ONE async load and the
// "petnames-changed" event re-renders consumers when the URL is ready.
// Object URLs are process-lifetime — a handful of 160px webps is not a leak
// worth a refcounting scheme.
const urlCache = new Map<string, string | null>();
const loading = new Set<string>();

function invalidate(kind: PetnameKind, id: string): void {
  const key = keyOf(kind, id);
  const prior = urlCache.get(key);
  if (prior) URL.revokeObjectURL(prior);
  urlCache.delete(key);
  loading.delete(key);
  try { window.dispatchEvent(new CustomEvent("petnames-changed")); } catch {}
}

/**
 * The row-facing read: returns a URL when the photo is cached, undefined
 * otherwise (fall back to emoji/color/initials) — and quietly starts loading
 * so the photo appears on the re-render the event triggers.
 */
export function petnameImageUrlSync(kind: PetnameKind, id: string): string | undefined {
  const key = keyOf(kind, id);
  const cached = urlCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  if (!loading.has(key)) {
    loading.add(key);
    readPetnameImage(kind, id).then((blob) => {
      if (!loading.has(key)) return; // invalidated while loading
      loading.delete(key);
      urlCache.set(key, blob ? URL.createObjectURL(blob) : null);
      if (blob) {
        try { window.dispatchEvent(new CustomEvent("petnames-changed")); } catch {}
      }
    });
  }
  return undefined;
}

/**
 * App-wide avatar override: the photo the viewer chose for this subject, or
 * undefined when they chose none or the session "show real names" flip is on.
 * The choke point (nostr-helpers.getAvatarUrl) consults this so a petname
 * photo replaces the real avatar EVERYWHERE, not just in chat rows.
 */
export function petnameAvatarFor(kind: PetnameKind, id: string): string | undefined {
  if (isShowingRealNames()) return undefined;
  if (!getPetname(kind, id)) return undefined;
  return petnameImageUrlSync(kind, id);
}

/** Seam for tests and the post-upload instant paint: place a URL in the sync
 *  cache without a round-trip through IndexedDB. */
export function seedPetnameImageUrl(kind: PetnameKind, id: string, url: string | undefined): void {
  urlCache.set(keyOf(kind, id), url ?? null);
}
