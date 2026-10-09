/**
 * A Shosho announcement in a post (owner, 2026-10-09: "why isn't this post
 * showing the live stream?"). The post links the streamer's Shosho PAGE, not
 * the stream. When that person has a live stream we can play, the card is
 * ours and opens our player; when they don't, it says "Watch on Shosho" and
 * opens their page. Server-rendered with the live index stubbed.
 */
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { Router } from "wouter";

const STREAMER = "20651ab8c2fb1febca56b80deba14630af452bdce64fe8f04a9f5f67e4a3c1cc";
const liveFor = new Map<string, unknown>();
vi.mock("@/contexts/LiveStatusContext", () => ({
  useLiveStatus: () => ({ getLiveStream: (pk: string) => liveFor.get(pk), isUserLive: (pk: string) => liveFor.has(pk), livePubkeys: new Set(liveFor.keys()) }),
}));

// The renderer's module graph touches storage and sockets at import time (as
// LinkPreviewCard.nostr.test.ts found): inert stand-ins, then import.
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
let ShoshoCard: typeof import("./MediaRenderer").ShoshoCard;
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
beforeAll(async () => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("WebSocket", InertWebSocket);
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)", maxTouchPoints: 0 });
  ({ renderToStaticMarkup } = await import("react-dom/server"));
  ({ ShoshoCard } = await import("./MediaRenderer"));
});
afterAll(() => { vi.unstubAllGlobals(); });
const render = (host: string) => renderToStaticMarkup(createElement(Router, { ssrPath: "/thread/x" }, createElement(ShoshoCard, { url: "https://shosho.live/jeeef", host })));
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("a Shosho announcement", () => {
  it("with nothing live to play: 'Watch on Shosho', opening their page elsewhere", () => {
    const html = render(STREAMER);
    expect(words(html)).toMatch(/Watch on Shosho/);
    expect(words(html)).toMatch(/shosho\.live\/jeeef/);
    expect(html).toMatch(/href="https:\/\/shosho\.live\/jeeef"/);
    expect(html).toMatch(/target="_blank"/);
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(html).not.toMatch(/href="\/live\//);
  });

  it("with the streamer live and playable: our own card, opening our player", () => {
    liveFor.set(STREAMER, { id: "e1", pubkey: STREAMER, dTag: "live-1", title: "Hollow Knight in Fortnite", summary: "", status: "live", hlsUrl: "https://x/manifest.m3u8", hashtags: [], participants: [] });
    const html = render(STREAMER);
    expect(words(html)).toMatch(/Live on Shosho/);
    expect(words(html)).toMatch(/Hollow Knight in Fortnite/);
    expect(words(html)).toMatch(/Opens in Relay Outpost/);
    expect(html).toMatch(/href="\/live\/naddr1/);
    expect(html).not.toMatch(/target="_blank"/);
    liveFor.clear();
  });

  it("a live event with no stream address is nothing to play: still 'Watch on Shosho'", () => {
    liveFor.set(STREAMER, { id: "e2", pubkey: STREAMER, dTag: "live-2", title: "", summary: "", status: "live", hashtags: [], participants: [] });
    expect(words(render(STREAMER))).toMatch(/Watch on Shosho/);
    liveFor.clear();
  });
});
