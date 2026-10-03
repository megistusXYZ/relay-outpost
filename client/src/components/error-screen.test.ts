// @vitest-environment node
/**
 * The shared error screen (owner, 2026-10-03: "on-brand 404 error pages and
 * other error pages ... light mode and dark mode, desktop and all devices").
 * Rendered to a string, no DOM: what a reader gets is in the markup.
 */
import { describe, it, expect } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import { readFileSync } from "fs";
import path from "path";
import { ErrorScreen, dotStates, type ErrorScreenProps } from "./ErrorScreen";
import NotFound from "@/pages/not-found";

const inRouter = (el: ReactElement) => renderToString(createElement(Router, { ssrPath: "/x" }, el));
const screen = (props: ErrorScreenProps) => inRouter(createElement(ErrorScreen, props));

describe("ErrorScreen", () => {
  const html = screen({
    kind: "not-found",
    title: "This page isn't here",
    body: "The link may be old.",
    primary: { label: "Go to your feed", href: "/" },
    secondary: { label: "Search", href: "/search" },
    testId: "t",
  });

  it("shows the title, the sentence and both actions", () => {
    expect(html).toContain("This page isn&#x27;t here");
    expect(html).toContain("The link may be old.");
    expect(html).toContain("Go to your feed");
    expect(html).toContain('href="/search"');
    expect(html).toContain('data-testid="t"');
  });

  it("the primary action is a 44px tap target, filled with the brand, round", () => {
    const primary = html.match(/<a[^>]*href="\/"[^>]*>/)![0];
    expect(primary).toContain("min-h-[44px]");
    expect(primary).toContain("rounded-full");
    expect(primary).toContain("bg-brand");
    // The secondary is a text link, still a full-size target.
    const secondary = html.match(/<a[^>]*href="\/search"[^>]*>/)![0];
    expect(secondary).toContain("min-h-[44px]");
    expect(secondary).not.toContain("bg-brand");
  });

  it("is calm: no bounce, no shouting title, no hard-coded colours", () => {
    expect(html).not.toContain("animate-bounce");
    const title = html.match(/<h1[^>]*>/)![0];
    expect(title).not.toMatch(/uppercase/);
    expect(html).not.toMatch(/#[0-9a-f]{6}\b/i);
    expect(html).not.toMatch(/\b(?:red|amber|yellow|green)-\d00/);
  });

  it("only fades in when motion is welcome", () => {
    expect(html).toContain("motion-safe:animate-in");
    expect(html).not.toMatch(/(?<!motion-safe:)animate-in/);
  });

  it("buttons, not links, when the action is a callback; disabled while busy", () => {
    const out = screen({ kind: "broken", title: "x", primary: { label: "Refreshing…", onClick: () => {}, disabled: true, testId: "b" } });
    expect(out).toMatch(/<button[^>]*disabled[^>]*data-testid="b"/);
  });

  it("keeps the raw error behind a Details disclosure", () => {
    const out = screen({ kind: "broken", title: "x", detail: "TypeError: boom" });
    expect(out).toMatch(/<details[\s\S]*<summary[^>]*>Details[\s\S]*TypeError: boom[\s\S]*<\/details>/);
    expect(screen({ kind: "broken", title: "x" })).not.toContain("<details");
  });

  it("headings follow the layout: page h1, section h2, inline a plain line", () => {
    expect(screen({ kind: "broken", title: "T", layout: "page" })).toMatch(/<h1[^>]*>T<\/h1>/);
    expect(screen({ kind: "broken", title: "T", layout: "section" })).toMatch(/<h2[^>]*>T<\/h2>/);
    const inline = screen({ kind: "broken", title: "T", layout: "inline" });
    expect(inline).not.toMatch(/<h[12]/);
    expect(inline).toContain("rounded-2xl");
  });

  it("the ring tells the story: one dot missing, all dark, or a hollow link", () => {
    const count = (k: Parameters<typeof dotStates>[0], s: string) => dotStates(k).filter((d) => d === s).length;
    expect(dotStates("not-found")).toHaveLength(8);
    expect(count("not-found", "hollow")).toBe(1);
    expect(count("not-found", "lit")).toBe(7);
    expect(count("offline", "unlit")).toBe(8);
    expect(count("unreachable", "unlit")).toBe(8);
    expect(count("link", "hollow")).toBe(8);
    expect(count("denied", "lit")).toBe(8);
    // ...and the mark goes quiet when something broke.
    expect(screen({ kind: "broken", title: "x" })).toMatch(/text-muted-foreground\/70/);
    expect(screen({ kind: "not-found", title: "x" })).not.toMatch(/<svg[^>]*text-muted-foreground/);
  });
});

describe("the 404", () => {
  const html = inRouter(createElement(NotFound));
  it("reads calmly and offers the feed and search", () => {
    expect(html).toContain("This page isn&#x27;t here");
    expect(html).toContain("Everything else is right where you left it.");
    expect(html).toContain("Go to your feed");
    expect(html).toContain('href="/search"');
    expect(html).not.toMatch(/404|Not Found/);
  });
});

describe("error copy", () => {
  it("no em-dashes and no apologies in what readers see", () => {
    const files = [
      "components/ErrorScreen.tsx",
      "components/ErrorBoundary.tsx",
      "components/FeedErrorBoundary.tsx",
      "components/RootErrorBoundary.tsx",
      "pages/not-found.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(path.resolve(import.meta.dirname, "..", f), "utf8");
      // Only string literals and JSX text: drop comments first.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, f).not.toMatch(/—/);
      expect(code, f).not.toMatch(/\bsorry\b/i);
    }
  });
});
