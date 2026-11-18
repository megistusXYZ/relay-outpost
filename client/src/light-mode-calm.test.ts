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
    [".dark .glass-card", /border-color:\s*rgba\(130, 137, 150, 0\.15\) !important/],
    [".dark .glass-dialog", /backdrop-filter:\s*blur\(32px\)/],
    [".dark .glass-nav-panel", /backdrop-filter:\s*blur\(16px\)/],
    [".dark .glass-feed-header", /linear-gradient\(180deg, rgba\(88, 93, 102, 0\.06\)/],
    [".dark .glass-thread", /backdrop-filter:\s*blur\(24px\)/],
    [".dark .glass-settings-section", /border-color:\s*rgba\(125, 132, 145, 0\.16\)/],
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
    expect(RAIL).toMatch(/isDark \? "rgba\(153,162,179,0\.22\)" : "hsl\(var\(--border\)\)"/);
    expect(RAIL).toMatch(/: isDark\s*\?\s*"0 0 8px rgba\(133,143,162,0\.16\)"[\s\S]{0,200}: "none"/);
  });
  it("the page you're on keeps its violet ring and glow", () => {
    expect(RAIL).toMatch(/active\s*\?\s*isDark \? "rgba\(211,215,223,0\.6\)" : "rgba\(114,124,143,0\.6\)"/);
    expect(RAIL).toMatch(/"0 0 18px rgba\(114,124,143,0\.30\)/);
  });
});

describe("unread in the light rail is the count, not a ring", () => {
  // Owner, 2026-10-07: quiet unless selected. An unread destination already
  // carries its count badge; in light mode the spinning violet ring made the
  // bell look like the page you're on. Dark keeps its glowing unread ring.
  const RAIL = readFileSync(path.resolve(import.meta.dirname, "components/DesktopStoriesRail.tsx"), "utf8");
  it("the unread ring and glow are dark mode's", () => {
    expect(RAIL).toMatch(/const ringBg = live && isDark\s*\n?\s*\? ringConic/);
    expect(RAIL).toMatch(/: live && isDark\s*\n?\s*\? "0 0 14px rgba\(153,162,179,0\.4\)"/);
  });
  it("the ring still spins only where it shows", () => {
    expect(RAIL).toMatch(/live && isDark && !reducedMotion \? "rail-ring-spin"/);
  });
});

describe("section titles are grey in light mode", () => {
  // Ember is for actions; titles are ink (LIGHT_MODE.md). Before the rebrand a profile's
  // "Connect with…" and "Details" bars were violet while "Jump through time"
  // beside them was grey.
  // Outpost brand (2026-11-16): one shared section title (TILE_TITLE, ink) so
  // the card bars and "Jump through time" can't drift apart again.
  it("IdentitySection's title is the shared section title, never Ember", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "components/identity/identity-shared.tsx"), "utf8");
    expect(src).toMatch(/<h2 className=\{TILE_TITLE\}>\{title\}<\/h2>/);
    expect(src).not.toMatch(/dark:text-brand\/90/);
  });
});

describe("headings are not violet in light mode", () => {
  const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, f), "utf8");
  it("Relays: Relay Health Monitor and Discover Relays match their sibling headings", () => {
    const src = read("pages/RelayDashboard.tsx");
    // Outpost brand (2026-11-16): section headings are ink sentence case, the
    // same class as their siblings ("Manage relays"), never Ember.
    const sibling = src.match(/<h2 className="([^"]*)">Manage relays<\/h2>/)?.[1];
    expect(sibling).toBeTruthy();
    expect(sibling).not.toMatch(/brand/);
    for (const title of ["Relay health monitor", "Discover relays"]) {
      expect(src, title).toContain(`<h2 className="${sibling}">${title}</h2>`);
    }
  });
  it("Help: the page title is ink and its kicker grey, in both themes", () => {
    // Outpost brand (2026-11-16): the title is ink in both themes and the kicker
    // grey in both; Ember is kept for actions.
    const help = read("pages/WtfIsThis.tsx");
    expect(help).toMatch(/className="[^"]*\btext-foreground"\s*>\s*Help &amp; guides/);
    expect(help).toMatch(/className="[^"]*\btext-muted-foreground\b[^"]*">Get started, post &amp; connect/);
    expect(help).not.toMatch(/dark:text-brand\/(90|30)/);
  });
});

describe("no square icon tiles in light mode", () => {
  // Owner, 2026-10-03: no icon tiles. The Chats empty state still had one.
  it("Chats' empty state shows a bare icon in light; dark keeps a quiet grey disc", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "pages/Messages.tsx"), "utf8");
    const at = src.indexOf('<h2 className="text-base font-semibold text-foreground">Your messages</h2>');
    expect(at).toBeGreaterThan(-1);
    const tile = src.slice(src.lastIndexOf("<div", src.lastIndexOf("<MessagesIcon", at)), at);
    // Outpost brand (2026-11-16): still no tile in light (bare icon); dark
    // keeps a quiet disc, now grey instead of an Ember-bordered square.
    expect(tile).toMatch(/\bdark:bg-foreground\/\[0\.05\]/);
    expect(tile).not.toMatch(/(^|\s)(border|bg-[a-z]+(\/[\d.\[\]]+)?)(\s|")/);
    expect(tile).not.toMatch(/brand/);
    expect(tile).toMatch(/<MessagesIcon className="h-8 w-8 text-foreground\/70" \/>/);
  });
});
