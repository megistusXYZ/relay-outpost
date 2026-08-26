import { describe, it, expect, beforeEach } from "vitest";
import {
  NEUTRAL_RATIO,
  VIDEO_TALLEST_RATIO,
  VIDEO_WIDEST_RATIO,
  clampVideoRatio,
  ratioFromSize,
  rememberRatio,
  recallRatio,
  clearRatioMemory,
  reservedRatio,
  nextFrozenRatio,
  boxMatchesMedia,
} from "./media-ratio";

const PORTRAIT = 1080 / 1920; // 0.5625 — a phone video
const LANDSCAPE = 16 / 9;

describe("ratioFromSize", () => {
  it("is width over height", () => {
    expect(ratioFromSize(1600, 900)).toBeCloseTo(LANDSCAPE, 5);
    expect(ratioFromSize(1080, 1920)).toBeCloseTo(PORTRAIT, 5);
  });

  it("refuses anything that isn't a usable pair", () => {
    // A <video> reports 0×0 before metadata; an <img> that 404s reports 0 too.
    // Treating either as a ratio would reserve a box of zero or Infinity.
    for (const bad of [
      [0, 100], [100, 0], [-5, 10], [10, -5],
      [NaN, 100], [100, Infinity], [undefined, 100], [100, null],
    ] as const) {
      expect(ratioFromSize(bad[0] as number, bad[1] as number)).toBeNull();
    }
  });
});

describe("the learned-ratio memory", () => {
  beforeEach(() => clearRatioMemory());

  it("remembers a URL's shape so the second sighting is right immediately", () => {
    rememberRatio("https://x/a.jpg", 1080, 1350);
    expect(recallRatio("https://x/a.jpg")).toBeCloseTo(0.8, 5);
  });

  it("knows nothing about a URL it has not seen", () => {
    expect(recallRatio("https://x/never.jpg")).toBeUndefined();
  });

  it("stores nothing for unusable sizes or an empty URL", () => {
    rememberRatio("https://x/b.jpg", 0, 0);
    expect(recallRatio("https://x/b.jpg")).toBeUndefined();
    rememberRatio("", 100, 100);
    expect(recallRatio("")).toBeUndefined();
  });
});

describe("reservedRatio — what box to draw right now", () => {
  it("falls back to the neutral box when nothing is known", () => {
    expect(reservedRatio({})).toBe(NEUTRAL_RATIO);
  });

  it("prefers imeta over a learned value", () => {
    // Stability over a fractional accuracy gain: imeta is there on the first
    // paint, so preferring it means the box never changes when a publisher's
    // `dim` disagrees slightly with the real pixels.
    expect(reservedRatio({ imetaRatio: 0.75, learnedRatio: 0.8 })).toBe(0.75);
  });

  it("uses the learned value when imeta is absent", () => {
    expect(reservedRatio({ learnedRatio: PORTRAIT })).toBeCloseTo(PORTRAIT, 5);
  });

  it("lets a frozen box win over everything", () => {
    // The invariant: a box on screen does not change size, even once the truth
    // arrives. This is the difference between a correction landing quietly and
    // shoving the post someone is reading.
    expect(reservedRatio({ frozenRatio: NEUTRAL_RATIO, imetaRatio: 0.5, learnedRatio: 0.5 }))
      .toBe(NEUTRAL_RATIO);
  });

  it("ignores garbage ratios rather than reserving a zero-height box", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(reservedRatio({ imetaRatio: bad })).toBe(NEUTRAL_RATIO);
    }
  });

  it("honours an explicit fallback for callers with a better default", () => {
    expect(reservedRatio({ fallback: LANDSCAPE })).toBe(LANDSCAPE);
  });
});

describe("nextFrozenRatio — capture, hold, release", () => {
  it("captures the current box the moment it becomes visible", () => {
    expect(nextFrozenRatio(undefined, true, NEUTRAL_RATIO)).toBe(NEUTRAL_RATIO);
  });

  it("holds the captured box while it stays visible, whatever arrives", () => {
    expect(nextFrozenRatio(NEUTRAL_RATIO, true, 0.5625)).toBe(NEUTRAL_RATIO);
  });

  it("releases on the way out, so a wrong guess self-corrects unseen", () => {
    expect(nextFrozenRatio(NEUTRAL_RATIO, false, 0.5625)).toBeUndefined();
  });

  it("stays released while off screen", () => {
    expect(nextFrozenRatio(undefined, false, 0.5625)).toBeUndefined();
  });

  it("re-captures the corrected box on the next appearance", () => {
    // Full round trip: guessed while visible → released on exit → the learned
    // ratio is what gets frozen when it comes back.
    let frozen = nextFrozenRatio(undefined, true, NEUTRAL_RATIO);
    frozen = nextFrozenRatio(frozen, false, PORTRAIT);
    frozen = nextFrozenRatio(frozen, true, PORTRAIT);
    expect(frozen).toBeCloseTo(PORTRAIT, 5);
  });
});

describe("clampVideoRatio", () => {
  it("leaves a real clip's shape alone", () => {
    expect(clampVideoRatio(PORTRAIT)).toBeCloseTo(PORTRAIT, 5);
    expect(clampVideoRatio(0.75)).toBe(0.75);
    expect(clampVideoRatio(LANDSCAPE)).toBeCloseTo(LANDSCAPE, 5);
  });

  it("pulls anything beyond a real clip's range back to the edge", () => {
    expect(clampVideoRatio(0.2)).toBeCloseTo(VIDEO_TALLEST_RATIO, 5); // skyscraper
    expect(clampVideoRatio(3.5)).toBeCloseTo(VIDEO_WIDEST_RATIO, 5); // banner
  });

  it("falls back to wide rather than reserving a broken box", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(clampVideoRatio(bad)).toBeCloseTo(VIDEO_WIDEST_RATIO, 5);
    }
  });
});

describe("boxMatchesMedia — the cover/contain decision", () => {
  it("is true when the reserved box is the media's own shape", () => {
    expect(boxMatchesMedia(0.75, 0.75)).toBe(true);
    expect(boxMatchesMedia(0.7501, 0.75)).toBe(true);
  });

  it("is false for a guessed box, which is what forbids cropping", () => {
    // The original bug in one assertion: a 0.643 portrait photo in a 16/10
    // (1.6) box. Answering true here is what centre-cropped it.
    expect(boxMatchesMedia(1.6, 0.643)).toBe(false);
  });

  it("is false when the true shape is unknown", () => {
    expect(boxMatchesMedia(NEUTRAL_RATIO, null)).toBe(false);
    expect(boxMatchesMedia(NEUTRAL_RATIO, undefined)).toBe(false);
    expect(boxMatchesMedia(NEUTRAL_RATIO, NaN)).toBe(false);
  });
});
