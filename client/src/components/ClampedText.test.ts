// @vitest-environment jsdom
/**
 * The standard for long text (owner, 2026-09-30): a reply's "replying to"
 * preview ran to 21,450 px, and post text was cut at 300 characters, which
 * never cut a long list of short lines. Text is now limited by the lines it
 * takes on screen, and "Show more" appears only when something is hidden.
 *
 * jsdom has no layout, so "is anything hidden" is set by the test: the text
 * box reports it overflows when `hidden` is true, exactly as a browser
 * reports scrollHeight > clientHeight for a cut-off box.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

type Act = (cb: () => void | Promise<void>) => Promise<void>;
let act: Act;
let createRoot: typeof import("react-dom/client").createRoot;
let ClampedText: typeof import("./ClampedText").ClampedText;
let textForLines: typeof import("./ClampedText").textForLines;
let root: ReturnType<typeof import("react-dom/client").createRoot> | null = null;
let hidden = false;

beforeAll(async () => {
  // react-dom reads navigator on import; test:ci-globals deletes it.
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)" });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return hidden ? 500 : 100; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 100; } });
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = (await import("react")) as unknown as { act: Act });
  ({ ClampedText, textForLines } = await import("./ClampedText"));
});

afterEach(async () => {
  if (root) await act(() => { root!.unmount(); });
  root = null;
  hidden = false;
  document.body.innerHTML = "";
});

async function show(props: Record<string, unknown>, onParentClick = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(() => {
    root!.render(createElement("div", { onClick: onParentClick, "data-testid": "post" },
      createElement(ClampedText, { testId: "text", toggleTestId: "more", ...props }, "a long post\n".repeat(40))));
  });
  return {
    text: () => document.querySelector('[data-testid="text"]') as HTMLElement,
    more: () => document.querySelector('[data-testid="more"]') as HTMLButtonElement | null,
    onParentClick,
  };
}

describe("ClampedText", () => {
  it("cuts the text at its line limit", async () => {
    hidden = true;
    const v = await show({ lines: 8 });
    expect(v.text().getAttribute("data-clamp-lines")).toBe("8");
  });

  it("shows Show more only when the limit actually hides text", async () => {
    hidden = true;
    expect((await show({ lines: 8 })).more()?.textContent).toBe("Show more");
    await act(() => { root!.unmount(); }); root = null; document.body.innerHTML = "";
    hidden = false;
    expect((await show({ lines: 8 })).more()).toBeNull();
  });

  it("Show more gives back all the text, and Show less cuts it again", async () => {
    hidden = true;
    const v = await show({ lines: 8 });
    await act(() => { v.more()!.click(); });
    expect(v.text().hasAttribute("data-clamp-lines")).toBe(false);
    expect(v.more()!.textContent).toBe("Show less");
    expect(v.more()!.getAttribute("aria-expanded")).toBe("true");
    await act(() => { v.more()!.click(); });
    expect(v.text().getAttribute("data-clamp-lines")).toBe("8");
    expect(v.more()!.textContent).toBe("Show more");
  });

  it("tapping Show more doesn't also open the post it sits in", async () => {
    hidden = true;
    const v = await show({ lines: 8 });
    await act(() => { v.more()!.click(); });
    expect(v.onParentClick).not.toHaveBeenCalled();
  });

  it("context previews are cut with no Show more: tapping them opens the post", async () => {
    hidden = true;
    const v = await show({ lines: 3, expandable: false });
    expect(v.text().getAttribute("data-clamp-lines")).toBe("3");
    expect(v.more()).toBeNull();
  });

  it("with no limit (the post you opened), everything shows and there's no Show more", async () => {
    hidden = true;
    const v = await show({ lines: undefined });
    expect(v.text().hasAttribute("data-clamp-lines")).toBe(false);
    expect(v.more()).toBeNull();
  });
});

/**
 * While text is cut, a surface renders only enough of it to fill its lines
 * many times over. Rendering all of it and hiding the rest cost the full
 * render of a 46,238-character, 1,195-line post in every feed it appeared in;
 * the old 300-character rule had at least bounded that.
 */
