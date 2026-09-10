/**
 * A marketplace listing's description (NIP-99) in the listing sheet.
 *
 * Reported 2026-09-10 from a phone: the "Dark Forest zine" listing showed its
 * dribbble and shop URLs as dead plain text. The description is untrusted
 * seller text, so links go through Linkify: http(s) only, new tab, no opener.
 * Server-rendered (react-dom/server) so no DOM is needed.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ListingDescription } from "./ListingDescription";

const render = (text: string) => renderToString(createElement(ListingDescription, { text }));
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

const DARK_FOREST = [
  "Lunarpunk zine created by Peter Horváth, bitpunk.fm and No Good Kid in 2025.",
  "",
  "📷 https://dribbble.com/shots/26612197-Dark-Forest-00-Dark-Forest-Zine",
  "",
  "🌘 https://darkfo.rest/",
].join("\n");

describe("ListingDescription — the seller's links are tappable", () => {
  it("turns each web link into a link that opens in a new tab without an opener", () => {
    const html = render(DARK_FOREST);
    expect(hrefs(html)).toEqual([
      "https://dribbble.com/shots/26612197-Dark-Forest-00-Dark-Forest-Zine",
      "https://darkfo.rest/",
    ]);
    for (const tag of html.match(/<a [^>]*>/g) ?? []) {
      expect(tag).toContain('target="_blank"');
      expect(tag).toContain('rel="noopener noreferrer"');
    }
  });

  it("keeps the rest of the description as written, line breaks included", () => {
    const html = render(DARK_FOREST);
    expect(html).toContain("Lunarpunk zine created by Peter Horváth");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("📷 ");
  });

  it("links only the web: other schemes stay plain text", () => {
    const html = render("javascript:alert(1) data:text/html,hi ftp://files.example.com");
    expect(hrefs(html)).toEqual([]);
    expect(html).toContain("javascript:alert(1)");
  });

  it("leaves sentence punctuation outside the link", () => {
    const html = render("Shop at https://darkfo.rest/.");
    expect(hrefs(html)).toEqual(["https://darkfo.rest/"]);
    expect(html).toMatch(/<\/a>\.<\/p>$/);
  });

  it("keeps a long link on one line inside the sheet, with the full address in its title", () => {
    const html = render(DARK_FOREST);
    const tag = (html.match(/<a [^>]*dribbble[^>]*>/) ?? [""])[0];
    expect(tag).toMatch(/class="[^"]*\btruncate\b/);
    expect(tag).toMatch(/class="[^"]*\bmax-w-full\b/);
    expect(tag).toContain('title="https://dribbble.com/shots/26612197-Dark-Forest-00-Dark-Forest-Zine"');
  });

  it("renders a description without links as plain text", () => {
    expect(hrefs(render("42 pages\nPremium 180g paper"))).toEqual([]);
  });
});
