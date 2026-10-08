/**
 * Light mode, Phase 2c (owner, 2026-10-07; LIGHT_MODE.md). The locked
 * decisions: faint violet warmth in the canvas — not a lavender wash; violet
 * reserved for actions, focus and selection; cards are the card token. Light
 * mode had drifted into dark mode's space look: five violet glows on the page,
 * a light "galaxy" of specks and drifting blobs, and cards washed in lavender
 * with lavender shadows. Dark mode is out of scope and must not change.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf8");
const APP = readFileSync(path.resolve(import.meta.dirname, "App.tsx"), "utf8");

/** The body of the first rule whose selector is exactly `selector` (inside any @layer). */
function rule(selector: string): string {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`);
  const m = CSS.match(re);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[2];
}

describe("the light canvas", () => {
  it("is the background token, with no glows painted over it", () => {
    const body = rule("body");
    expect(body).not.toMatch(/radial-gradient/);
    expect(body).not.toMatch(/background-color:\s*hsl\(245/);
  });
  it("has no galaxy of specks or drifting blobs", () => {
    expect(APP).not.toMatch(/light-galaxy/);
    expect(CSS).not.toMatch(/\.light-galaxy/);
  });
  it("dark mode keeps its space look", () => {
    expect(rule(".dark body")).toMatch(/radial-gradient/);
    expect(CSS).toMatch(/\.dark \.space-bg-stars\s*\{/);
  });
});

describe("light cards", () => {
  for (const sel of [".glass-card", ".glass-dialog-card"]) {
    it(`${sel} is the card token with the neutral border — no lavender wash or shadow`, () => {
      const r = rule(sel);
      expect(r).toMatch(/background:\s*hsl\(var\(--card\)\)/);
      expect(r).toMatch(/border-color:\s*hsl\(var\(--border\)\)/);
      expect(r).not.toMatch(/rgba\(1[0-2]0,\s*[5-8]0,\s*(180|200),/);
      expect(r).not.toMatch(/linear-gradient/);
    });
  }
  it("dark cards are unchanged", () => {
    expect(rule(".dark .glass-card")).toMatch(/background/);
  });
});

describe("space backdrops are dark mode's", () => {
  // The Chats empty state and the create pop-ups lay a space photo behind
  // their card; in light mode it read as a faint planet over a lavender wash.
  const SITES: Array<[string, string]> = [
    ["pages/Messages.tsx", "messagesEmptyBg"],
    ["components/CreateStudio.tsx", "createBg"],
    ["components/UploadTrackDialog.tsx", "createBg"],
    ["components/concord/CreateOutpostDialog.tsx", "createBg"],
  ];
  for (const [file, img] of SITES) {
    it(`${file}: the space photo shows only in dark mode`, () => {
      const src = readFileSync(path.resolve(import.meta.dirname, file), "utf8");
      const at = src.indexOf(`src={${img}}`);
      expect(at).toBeGreaterThan(-1);
      const cls = src.slice(at, at + 400).match(/className="([^"]+)"/)?.[1] ?? "";
      expect(cls).toMatch(/(^|\s)hidden(\s|$)/);
      expect(cls).toMatch(/dark:block/);
    });
  }
});

describe("dark mode keeps what it inherited from the light rules", () => {
  // Some dark rules never set these; they inherited them from the light rules
  // this pass changed. A dark-screenshot pixel diff found it (card borders).
  const PINNED: Array<[string, RegExp]> = [
    [".dark .glass-card", /border-color:\s*rgba\(120, 80, 200, 0\.15\) !important/],
    [".dark .glass-dialog", /backdrop-filter:\s*blur\(32px\)/],
    [".dark .glass-nav-panel", /backdrop-filter:\s*blur\(16px\)/],
    [".dark .glass-feed-header", /linear-gradient\(180deg, rgba\(80, 50, 140, 0\.06\)/],
    [".dark .glass-thread", /backdrop-filter:\s*blur\(24px\)/],
    [".dark .glass-settings-section", /border-color:\s*rgba\(100, 70, 200, 0\.16\)/],
  ];
  for (const [sel, value] of PINNED) {
    it(`${sel} keeps its own value`, () => {
      const re = new RegExp(`${sel.replace(/[.]/g, "\\.")}[^{]*\\{[^}]*${value.source}`);
      expect(CSS).toMatch(re);
    });
  }
});

describe("the rail in light mode is quiet unless selected", () => {
  // Owner, 2026-10-07: every rail icon sat in a lavender-glowing ring.
  const RAIL = readFileSync(path.resolve(import.meta.dirname, "components/DesktopStoriesRail.tsx"), "utf8");
  it("a destination you're not on has the neutral border and no glow in light mode", () => {
    expect(RAIL).toMatch(/isDark \? "rgba\(168,85,247,0\.22\)" : "hsl\(var\(--border\)\)"/);
    expect(RAIL).toMatch(/: isDark\s*\?\s*"0 0 8px rgba\(124,58,237,0\.16\)"[\s\S]{0,200}: "none"/);
  });
  it("the page you're on keeps its violet ring and glow", () => {
    expect(RAIL).toMatch(/active\s*\?\s*isDark \? "rgba\(196,181,253,0\.6\)" : "rgba\(109,40,217,0\.6\)"/);
    expect(RAIL).toMatch(/"0 0 18px rgba\(109,40,217,0\.30\)/);
  });
});

describe("unread in the light rail is the count, not a ring", () => {
  // Owner, 2026-10-07: quiet unless selected. An unread destination already
  // carries its count badge; in light mode the spinning violet ring made the
  // bell look like the page you're on. Dark keeps its glowing unread ring.
  const RAIL = readFileSync(path.resolve(import.meta.dirname, "components/DesktopStoriesRail.tsx"), "utf8");
  it("the unread ring and glow are dark mode's", () => {
    expect(RAIL).toMatch(/const ringBg = live && isDark\s*\n?\s*\? ringConic/);
    expect(RAIL).toMatch(/: live && isDark\s*\n?\s*\? "0 0 14px rgba\(168,85,247,0\.4\)"/);
  });
  it("the ring still spins only where it shows", () => {
    expect(RAIL).toMatch(/live && isDark && !reducedMotion \? "rail-ring-spin"/);
  });
});

describe("section titles are grey in light mode", () => {
  // Violet is for actions, focus and selection (LIGHT_MODE.md). A profile's
  // "Connect with…" and "Details" bars were violet while "Jump through time"
  // beside them was grey.
  it("IdentitySection's title is the muted grey, violet only in dark", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "components/identity/identity-shared.tsx"), "utf8");
    expect(src).toMatch(/<h2 className="[^"]*\btext-muted-foreground dark:text-brand\/90\b[^"]*">\{title\}<\/h2>/);
  });
});

describe("headings are not violet in light mode", () => {
  const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, f), "utf8");
  it("Relays: Relay Health Monitor and Discover Relays match their sibling headings", () => {
    const src = read("pages/RelayDashboard.tsx");
    for (const title of ["Relay Health Monitor", "Discover Relays"]) {
      expect(src, title).toContain(`<h2 className="text-sm font-brand tracking-wider uppercase dark:text-brand">${title}</h2>`);
    }
  });
  it("Help: the page title is ink, violet in dark", () => {
    expect(read("pages/WtfIsThis.tsx")).toMatch(/className="[^"]*\btext-foreground dark:text-brand\/90"\s*>\s*Help &amp; Guides/);
  });
});

describe("no square icon tiles in light mode", () => {
  // Owner, 2026-10-03: no icon tiles. The Chats empty state still had one.
  it("Chats' empty state shows a bare grey icon; the dark tile stays", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "pages/Messages.tsx"), "utf8");
    const at = src.indexOf('<h2 className="text-base font-semibold text-foreground/90">Your messages</h2>');
    expect(at).toBeGreaterThan(-1);
    const tile = src.slice(src.lastIndexOf("<div", src.lastIndexOf("<MessagesIcon", at)), at);
    expect(tile).toMatch(/dark:border dark:border-brand\/15 dark:bg-white\/\[0\.03\]/);
    expect(tile).not.toMatch(/(^|\s)(border|bg-brand\/5|border-brand\/20)(\s|")/);
    expect(tile).toMatch(/<MessagesIcon className="h-8 w-8 text-muted-foreground dark:text-brand\/70" \/>/);
  });
});
