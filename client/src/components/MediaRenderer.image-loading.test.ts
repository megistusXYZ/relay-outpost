// @vitest-environment jsdom
/**
 * A feed image mounts when it comes within MEDIA_MOUNT_LEAD of view, and from
 * that moment it must actually be fetched.
 *
 * It used to carry loading="lazy" as well, which hands the fetch back to the
 * browser's own lazy loader. On WebKit that loader is clipped by the scroll
 * container exactly like a default-root IntersectionObserver: measured
 * 2026-09-10, a lazy <img> 1000px below the fold of a scroll container never
 * loads, an eager one does. So the image mounted two screens early still
 * fetched only once on screen, then settled from its placeholder to its real
 * height in view: the iOS scroll-up jump. The lead already decided when to
 * load; the attribute must not second-guess it.
 *
 * Server-rendered under jsdom, which has no IntersectionObserver, so the image
 * counts as near: the same state it is in once the lead has fired.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { Event } from "nostr-tools";

/*
 * The browser this component expects, supplied by hand. Everything is loaded
 * by dynamic import AFTER these are in place, because the app's modules touch
 * them the moment they are imported:
 *
 *  - localStorage: settings sync hooks it on import. Local Node 26 defines its
 *    own `localStorage` getter (returning undefined) that shadows jsdom's, and
 *    Node 20 (CI) has none, which test:ci-globals mimics.
 *  - navigator: react-dom reads it on import once jsdom says "browser", and
 *    test:ci-globals deletes it (jsdom's included).
 *  - WebSocket: the nostr modules open relay sockets as a side effect. A unit
 *    test must not reach real relays, so this socket never connects.
 */
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

let MediaRenderer: typeof import("./MediaRenderer").MediaRenderer;
let renderToString: typeof import("react-dom/server").renderToString;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;

beforeAll(async () => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("WebSocket", InertWebSocket);
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)", maxTouchPoints: 0 });
  ({ renderToString } = await import("react-dom/server"));
  ({ QueryClient, QueryClientProvider } = await import("@tanstack/react-query"));
  ({ MediaRenderer } = await import("./MediaRenderer"));
});

afterAll(() => { vi.unstubAllGlobals(); });

function render(content: string): string {
  const event = {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    created_at: 1_789_000_000,
    kind: 1,
    tags: [],
    content,
    sig: "c".repeat(128),
  } as Event;
  const client = new QueryClient();
  return renderToString(createElement(QueryClientProvider, { client }, createElement(MediaRenderer, { event })));
}

const imageTags = (html: string) => html.match(/<img [^>]*alt="User-shared image"[^>]*>/g) ?? [];

describe("MediaRenderer — a feed image mounted by the lead", () => {
  it("is fetched right away, not deferred to the browser's clipped lazy loader", () => {
    const tags = imageTags(render("GM https://example.com/photo.jpg"));
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('loading="eager"');
  });
});
