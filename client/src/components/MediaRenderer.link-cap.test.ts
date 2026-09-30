// @vitest-environment jsdom
/**
 * A post's links: previews for the first few, the rest as plain links.
 *
 * Measured 2026-09-30: a spam author's profile froze the page for over a
 * minute, on production and dev alike. One of their posts carries 285
 * distinct links, and every link got its own preview card, each asking our
 * server for the page's preview and each also re-reading the previews of every
 * earlier link (~40,000 react-query lookups for the one post, re-sorted on
 * every render). Cards stop after MAX_LINK_PREVIEWS; the other links are still
 * there, behind "N more links", as plain links that fetch nothing.
 *
 * Harness notes as in MediaRenderer.image-loading.test.ts: the browser globals
 * are supplied before the app's modules load.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { Event } from "nostr-tools";

class MemoryStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(String(key)) ?? null; }
  setItem(key: string, value: string) { this.items.set(String(key), String(value)); }
  removeItem(key: string) { this.items.delete(String(key)); }
  clear() { this.items.clear(); }
}

class InertWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = InertWebSocket.CONNECTING;
  constructor(url: string | URL) { this.url = String(url); }
  send() {}
  close() { this.readyState = InertWebSocket.CLOSED; }
  addEventListener() {}
  removeEventListener() {}
}

type Act = (cb: () => void | Promise<void>) => Promise<void>;
let act: Act;
let MediaRenderer: typeof import("./MediaRenderer").MediaRenderer;
let MAX_LINK_PREVIEWS: number;
let createRoot: typeof import("react-dom/client").createRoot;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;
let root: ReturnType<typeof import("react-dom/client").createRoot> | null = null;

beforeAll(async () => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("WebSocket", InertWebSocket);
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)", maxTouchPoints: 0 });
  // Link previews never answer here: the cards stay in their loading state.
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = (await import("react")) as unknown as { act: Act });
  ({ QueryClient, QueryClientProvider } = await import("@tanstack/react-query"));
  ({ MediaRenderer, MAX_LINK_PREVIEWS } = await import("./MediaRenderer"));
});

afterEach(async () => {
  if (root) await act(() => { root!.unmount(); });
  root = null;
  document.body.innerHTML = "";
});

afterAll(() => { vi.unstubAllGlobals(); });

const links = (n: number) => Array.from({ length: n }, (_, i) => `https://blog${i}.example.com/p/${i}`);

async function show(urls: string[]) {
  const event = {
    id: "a".repeat(64), pubkey: "b".repeat(64), created_at: 1_789_000_000, kind: 1, tags: [],
    content: urls.map((u, i) => `#story${i} ${u}`).join("\n"), sig: "c".repeat(128),
  } as Event;
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: () => new Promise(() => {}) } } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(() => { root!.render(createElement(QueryClientProvider, { client }, createElement(MediaRenderer, { event }))); });
  const previewLookups = () => client.getQueryCache().getAll().filter((q) => String(q.queryKey[0]).startsWith("/api/og")).length;
  return { host, previewLookups };
}

const cards = (host: HTMLElement) => host.querySelectorAll('[data-testid="media-link-loading"], [data-testid="media-link-preview"]');
const moreButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-testid="button-more-links"]');

describe("a post with many links", () => {
  it("previews only the first few, and asks for only their previews", async () => {
    const { host, previewLookups } = await show(links(40));
    expect(MAX_LINK_PREVIEWS).toBe(3);
    expect(cards(host)).toHaveLength(3);
    expect(previewLookups()).toBe(3);
  });

  it("keeps every other link one tap away, as plain links", async () => {
    const urls = links(40);
    const { host, previewLookups } = await show(urls);
    const more = moreButton(host)!;
    expect(more.textContent).toContain("37 more links");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await act(() => { more.click(); });
    const plain = [...host.querySelectorAll<HTMLAnchorElement>('[data-testid="more-links-list"] a')].map((a) => a.href);
    expect(plain).toEqual(urls.slice(3).map((u) => new URL(u).href));
    expect(previewLookups()).toBe(3);
  });

  it("a post with only a few links looks as before: a card each, no list", async () => {
    const { host } = await show(links(3));
    expect(cards(host)).toHaveLength(3);
    expect(moreButton(host)).toBeNull();
  });
});
