/**
 * The panel over a live stream while it tunes in (LIGHT_MODE.md, rule 5:
 * readable or not at all). RelayOutpostLoader draws an ink face and muted
 * words, which only read on a neutral surface. In light mode the panel was an
 * Ember gradient: the words measured 1.2:1 on it and the face 2.4:1.
 *
 * This is the backstop. The real check is the page open in both themes with
 * the colours measured.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(path.resolve(import.meta.dirname, "LiveStreams.tsx"), "utf8");

/** The source of `function StreamPlayerLoader`, up to the next top-level function. */
function loaderSource(): string {
  const start = SRC.indexOf("function StreamPlayerLoader(");
  if (start < 0) throw new Error("StreamPlayerLoader is gone: point this guard at the stream's loading panel");
  const end = SRC.indexOf("\nfunction ", start + 1);
  return SRC.slice(start, end < 0 ? undefined : end);
}

/** The class names on the panel, the element that carries `absolute inset-0`. */
function panelClasses(): string[] {
  const m = loaderSource().match(/className="([^"]*\babsolute inset-0\b[^"]*)"/);
  if (!m) throw new Error("no absolute inset-0 panel in StreamPlayerLoader");
  return m[1].split(/\s+/);
}

describe("the stream's tuning-in panel", () => {
  it("is a neutral, opaque surface in light mode", () => {
    const light = panelClasses().filter((c) => !c.includes(":"));
    expect(light.filter((c) => /brand/.test(c))).toEqual([]);
    expect(light.filter((c) => /^(bg-gradient|from-|via-|to-)/.test(c))).toEqual([]);
    // Opaque: the empty <video> under the panel is black.
    expect(light.filter((c) => /^bg-(muted|card|background)$/.test(c))).toHaveLength(1);
  });

  it("keeps its near-black gradient in dark mode", () => {
    const classes = panelClasses();
    expect(classes).toContain("dark:bg-gradient-to-br");
    expect(classes).toContain("dark:from-[#0a0a14]");
    expect(classes).toContain("dark:to-[#080810]");
  });

  it("passes the loader no text colour: the loader sets its own, so one here does nothing", () => {
    const loader = loaderSource().match(/<RelayOutpostLoader[^>]*>/);
    expect(loader).not.toBeNull();
    expect(loader![0]).not.toMatch(/\btext-(brand|foreground|muted|white|black)/);
  });
});

/**
 * The rest of the Live page (LIGHT_MODE.md, rules 2 and 6): Ember is for
 * acting, so in light mode it does not paint a surface. The card art of a
 * stream with no picture, the player box, the "can't play" card, the
 * placeholders and the Ended badge were Ember panels with Ember words on them.
 *
 * A class with a variant (`dark:`, `hover:`, `after:`) is left alone: dark
 * keeps its look, and a hover is an action answering. An Ember tint is still
 * allowed behind an Ember word, which is how a tinted button or a tag is drawn.
 */
describe("the Live page's light surfaces", () => {
  /** Every quoted or back-ticked piece of the source that could hold class names. */
  const strings = [...SRC.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? "");
  const emberPaint = (c: string) => /^(bg|from|via|to|border|ring)-brand(\/\d+)?$/.test(c);

  // The participant hover card is one dark card in both themes (its words are
  // white), so its Ember hairlines and avatar ring sit on a dark ground in
  // light mode too.
  const DARK_IN_BOTH_THEMES = [
    "absolute inset-0 border border-brand/20 rounded-xl",
    "absolute top-0 left-1/2 -translate-x-1/2 w-24 h-[1px] bg-gradient-to-r from-transparent via-brand/50 to-transparent",
    "w-12 h-12 ring-2 ring-brand/30 border-2 border-[#0d0d2b] shrink-0 cursor-pointer",
  ];

  it("paints no Ember surface, border or ring without an Ember word on it", () => {
    const offenders = strings
      .filter((s) => !DARK_IN_BOTH_THEMES.includes(s))
      .filter((s) => {
        const classes = s.split(/\s+/);
        return classes.some(emberPaint) && !classes.includes("text-brand");
      });
    expect(offenders).toEqual([]);
  });

  it("still finds the exceptions it lists: a list that matches nothing hides a change", () => {
    for (const s of DARK_IN_BOTH_THEMES) expect(strings).toContain(s);
  });

  it("writes the sentences on the player's panels in ink, not Ember", () => {
    // The wrappers of the "upcoming", "no stream" and "can't play" words.
    const wrappers = strings.filter((s) => /^text-center space-y-[23] /.test(s) && /\btext-(brand|foreground)\b/.test(s));
    expect(wrappers).toHaveLength(2);
    for (const s of wrappers) expect(s.split(/\s+/)).toContain("text-foreground");
  });

  it("leaves the thumbnail's dark fade off a card that has no picture, in light mode", () => {
    expect(SRC).toMatch(/from-black\/80 via-transparent to-transparent \$\{hasThumbnail \? "" : "hidden dark:block"\}/);
  });
});

