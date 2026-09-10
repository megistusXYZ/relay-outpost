/**
 * How much of a linked page the link-preview fetch reads.
 *
 * OpenGraph tags live in <head>, so the reader stops at </head> and never
 * pulls a multi-MB page. Pages about audio are the exception: podcast episode
 * pages often carry their player only in the body, and so do live-radio pages.
 * Bowl After Bowl's /live/ page (captured 2026-09-10) links its station ~11.6KB
 * in, past a 2KB head, so a head-only read turned a listenable page into a
 * plain gray link card.
 */
import { describe, expect, it } from "vitest";
import { ogReadsBody } from "./og-read";

describe("ogReadsBody", () => {
  it("reads past the head on a live page, where a station's player sits in the body", () => {
    expect(ogReadsBody("https://bowlafterbowl.com/live/")).toBe(true);
  });

  it("keeps an ordinary article head-only: its OpenGraph tags are all in <head>", () => {
    expect(ogReadsBody("https://www.nytimes.com/2026/09/10/technology/ai-chips.html")).toBe(false);
  });

  it("still reads podcast episode pages, whose player is often only in the body", () => {
    expect(ogReadsBody("https://podhome.fm/episodes/some-show/42")).toBe(true);
  });
});
