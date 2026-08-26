import { describe, it, expect } from "vitest";
import {
  parseColor,
  hslToRgb,
  contrastRatio,
  ratioFromCss,
  wcagLevel,
  blend,
} from "./contrast-utils";

describe("contrast-utils", () => {
  it("computes the canonical black/white ratio as 21:1", () => {
    expect(ratioFromCss("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("white on white is 1:1", () => {
    expect(ratioFromCss("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("parses hex shorthand", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor("#000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("parses the app's bare HSL-triple token form", () => {
    // --background light: 245 25% 96% -> near white
    const bg = parseColor("245 25% 96%");
    expect(bg).not.toBeNull();
    expect(bg!.r).toBeGreaterThan(230);
    // tolerates hsl() wrapper and commas
    expect(parseColor("hsl(0, 0%, 0%)")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("hslToRgb matches known anchors", () => {
    expect(hslToRgb(0, 0, 100)).toEqual({ r: 255, g: 255, b: 255 });
    expect(hslToRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(hslToRgb(0, 100, 50)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("classifies WCAG levels at the thresholds", () => {
    expect(wcagLevel(21)).toBe("AAA");
    expect(wcagLevel(7)).toBe("AAA");
    expect(wcagLevel(4.5)).toBe("AA");
    expect(wcagLevel(4.49)).toBe("fail");
    // large-text thresholds are looser
    expect(wcagLevel(3, { large: true })).toBe("AA");
    expect(wcagLevel(4.5, { large: true })).toBe("AAA");
  });

  it("flags a documented failing pair as < AA before fix", () => {
    // purple-300 (~#d8b4fe) text over a pale purple-tinted light background.
    const ratio = ratioFromCss("#d8b4fe", "#f3eefe");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeLessThan(4.5);
    // a darker purple-700 (~#7e22ce) on the same bg should pass AA
    const fixed = ratioFromCss("#7e22ce", "#f3eefe");
    expect(fixed!).toBeGreaterThanOrEqual(4.5);
  });

  it("blends translucent foreground over background toward the bg", () => {
    const half = blend({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0.5);
    expect(half.r).toBe(128);
    // 50% black on white has far less contrast than solid black on white
    expect(contrastRatio(half, { r: 255, g: 255, b: 255 })).toBeLessThan(
      contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }),
    );
  });
});