/**
 * Selection is ink (LIGHT_MODE.md, rule 3), in both themes: the chosen tab was
 * an Ember word with an Ember line under it. And a hashtag on this page is a
 * label, not a link, so it is a plain secondary word (rule 2): it was an Ember
 * word on an Ember tint.
 */
describe("the Live page's tabs and hashtags", () => {
  it("draws the chosen tab in ink, with an ink line, and says it is chosen", () => {
    const tab = SRC.slice(SRC.indexOf("data-testid={`tab-streams-${tab.key}`}"));
    const button = tab.slice(0, tab.indexOf("</button>"));
    expect(button).toMatch(/aria-pressed=\{filterTab === tab\.key\}/);
    expect(button).toMatch(/"text-foreground after:absolute [^"]*after:bg-foreground"/);
    expect(button).not.toMatch(/brand/);
  });

  it("writes each hashtag as a plain secondary word", () => {
    const tags = [...SRC.matchAll(/<span key=\{t(?:ag)?\} className="([^"]*)">\s*#\{t(?:ag)?\}/g)].map((m) => m[1]);
    expect(tags).toHaveLength(3);
    for (const c of tags) expect(c).toBe("text-xs text-muted-foreground");
  });
});

/**
 * The Planned badge (LIGHT_MODE.md, rule 5). It sits on the page, beside a
 * stream's hashtags, and in light mode it was white on 80% amber: 2.56:1. In
 * light it is now the warning word on the muted surface, the same shape as the
 * Ended badge beside it. Dark keeps its amber pill, which passes.
 */
describe("the Live page's Planned badge", () => {
  const badge = (SRC.match(/data-testid="badge-status-planned" className="([^"]*)"/) || [])[1] ?? "";
  const light = badge.split(/\s+/).filter((c) => !c.includes(":"));

  it("is the warning word on a neutral surface in light mode", () => {
    expect(light).toContain("text-warning");
    expect(light).toContain("bg-muted");
    expect(light.filter((c) => /^(bg|text|border)-(amber|white)/.test(c))).toEqual([]);
  });

  it("keeps its amber pill in dark mode", () => {
    expect(badge).toContain("dark:bg-amber-600/80");
    expect(badge).toContain("dark:text-white");
  });
});

/**
 * The Audio badge (LIGHT_MODE.md, rule 5). It marks an audio room on its card
 * and on its own page, and in light mode it was white on 80% emerald: 2.95:1
 * on a card with no picture, 2.92:1 on the page. One component draws both now:
 * in light, the success word on the muted surface; in dark, white on emerald.
 * On a card the badge lies over the stream's thumbnail, so the pill is solid
 * in both themes: the old 80% emerald let a bright picture through and the
 * white word fell to 3.23:1 on it in dark.
 */
describe("the Live page's Audio badge", () => {
  const start = SRC.indexOf("function AudioBadge(");
  const source = start < 0 ? "" : SRC.slice(start, SRC.indexOf("\nfunction ", start + 1));
  const badge = (source.match(/className="([^"]*)"/) || [])[1] ?? "";
  const light = badge.split(/\s+/).filter((c) => !c.includes(":"));

  it("is the success word on a neutral surface in light mode", () => {
    expect(light).toContain("text-success");
    expect(light).toContain("bg-muted");
    expect(light.filter((c) => /^(bg|text|border)-(emerald|white)/.test(c))).toEqual([]);
  });

  it("is white on emerald in dark mode", () => {
    expect(badge).toContain("dark:bg-emerald-700");
    expect(badge).toContain("dark:text-white");
  });

  /** A fill with an opacity suffix (`bg-emerald-600/80`) shows what is under it. */
  const seeThrough = (classes: string) => classes.split(/\s+/).filter((c) => /(^|:)bg-[^\s]*\/\d/.test(c));

  it("is a solid pill in both themes, so a thumbnail cannot show through it", () => {
    expect(badge).not.toBe("");
    expect(seeThrough(badge)).toEqual([]);
  });

  it("the solid-pill check can fail: it catches the fill that shipped", () => {
    expect(seeThrough("bg-emerald-600/80 text-white border-emerald-500/50 gap-1")).toEqual(["bg-emerald-600/80"]);
    expect(seeThrough("bg-muted dark:bg-emerald-600/80 text-success")).toEqual(["dark:bg-emerald-600/80"]);
  });

  it("is the only place the page draws it: the card and the room's page both use it", () => {
    expect(SRC.match(/<AudioBadge /g)).toHaveLength(2);
    expect(SRC).not.toMatch(/"bg-emerald-600\/80 text-white/);
  });
});
