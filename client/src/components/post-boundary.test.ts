// @vitest-environment jsdom
/**
 * One broken post never takes a page down (owner, 2026-10-07). A thread went
 * to "This page didn't load" because one post above it couldn't be drawn; Home
 * already kept each post apart, the rest of the app did not. A post that
 * fails to draw becomes one quiet line, and everything around it stays.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/crash-report", () => ({ reportCrash: () => {} }));

type Act = (cb: () => void | Promise<void>) => Promise<void>;
let act: Act;
let createRoot: typeof import("react-dom/client").createRoot;
let PostBoundary: typeof import("./PostBoundary").PostBoundary;
beforeAll(async () => {
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)" });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = (await import("react")) as unknown as { act: Act });
  ({ PostBoundary } = await import("./PostBoundary"));
});
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

function Broken(): never { throw new TypeError("Cannot read properties of undefined (reading 'slice')"); }
const Fine = ({ text }: { text: string }) => createElement("p", null, text);

describe("a post that can't be drawn", () => {
  it("becomes one quiet line, and the posts around it stay", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      createRoot(host).render(createElement("div", null,
        createElement(PostBoundary, { id: "a" }, createElement(Fine, { text: "The post before" })),
        createElement(PostBoundary, { id: "b" }, createElement(Broken)),
        createElement(PostBoundary, { id: "c" }, createElement(Fine, { text: "The post after" })),
      ));
    });
    expect(host.textContent).toContain("The post before");
    expect(host.textContent).toContain("This post couldn't be shown");
    expect(host.textContent).toContain("The post after");
    expect(host.querySelectorAll('[data-testid="error-post-fallback"]')).toHaveLength(1);
  });
});

describe("every list of posts keeps them apart", () => {
  // Each place the app draws a list of posts draws each one inside PostBoundary.
  const PLACES: Array<[string, RegExp]> = [
    ["pages/Thread.tsx", /<(AncestorPost|NostrPost|PollPost)\b/g],
    ["components/nostr-post/thread.tsx", /<ThreadReplyItem\b/g],
    ["pages/Home.tsx", /<(NostrPost|PollPost|ArticleFeedCard)\b/g],
    ["pages/Profile.tsx", /<NostrPost\b/g],
    ["pages/Search.tsx", /<NostrPost\b/g],
    ["pages/Bookmarks.tsx", /<NostrPost\b/g],
    ["pages/MyOutpost.tsx", /<NostrPost\b/g],
    ["pages/Community.tsx", /<NostrPost\b/g],
    ["pages/PollsFeed.tsx", /<PollPost\b/g],
  ];
  for (const [file, post] of PLACES) {
    it(`${file} draws each post inside PostBoundary`, () => {
      const src = readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
      const unguarded: number[] = [];
      for (const m of src.matchAll(post)) {
        const before = src.slice(Math.max(0, m.index! - 900), m.index!);
        const opened = before.lastIndexOf("<PostBoundary");
        const closed = before.lastIndexOf("</PostBoundary>");
        if (opened === -1 || closed > opened) unguarded.push(src.slice(0, m.index!).split("\n").length);
      }
      expect(unguarded, `posts drawn outside PostBoundary at lines ${unguarded.join(", ")}`).toEqual([]);
    });
  }
});
