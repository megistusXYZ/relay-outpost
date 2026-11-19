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
