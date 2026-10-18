/**
 * The browser half of lib/signup-identity.ts: turn the photo and banner a new
 * account was given into files and upload them through the same uploader a
 * picture the person picked would use, so the profile points at the person's
 * own uploads and shows in every app (owner, 2026-10-17). Best effort: a
 * failed upload leaves that field out of the profile, exactly as before.
 */
import { uploadToNostrBuild } from "./media-upload";
import { avatarSvg, SIGNUP_BANNERS } from "./signup-identity";

type Signer = { signEvent: (event: any) => Promise<any> };

/** The generated photo as a 512 × 512 PNG file. */
export async function avatarPngFile(seed: number): Promise<File> {
  const svgUrl = URL.createObjectURL(new Blob([avatarSvg(seed)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("photo did not draw")); img.src = svgUrl; });
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(img, 0, 0, 512, 512);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no png"))), "image/png"));
    return new File([blob], "photo.png", { type: "image/png" });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/** One of the app's banners as a file. */
export async function bannerFile(index: number): Promise<File> {
  const choice = SIGNUP_BANNERS[index] ?? SIGNUP_BANNERS[0];
  const res = await fetch(choice.src);
  if (!res.ok) throw new Error(`banner ${res.status}`);
  const blob = await res.blob();
  return new File([blob], "banner.jpg", { type: blob.type || "image/jpeg" });
}

export interface ChosenUploads { photoUrl?: string; bannerUrl?: string }

/**
 * Upload what was chosen for them, skipping anything they picked themselves.
 * Never throws: each field is either an uploaded URL or absent.
 */
export async function uploadChosen(
  opts: { avatarSeed: number | null; bannerIndex: number | null },
  signer: Signer,
): Promise<ChosenUploads> {
  const [photo, bannerUpload] = await Promise.allSettled([
    opts.avatarSeed === null ? Promise.resolve(undefined) : avatarPngFile(opts.avatarSeed).then((f) => uploadToNostrBuild(f, undefined, signer, { maxDimension: 512 })).then((r) => r.url),
    opts.bannerIndex === null ? Promise.resolve(undefined) : bannerFile(opts.bannerIndex).then((f) => uploadToNostrBuild(f, undefined, signer, { maxDimension: 1920 })).then((r) => r.url),
  ]);
  return {
    photoUrl: photo.status === "fulfilled" ? photo.value : undefined,
    bannerUrl: bannerUpload.status === "fulfilled" ? bannerUpload.value : undefined,
  };
}

/** Wait for `p`, but never longer than `ms`; on timeout, `fallback`. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}
