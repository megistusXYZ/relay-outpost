// @vitest-environment jsdom
/**
 * A preview card for a link to another Nostr client shows the thing natively
 * (an embedded note, profile or article card), never an external preview of
 * the other client's page (owner, 2026-09-29). Measured before: articles'
 * bare links, curated feeds and the moderation console showed an OG card that
 * opened primal/njump in a new tab.
 *
 * Server-rendered, so the lazily loaded embed shows its placeholder; what's
 * pinned here is which card is chosen. The embed itself is checked in the
 * browser.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

class MemoryStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(i: number) { return [...this.items.keys()][i] ?? null; }
  getItem(k: string) { return this.items.get(String(k)) ?? null; }
  setItem(k: string, v: string) { this.items.set(String(k), String(v)); }
  removeItem(k: string) { this.items.delete(String(k)); }
  clear() { this.items.clear(); }
}
class InertWebSocket {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly url: string; readyState = 0;
  constructor(url: string | URL) { this.url = String(url); }
  send() {} close() { this.readyState = 3; } addEventListener() {} removeEventListener() {}
}

let LinkPreviewCard: typeof import("./MediaRenderer").LinkPreviewCard;
let renderToString: typeof import("react-dom/server").renderToString;
let QueryClientProvider: typeof import("@tanstack/react-query").QueryClientProvider;
let QueryClient: typeof import("@tanstack/react-query").QueryClient;

beforeAll(async () => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("WebSocket", InertWebSocket);
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)", maxTouchPoints: 0 });
  ({ renderToString } = await import("react-dom/server"));
  ({ QueryClient, QueryClientProvider } = await import("@tanstack/react-query"));
  ({ LinkPreviewCard } = await import("./MediaRenderer"));
});
afterAll(() => { vi.unstubAllGlobals(); });

const render = (url: string) =>
  renderToString(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(LinkPreviewCard, { url })));

// A fixed id: importing nostr-tools here would let its relay pool capture the
// real WebSocket before the stub below is in place, and reach real relays.
const note = "note1hwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwashyvgw5";

describe("LinkPreviewCard for a link to another Nostr client", () => {
  it("shows the native embed, not an external preview card", () => {
    const html = render(`https://primal.net/e/${note}`);
    expect(html).toContain('data-testid="link-preview-nostr"');
    expect(html).not.toMatch(/data-testid="media-link-(loading|preview|fallback)"/);
  });

  it("an ordinary link still gets its preview card", () => {
    const html = render("https://example.com/article");
    expect(html).not.toContain('data-testid="link-preview-nostr"');
    expect(html).toMatch(/data-testid="media-link-(loading|preview|fallback)"/);
  });
});
