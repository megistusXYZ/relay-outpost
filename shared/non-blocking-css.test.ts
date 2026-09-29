/**
 * The launch splash is inline in index.html, but browsers paint nothing until
 * every <link rel="stylesheet"> in <head> has loaded, so the splash sat behind
 * the app's 501 KB stylesheet (measured, 2026-09-29). The build turns that one
 * link into a non-blocking load and signals the splash when it's in.
 */
import { describe, it, expect } from "vitest";
import { nonBlockingAppCss } from "./non-blocking-css";

const APP = '<link rel="stylesheet" crossorigin href="/assets/index-D95M7MX3.css">';
const FONTS = `<link rel="stylesheet" media="print" onload="this.onload=null;this.media='all'" href="https://fonts.googleapis.com/css2?family=Inter&display=swap">`;

describe("nonBlockingAppCss", () => {
  it("loads the app stylesheet without blocking the first paint, and says when it's in", () => {
    const out = nonBlockingAppCss(`<head>${APP}</head>`);
    expect(out).toContain('rel="preload" as="style" crossorigin href="/assets/index-D95M7MX3.css"');
    expect(out).toContain("this.rel='stylesheet'");
    expect(out).toContain("__roCssDone");
    // The only plain link left is the <noscript> fallback, which doesn't block.
    expect(out.replace(/<noscript>.*?<\/noscript>/g, "")).not.toContain(APP);
  });

  it("keeps a plain stylesheet for browsers without JavaScript", () => {
    const out = nonBlockingAppCss(`<head>${APP}</head>`);
    expect(out).toContain('<noscript><link rel="stylesheet" crossorigin href="/assets/index-D95M7MX3.css"></noscript>');
  });

  it("an error still releases the splash rather than holding it", () => {
    expect(nonBlockingAppCss(`<head>${APP}</head>`)).toMatch(/onerror="[^"]*__roCssDone/);
  });

  it("leaves other stylesheets (already non-blocking fonts) alone", () => {
    const html = `<head>${FONTS}${APP}</head>`;
    expect(nonBlockingAppCss(html)).toContain(FONTS);
  });

  it("a page with no app stylesheet is unchanged", () => {
    const html = `<head>${FONTS}</head>`;
    expect(nonBlockingAppCss(html)).toBe(html);
  });
});
