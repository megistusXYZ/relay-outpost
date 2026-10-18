/**
 * A NIP-71 video post can list the same clip at several sizes, one imeta tag
 * each. The feed shows ONE player, using the smallest size that is still
 * sharp at the width it is drawn, instead of a player per size.
 */
import { describe, it, expect } from "vitest";
import { pickVideoVariant, videoTargetWidth } from "./video-variant";

const v = (url: string, width?: number, height?: number) => ({ url, ...(width && height ? { dimensions: { width, height } } : {}) });

describe("pickVideoVariant", () => {
  const sizes = [v("1080p", 1920, 1080), v("360p", 640, 360), v("720p", 1280, 720)];

  it("picks the smallest size at least as wide as needed", () => {
    expect(pickVideoVariant(sizes, 780)?.url).toBe("720p");
    expect(pickVideoVariant(sizes, 600)?.url).toBe("360p");
  });

  it("takes the largest when none is wide enough", () => {
    expect(pickVideoVariant(sizes, 4000)?.url).toBe("1080p");
  });

  it("judges a portrait clip by its width", () => {
    const tall = [v("tall-1080", 1080, 1920), v("tall-720", 720, 1280)];
    expect(pickVideoVariant(tall, 700)?.url).toBe("tall-720");
  });

  it("prefers a size it knows over one it doesn't, and the first when it knows none", () => {
    expect(pickVideoVariant([v("unknown"), v("720p", 1280, 720)], 780)?.url).toBe("720p");
    expect(pickVideoVariant([v("a"), v("b")], 780)?.url).toBe("a");
    expect(pickVideoVariant([], 780)).toBeUndefined();
  });
});

describe("videoTargetWidth", () => {
  it("is the drawn width times the screen density, density capped at 2", () => {
    expect(videoTargetWidth(390, 3)).toBe(780);
    expect(videoTargetWidth(600, 1)).toBe(600);
  });
});
