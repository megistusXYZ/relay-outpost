/**
 * Two banner reports, both from the banner path drifting away from the avatar
 * path it sits eight pixels from.
 *
 *  - "banner images not showing as gifs or videos … it works on profile pics
 *    but not profile banners"
 *  - "when banner images are broken … it looks broken"
 */
import { describe, it, expect } from "vitest";
import { bannerSrcFor, presetBannerFor, PRESET_BANNERS } from "./profile-banner";

const GIF = "https://image.nostr.build/d0516dca63cec66605bb464ca1ed1522a006953cf1d4ce3360e94beec3658752.gif";
const JPG = "https://example.test/banner.jpg";
const PK_A = "aa".repeat(32);
const PK_B = "bb".repeat(32);

describe("animated banners keep animating", () => {
  it("does not send a GIF through the resizing proxy", () => {
    // Measured on this exact URL: proxied came back 147 KB (one frame) against
    // a 3.0 MB animated original. The proxy re-encodes, and without `n=-1` that
    // means a still.
    expect(bannerSrcFor(GIF)).toBe(GIF);
    expect(bannerSrcFor(GIF)).not.toContain("wsrv.nl");
  });

  it("does not reach for &n=-1 instead", () => {
    // The other tempting fix, and it is worse: all-frames re-encoded to
    // 1200x600 measured 4.9 MB — larger than the untouched original.
    expect(bannerSrcFor(GIF)).not.toContain("n=-1");
  });

  it("still proxies a still image, which is where the proxy earns its keep", () => {
    const out = bannerSrcFor(JPG);
    expect(out).toContain("wsrv.nl");
    expect(out).toContain("w=1200");
  });

  it("leaves an already-proxied URL alone rather than double-wrapping it", () => {
    const already = "https://wsrv.nl/?url=https%3A%2F%2Fx.test%2Fa.jpg&w=1200";
    expect(bannerSrcFor(already)).toBe(already);
  });

  it("survives a malformed URL instead of throwing inside a render", () => {
    expect(bannerSrcFor("not a url")).toBe("not a url");
  });
});

describe("a missing or broken banner gets a preset", () => {
  it("falls back to a preset rather than an empty band", () => {
    expect(PRESET_BANNERS).toContain(bannerSrcFor(undefined, PK_A));
  });

  it("gives one account the SAME banner every time", () => {
    // "Rotate" implemented as random would change a profile's face between
    // visits and flicker on re-render. Variety belongs ACROSS accounts.
    expect(presetBannerFor(PK_A)).toBe(presetBannerFor(PK_A));
  });

  it("gives different accounts different banners", () => {
    expect(presetBannerFor(PK_A)).not.toBe(presetBannerFor(PK_B));
  });

  it("spreads a realistic set of pubkeys across more than one preset", () => {
    // Guards the lazy hash. Slicing the first hex chars would clump on
    // vanity-mined prefixes, which are cheap on nostr.
    const picks = new Set(
      Array.from({ length: 60 }, (_, i) => presetBannerFor(`${i}`.padStart(64, "f"))),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("never throws on a missing pubkey", () => {
    expect(PRESET_BANNERS).toContain(presetBannerFor(undefined));
    expect(PRESET_BANNERS).toContain(presetBannerFor(""));
  });
});