describe("textForLines", () => {
  const long = "word ".repeat(5000);

  it("while cut, keeps enough to fill the lines several times over, and no more", () => {
    const out = textForLines(long, 8, false);
    expect(out.length).toBeGreaterThan(8 * 100);
    expect(out.length).toBeLessThanOrEqual(8 * 240 + 1);
    expect(out.endsWith("…")).toBe(true);
  });

  it("ends on a whole word", () => {
    const out = textForLines(long, 8, false);
    expect(out.slice(0, -1).endsWith("word")).toBe(true);
  });

  it("short text, expanded text, and text with no limit are left whole", () => {
    expect(textForLines("a short post", 8, false)).toBe("a short post");
    expect(textForLines(long, 8, true)).toBe(long);
    expect(textForLines(long, undefined, false)).toBe(long);
  });
});

describe("ClampedText, told from outside whether it's expanded", () => {
  it("shows the state it's given, and reports taps instead of keeping its own", async () => {
    hidden = true;
    const onExpandedChange = vi.fn();
    const v = await show({ lines: 8, expanded: false, onExpandedChange });
    await act(() => { v.more()!.click(); });
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(v.text().getAttribute("data-clamp-lines")).toBe("8"); // unchanged until the owner says so
  });
});

/**
 * Every surface that shows someone's text uses the standard, with the limit
 * the owner chose for it. A surface that renders text without it is how the
 * 21,450 px preview happened.
 */
describe("every surface uses the standard", () => {
  const read = (rel: string) => require("fs").readFileSync(require("path").resolve(__dirname, rel), "utf8") as string;

  it.each([
    ["the 'replying to' preview", "./nostr-post/thread-lite.tsx", /<ClampedText[^>]*lines=\{LINES\.context\}[^>]*expandable=\{false\}[^>]*testId=\{`text-parent-content-/],
    ["a quoted post", "./NostrPost.tsx", /<ClampedText[^>]*lines=\{LINES\.context\}[^>]*expandable=\{false\}[^>]*testId=\{`embedded-note-text-/],
    ["post text", "./NostrPost.tsx", /<ClampedText[^>]*lines=\{focused \? undefined : LINES\.post\}[^>]*testId=\{`text-content-/],
    ["a reply in a thread", "./nostr-post/thread.tsx", /<ClampedText[^>]*lines=\{LINES\.post\}[^>]*testId=\{`text-thread-content-/],
    ["a comment", "./CommentContent.tsx", /<ClampedText[^>]*lines=\{LINES\.comment\}/],
    ["a direct message", "../pages/Messages.tsx", /<ClampedText[^>]*lines=\{LINES\.chat\}[^>]*testId="dm-message-text"/],
    ["a group chat message", "./concord/ConcordChat.tsx", /<ClampedText[^>]*lines=\{LINES\.chat\}[^>]*testId=\{`group-message-text-/],
  ])("%s", (_name, file, pattern) => {
    expect(read(file as string).replace(/\s+/g, " ")).toMatch(pattern as RegExp);
  });

  it("post text and replies no longer cut by characters", () => {
    expect(read("./NostrPost.tsx")).not.toMatch(/TRUNCATE_CHARS/);
    expect(read("./nostr-post/thread.tsx")).not.toMatch(/REPLY_TRUNCATE_CHARS/);
  });
});

describe("every surface renders only what its lines can show while cut", () => {
  const read = (rel: string) => require("fs").readFileSync(require("path").resolve(__dirname, rel), "utf8") as string;
  it.each([
    ["post text", "./NostrPost.tsx", /textForLines\(proseText, LINES\.post, isExpanded\)/],
    ["a reply in a thread", "./nostr-post/thread.tsx", /textForLines\(replyProse, LINES\.post, replyExpanded\)/],
    ["the 'replying to' preview", "./nostr-post/thread-lite.tsx", /textForLines\(event\.content[\s\S]{0,80}?LINES\.context, false\)/],
    ["a comment", "./CommentContent.tsx", /textForLines\([^)]*LINES\.comment, expanded\)/],
    ["a direct message", "../pages/Messages.tsx", /textForLines\(displayText, LINES\.chat, expanded\)/],
    ["a group chat message", "./concord/ConcordChat.tsx", /textForLines\(shownText, LINES\.chat, textExpanded\)/],
  ])("%s", (_name, file, pattern) => {
    expect(read(file as string)).toMatch(pattern as RegExp);
  });
});
