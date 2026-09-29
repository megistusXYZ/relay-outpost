/**
 * The launch splash is inline in index.html, but browsers paint nothing until
 * every <link rel="stylesheet"> in <head> has loaded, so the splash sat behind
 * the app's 501 KB stylesheet (measured, 2026-09-29). The build turns that one
 * link into a non-blocking load and signals the splash when it's in.
 *
 * The first version switched the link on with an inline onload="" attribute.
 * Production's CSP has script-src-attr 'none', so the browser refused it: the
 * stylesheet never applied and the splash held for its full 4 s cap (#184,
 * found on the local production build through a throttled proxy). The markup
 * now carries no inline handler at all; a plain inline <script> (allowed)
 * does the switching.
 */
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { nonBlockingAppCss } from "./non-blocking-css";

const HREF = "/assets/index-D95M7MX3.css";
const APP = `<link rel="stylesheet" crossorigin href="${HREF}">`;
const FONTS = `<link rel="stylesheet" media="print" onload="this.onload=null;this.media='all'" href="https://fonts.googleapis.com/css2?family=Inter&display=swap">`;

function page(withSignal = true) {
  const signal = withSignal ? "<script>window.__roCss=new Promise(function(r){window.__roCssDone=r});</script>" : "";
  const dom = new JSDOM(`<!doctype html><html><head>${signal}${nonBlockingAppCss(APP)}</head><body></body></html>`, { runScripts: "dangerously" });
  const w = dom.window as any;
  const sheet = () => w.document.querySelector(`link[rel="stylesheet"][href="${HREF}"]`) as HTMLLinkElement;
  return { w, sheet };
}
const settled = (p: Promise<unknown>) => Promise.race([p.then(() => "in"), new Promise((r) => setTimeout(() => r("waiting"), 20))]);

describe("nonBlockingAppCss", () => {
  it("uses no inline event handler, which production's CSP (script-src-attr 'none') blocks", () => {
    const out = nonBlockingAppCss(`<head>${APP}</head>`).replace(/<noscript>.*?<\/noscript>/g, "");
    expect(out).not.toMatch(/\son[a-z]+=/i);
  });

  it("fetches the stylesheet early without blocking the first paint", () => {
    const out = nonBlockingAppCss(`<head>${APP}</head>`);
    expect(out).toContain(`<link rel="preload" as="style" crossorigin href="${HREF}">`);
    // The only render-blocking form left is the <noscript> fallback.
    expect(out.replace(/<noscript>.*?<\/noscript>/g, "")).not.toContain(APP);
  });

  it("applies the styles once they've loaded, and tells the splash", async () => {
    const { w, sheet } = page();
    expect(sheet().media).toBe("print");
    expect(await settled(w.__roCss)).toBe("waiting");
    sheet().dispatchEvent(new w.Event("load"));
    expect(sheet().media).toBe("all");
    expect(await settled(w.__roCss)).toBe("in");
  });

  it("a stylesheet that fails still releases the splash", async () => {
    const { w, sheet } = page();
    sheet().dispatchEvent(new w.Event("error"));
    expect(await settled(w.__roCss)).toBe("in");
  });

  it("works on a page without the splash signal", () => {
    const { w, sheet } = page(false);
    expect(() => sheet().dispatchEvent(new w.Event("load"))).not.toThrow();
    expect(sheet().media).toBe("all");
  });

  it("keeps a plain stylesheet for browsers without JavaScript", () => {
    expect(nonBlockingAppCss(`<head>${APP}</head>`)).toContain(`<noscript>${APP}</noscript>`);
  });

  it("leaves other stylesheets alone", () => {
    expect(nonBlockingAppCss(`<head>${FONTS}${APP}</head>`)).toContain(FONTS);
  });

  it("a page with no app stylesheet is unchanged", () => {
    const html = `<head>${FONTS}</head>`;
    expect(nonBlockingAppCss(html)).toBe(html);
  });
});
