import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SENDER_PALETTE_SIZE, senderColorIndex, senderColor } from "./sender-color";
import { parseColor, contrastRatio, WCAG_AA_NORMAL, type RGB } from "./contrast-utils";

describe("senderColorIndex", () => {
  it("is deterministic: same pubkey → same index, every time", () => {
    const pk = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
    expect(senderColorIndex(pk)).toBe(senderColorIndex(pk));
    expect(senderColorIndex(pk)).toBe(senderColorIndex(pk.slice(0) /* fresh string */));
  });

  it("always lands inside the palette", () => {
    for (let i = 0; i < 200; i++) {
      const pk = i.toString(16).padStart(64, "a");
      const idx = senderColorIndex(pk);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(SENDER_PALETTE_SIZE);
    }
  });

  it("spreads distinct pubkeys across multiple palette slots", () => {
    const used = new Set<number>();
    for (let i = 0; i < 200; i++) {
      used.add(senderColorIndex(i.toString(16).padStart(64, "b")));
    }
    // 200 random-ish keys over 13 slots should hit most of the palette —
    // a degenerate hash collapsing to a few slots would fail here.
    expect(used.size).toBeGreaterThanOrEqual(SENDER_PALETTE_SIZE - 2);
  });

  it("senderColor returns the CSS variable for the hashed index", () => {
    const pk = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
    expect(senderColor(pk)).toBe(`hsl(var(--chat-sender-${senderColorIndex(pk)}))`);
  });
});

// ---- Palette ⟷ CSS conformance + WCAG AA verification -----------------------
// The palette lives ONCE in index.css (:root + .dark). Parse the real file so
// the values shipped to users are the values verified here — no drift.

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

/** Extract `--name: H S% L%;` custom props from one top-level css block. */
function extractBlock(selector: ":root" | ".dark"): Map<string, string> {
  // First plain `:root {` / `.dark {` block in the file (the theme blocks).
  const re = selector === ":root" ? /(^|\n):root\s*\{([\s\S]*?)\n\}/ : /(^|\n)\.dark\s*\{([\s\S]*?)\n\}/;
  const m = css.match(re);
  expect(m, `${selector} block found in index.css`).toBeTruthy();
  const vars = new Map<string, string>();
  for (const line of m![2].split("\n")) {
    const v = line.match(/--([\w-]+):\s*([^;]+);/);
    if (v) vars.set(v[1], v[2].trim());
  }
  return vars;
}

function senderVars(vars: Map<string, string>): string[] {
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const v = vars.get(`chat-sender-${i}`);
    if (!v) break;
    out.push(v);
  }
  return out;
}

describe("chat-sender palette (parsed from index.css)", () => {
  const light = extractBlock(":root");
  const dark = extractBlock(".dark");
  const lightPalette = senderVars(light);
  const darkPalette = senderVars(dark);

  it("defines exactly SENDER_PALETTE_SIZE colors in both themes", () => {
    expect(lightPalette).toHaveLength(SENDER_PALETTE_SIZE);
    expect(darkPalette).toHaveLength(SENDER_PALETTE_SIZE);
  });

  it("avoids red hues and the violet primary band in both themes", () => {
    for (const triple of [...lightPalette, ...darkPalette]) {
      const hue = Number(triple.split(/\s+/)[0]);
      // Red band (reads as error/destructive): ~350–360 and 0–15.
      expect(hue >= 350 || hue <= 15, `hue ${hue} is in the red band`).toBe(false);
      // Violet primary band (262 +/- 25 — reads as selected/primary).
      expect(Math.abs(hue - 262) <= 25, `hue ${hue} collides with the violet primary`).toBe(false);
    }
  });

  function assertAA(palette: string[], bgs: Array<[string, RGB]>, theme: string) {
    palette.forEach((triple, i) => {
      const fg = parseColor(triple);
      expect(fg, `--chat-sender-${i} (${theme}) parses`).toBeTruthy();
      for (const [bgName, bg] of bgs) {
        const ratio = contrastRatio(fg!, bg);
        expect(
          ratio,
          `--chat-sender-${i} (${theme}: "${triple}") vs ${bgName} — got ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
      }
    });
  }

  it("every LIGHT value passes WCAG AA (4.5:1) on the light canvas AND card", () => {
    const canvas = parseColor(light.get("background")!)!;
    const card = parseColor(light.get("card")!)!;
    assertAA(lightPalette, [["--background", canvas], ["--card", card]], "light");
  });

  it("every DARK value passes WCAG AA (4.5:1) on the dark canvas AND card", () => {
    const canvas = parseColor(dark.get("background")!)!;
    const card = parseColor(dark.get("card")!)!;
    assertAA(darkPalette, [["--background", canvas], ["--card", card]], "dark");
  });

  it("light and dark palettes keep the same hue per slot (same person, same hue)", () => {
    lightPalette.forEach((triple, i) => {
      const lightHue = Number(triple.split(/\s+/)[0]);
      const darkHue = Number(darkPalette[i].split(/\s+/)[0]);
      expect(darkHue).toBe(lightHue);
    });
  });
});
