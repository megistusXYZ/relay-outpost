/**
 * The banner for someone without one, or whose banner won't load (owner,
 * 2026-10-07: "custom for our solution, subtle and comfortable, not
 * overbearing… very good in both light and dark"). Chosen: Aurora + Terrain —
 * a soft glow in the brand's family with faint map-like contours. Drawn by
 * the app, so it never fails to load; one look per person, every time.
 */
import { describe, it, expect } from "vitest";
import { drawnBannerFor } from "./default-banner";

const A = "a".repeat(64), B = "7b".repeat(32);
const svg = (uri: string) => decodeURIComponent(uri.replace(/^data:image\/svg\+xml;utf8,/, ""));

describe("the drawn default banner", () => {
  it("is the same for the same person every time, and different between people", () => {
    expect(drawnBannerFor(A, false)).toBe(drawnBannerFor(A, false));
    expect(drawnBannerFor(A, false)).not.toBe(drawnBannerFor(B, false));
  });
  it("has its own light and dark version", () => {
    const light = svg(drawnBannerFor(A, false)), dark = svg(drawnBannerFor(A, true));
    expect(light).not.toBe(dark);
    // The ground it is drawn on: pale in light mode, deep in dark mode.
    const ground = (s: string) => Number(s.match(/<rect[^>]*fill="hsl\(\d+ \d+% (\d+)%\)"/)?.[1]);
    expect(ground(light)).toBeGreaterThan(90);
    expect(ground(dark)).toBeLessThan(15);
  });
  it("is an image the app draws itself: nothing to download, nothing to fail", () => {
    const uri = drawnBannerFor(B, true);
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(svg(uri)).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(uri.length).toBeLessThan(40_000);
  });
  it("has both parts: the soft glow and the faint contours", () => {
    const s = svg(drawnBannerFor(A, false));
    expect(s).toMatch(/feGaussianBlur/);
    expect((s.match(/<path /g) ?? []).length).toBeGreaterThan(10);
  });
  it("never throws without a key", () => {
    expect(drawnBannerFor(undefined, false)).toMatch(/^data:image\/svg\+xml/);
    expect(drawnBannerFor("", true)).toMatch(/^data:image\/svg\+xml/);
  });
});
