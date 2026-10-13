// @vitest-environment jsdom
/**
 * The article body survives a DOM altered outside React (crash report
 * 2026-10-13, /articles/<id>, anonymous reader on desktop Chrome: "Failed to
 * execute 'insertBefore' on 'Node'" raised while updating a link inside a
 * paragraph). Browser page translation wraps text nodes in <font>; when the
 * article then re-renders with changed structure (a newer version of the
 * article arrived, or any re-render that inserts a node), React tries to
 * insert before a text node that is no longer where it left it.
 *
 * The exact mutation on that reader's page can't be staged here (jsdom throws
 * for a moved node just as Chrome does, yet React recovered from the one we
 * staged), so these tests state only what they prove: the body is keyed by
 * the article version, so a new version replaces the whole body instead of
 * diffing a DOM it no longer owns; and a boundary redraws the body once when
 * a draw fails, and only gives up quietly on a second failure.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

vi.mock("@/lib/crash-report", () => ({ reportCrash: () => {} }));
vi.mock("@/components/NostrPost", () => ({ EmbeddedNote: () => null, MentionProfileLink: () => null }));
vi.mock("@/components/MediaRenderer", () => ({ VideoEmbed: () => null, LinkPreviewCard: () => null }));

class MemoryStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(String(key)) ?? null; }
  setItem(key: string, value: string) { this.items.set(String(key), String(value)); }
  removeItem(key: string) { this.items.delete(String(key)); }
  clear() { this.items.clear(); }
}

type Act = (cb: () => void | Promise<void>) => Promise<void>;
let act: Act;
let createRoot: typeof import("react-dom/client").createRoot;
let ArticleMarkdown: typeof import("./ArticleMarkdown").ArticleMarkdown;
let ArticleBody: typeof import("./ArticleBody").ArticleBody;
let root: ReturnType<typeof import("react-dom/client").createRoot> | null = null;

beforeAll(async () => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)", maxTouchPoints: 0 });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = (await import("react")) as unknown as { act: Act });
  ({ ArticleMarkdown } = await import("./ArticleMarkdown"));
  ({ ArticleBody } = await import("./ArticleBody"));
});
afterEach(async () => { if (root) await act(() => { root!.unmount(); }); root = null; document.body.innerHTML = ""; });
afterAll(() => { vi.unstubAllGlobals(); });

const V1 = "Read [this guide](https://x.test/guide) before the walk.\n\nMeet at the bridge.";
const V2 = "Read [**this** guide](https://x.test/guide) before the walk.\n\nMeet at the bridge, bring a lamp.";

/** What Chrome's page translation does: text nodes get wrapped in <font>. */
function translateLikeChrome(host: HTMLElement) {
  for (const a of Array.from(host.querySelectorAll("a"))) {
    const t = a.firstChild;
    if (!t || t.nodeType !== Node.TEXT_NODE) continue;
    const font = document.createElement("font");
    a.insertBefore(font, t);
    font.appendChild(t);
  }
}

describe("the article body and a DOM altered outside React", () => {
  it("a body whose first draw fails is drawn again from scratch; a second failure becomes one quiet line", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let failures = 1;
    const Flaky = ({ text }: { text: string }) => { if (failures > 0) { failures -= 1; throw new DOMException("Failed to execute 'insertBefore' on 'Node'", "NotFoundError"); } return createElement("p", null, text); };
    const { RedrawOnce } = await import("./ArticleBody");
    const { ErrorBoundary } = await import("./ErrorBoundary");
    // The same composition ArticleBody uses: the redraw inside, the quiet line outside.
    const body = (text: string) => createElement(ErrorBoundary, { fallback: createElement("div", { "data-testid": "error-post-fallback" }, "This article couldn't be shown.") },
      createElement(RedrawOnce, null, createElement(Flaky, { text })));
    const host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(body("Meet at the bridge.")); });
    expect(host.textContent).toContain("Meet at the bridge.");
    expect(host.querySelector('[data-testid="error-post-fallback"]')).toBeNull();
    failures = Number.POSITIVE_INFINITY; // a draw that never succeeds
    await act(async () => { root!.render(body("again")); });
    expect(host.querySelector('[data-testid="error-post-fallback"]')?.textContent).toContain("couldn't be shown");
  });

  it("the body, keyed by version, replaces itself and keeps the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(ArticleBody, { versionId: "v1", content: V1 })); });
    translateLikeChrome(host);
    await act(async () => { root!.render(createElement(ArticleBody, { versionId: "v2", content: V2 })); });
    expect(host.textContent).toContain("bring a lamp");
    expect(host.querySelector("strong")?.textContent).toBe("this");
  });

  it("the body, re-rendered in place over a translated DOM, redraws once instead of crashing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(ArticleBody, { versionId: "v1", content: V1 })); });
    translateLikeChrome(host);
    await act(async () => { root!.render(createElement(ArticleBody, { versionId: "v1", content: V2 })); });
    expect(host.textContent).toContain("bring a lamp");
    expect(host.querySelector('[data-testid="error-post-fallback"]')).toBeNull();
  });
});
