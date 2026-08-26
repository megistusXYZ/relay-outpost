/**
 * One place that decides what a profile banner actually loads.
 *
 * Two reports, one file. Both came from the banner path having quietly diverged
 * from the avatar path that sits eight pixels away from it.
 */
import bannerNebula from "../assets/images/banner-nebula.webp";
import bannerNetwork from "../assets/images/banner-network.webp";
import bannerWasteland from "../assets/images/banner-outpost-wasteland.webp";
import bannerRelayTower from "../assets/images/banner-relay-tower.webp";
import bannerStation from "../assets/images/banner-station.webp";
import bannerWormhole from "../assets/images/banner-wormhole.webp";

/** The house set. Already shipped for the create-account flow. */
export const PRESET_BANNERS: readonly string[] = [
  bannerNebula,
  bannerNetwork,
  bannerWasteland,
  bannerRelayTower,
  bannerStation,
  bannerWormhole,
];

/**
 * A preset for this account — varied across people, STABLE for one person.
 *
 * "Rotate" is the obvious reading and the wrong implementation: picking at
 * random on each render means a profile changes its face between visits, and
 * flickers on re-render. Deriving it from the pubkey gives the same variety
 * across a list of accounts while any single account keeps one banner forever,
 * which is what makes it read as *theirs* rather than as a placeholder.
 *
 * Hashed rather than sliced: the first hex characters of a pubkey are not
 * uniformly distributed across a vanity-prefixed set, and mining a prefix is
 * cheap on nostr.
 */
export function presetBannerFor(pubkey: string | undefined | null): string {
  if (!pubkey) return PRESET_BANNERS[0];
  // FNV-1a, not the usual `h * 31 + c`. That one COLLIDED on the first two
  // fixtures written for it — `"aa".repeat(32)` and `"bb".repeat(32)` landed on
  // the same preset — because 64 repetitions of one character feed it a very
  // regular sequence and the low bits stop moving. Pubkeys are hex, which is
  // exactly that kind of low-entropy alphabet.
  let h = 0x811c9dc5;
  for (let i = 0; i < pubkey.length; i++) {
    h ^= pubkey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return PRESET_BANNERS[Math.abs(h) % PRESET_BANNERS.length];
}

/**
 * Formats whose whole point is that they move.
 *
 * `.gif` is the one that matters in practice; animated WebP and AVIF are
 * included because the same reasoning applies and the check is free.
 */
const ANIMATED = /\.(gif|webp|avif)(\?|#|$)/i;

/**
 * The URL to actually put in `src`.
 *
 * WHY ANIMATED IMAGES SKIP THE PROXY. Banners were sent through
 * `wsrv.nl?w=1200&h=600&fit=cover` unconditionally, which RE-ENCODES — and
 * without `n=-1` that means a single frame. Measured on a real profile's banner
 * (a 3.0 MB animated GIF on image.nostr.build): the proxied URL came back at
 * 147 KB, one frame, animation gone.
 *
 * Adding `n=-1` is not the fix either. The same measurement with all frames
 * returned 4.9 MB — bigger than the original, because re-encoding to 1200x600
 * inflates it. Passing the original through costs less AND keeps the animation.
 *
 * This is also exactly what the AVATAR path already does: `getOptimizedImageUrl`
 * returns nostr.build URLs untouched, which is why a GIF avatar animated while
 * the same GIF as a banner did not. The two paths had drifted; this closes the
 * gap on the side that was wrong.
 */
export function bannerSrcFor(banner: string | undefined | null, pubkey?: string | null): string {
  if (!banner) return presetBannerFor(pubkey);
  try {
    const u = new URL(banner);
    if (u.hostname === "wsrv.nl") return banner;
    // Animation survives only if we do not touch it.
    if (ANIMATED.test(u.pathname)) return banner;
    // Still a cover crop — the band is full-bleed, so cropping happens either
    // way and doing it at the proxy saves the bytes. 1200 because 800 was being
    // upscaled at both ends (1152 desktop, ~1029 on a 3x phone), which is what
    // made banners look soft.
    return `https://wsrv.nl/?url=${encodeURIComponent(banner)}&w=1200&h=600&fit=cover&default=${encodeURIComponent(banner)}`;
  } catch {
    return banner;
  }
}
