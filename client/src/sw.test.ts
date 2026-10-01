/**
 * The service worker (client/public/sw.js), run for real in a sandbox with a
 * fake Cache API, fetch and clients. Tests drive it only through the events a
 * browser sends it: install, activate, fetch, message.
 *
 * Launch from cache (owner-approved, 2026-09-29): opening the app never waits
 * on the network for the page itself. The cached shell answers at once; a
 * fresh copy is fetched behind it, and open pages hear when it changed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import vm from "vm";

const SRC = readFileSync(path.resolve(import.meta.dirname, "../public/sw.js"), "utf8");
const ORIGIN = "https://relayop.xyz";
const HOUR = 60 * 60 * 1000;

type Handler = (e: any) => void;

function makeWorld() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: any) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (r: any) => m.get(key(r))?.clone(),
      put: async (r: any, res: Response) => { m.set(key(r), res); },
      addAll: async (urls: string[]) => { for (const u of urls) m.set(key(u), new Response(`static ${u}`)); },
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: any) => {
      for (const m of stores.values()) { const hit = m.get(key(r)); if (hit) return hit.clone(); }
      return undefined;
    },
  };
  const posted: any[] = [];
  const clients = {
    claim: async () => {},
    matchAll: async () => [{ postMessage: (m: any) => posted.push(m) }],
  };
  const fetch = vi.fn<(req: any) => Promise<Response>>();
  const handlers: Record<string, Handler[]> = {};
  let now = 1_000_000_000_000;
  const preloadEnable = vi.fn(async () => {});
  const self: any = {
    addEventListener: (t: string, h: Handler) => { (handlers[t] ||= []).push(h); },
    skipWaiting: () => {},
    clients,
    registration: { navigationPreload: { enable: preloadEnable } },
    location: { origin: ORIGIN },
  };
  const DateShim = class extends Date { static now() { return now; } } as any;
  const ctx = vm.createContext({
    self, caches, fetch, Response, Request, Headers, URL, Promise, setTimeout, clearTimeout, console, Date: DateShim,
  });
  vm.runInContext(SRC, ctx);

  async function fire(type: string, init: any = {}) {
    let responded: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    const e = {
      ...init,
      respondWith: (p: any) => { responded = Promise.resolve(p); },
      waitUntil: (p: any) => { waits.push(Promise.resolve(p)); },
    };
    for (const h of handlers[type] || []) h(e);
    return { responded, settle: () => Promise.all(waits) };
  }
  const navigate = (p: string, preload?: Response) =>
    fire("fetch", {
      request: { url: ORIGIN + p, method: "GET", mode: "navigate", destination: "document" },
      preloadResponse: Promise.resolve(preload),
    });
  const get = (p: string, destination = "") =>
    fire("fetch", { request: { url: ORIGIN + p, method: "GET", mode: "cors", destination } });

  return {
    stores, fetch, posted, fire, navigate, get, preloadEnable,
    advance: (ms: number) => { now += ms; },
    async install() { await (await fire("install")).settle(); await (await fire("activate")).settle(); },
  };
}

const html = (build: string) => new Response(`<html><!-- ${build} --></html>`, { headers: { "Content-Type": "text/html" } });
const never = () => new Promise<Response>(() => {});

describe("installing", () => {
  it("keeps the page, so the very next launch already opens from cache", async () => {
    const w = makeWorld();
    w.fetch.mockResolvedValue(html("A"));
    await w.install();
    w.fetch.mockImplementation(never);
    const r = await w.navigate("/messages");
    const res = await Promise.race([r.responded!, new Promise<string>((ok) => setTimeout(() => ok("waited"), 50))]);
    expect(typeof res).not.toBe("string");
    expect(await (res as Response).text()).toContain("A");
  });

  it("an install with no network still installs", async () => {
    const w = makeWorld();
    w.fetch.mockRejectedValue(new TypeError("offline"));
    await expect(w.install()).resolves.toBeUndefined();
  });
});

describe("opening the app", () => {
  let w: ReturnType<typeof makeWorld>;
  beforeEach(async () => {
    w = makeWorld();
    await w.install();
  });

  it("the first open has no cached page: it comes from the network and is kept", async () => {
    w.fetch.mockResolvedValue(html("A"));
    const r = await w.navigate("/messages");
    expect(await (await r.responded!).text()).toContain("A");
    await r.settle();
    w.fetch.mockImplementation(never);
    const again = await w.navigate("/");
    expect(await (await again.responded!).text()).toContain("A");
  });

  it("with a cached page, answers at once even when the network hangs", async () => {
    w.fetch.mockResolvedValue(html("A"));
    await (await w.navigate("/")).settle();
    w.fetch.mockImplementation(never);
    const r = await w.navigate("/messages");
    const res = await Promise.race([r.responded!, new Promise<string>((ok) => setTimeout(() => ok("waited"), 50))]);
    expect(typeof res).not.toBe("string");
    expect(await (res as Response).text()).toContain("A");
  });

  it("fetches the fresh page behind it; a changed page is kept and open pages are told", async () => {
    w.fetch.mockResolvedValue(html("A"));
    await (await w.navigate("/")).settle();
    w.fetch.mockResolvedValue(html("B"));
    const r = await w.navigate("/");
    expect(await (await r.responded!).text()).toContain("A");
    await r.settle();
    expect(w.posted).toEqual([{ type: "ro-shell-updated" }]);
    const next = await w.navigate("/");
    expect(await (await next.responded!).text()).toContain("B");
  });

  it("an unchanged page tells nobody", async () => {
    w.fetch.mockImplementation(async () => html("A"));
    await (await w.navigate("/")).settle();
    await (await w.navigate("/")).settle();
    expect(w.posted).toEqual([]);
  });

  it("uses the browser's navigation preload for the fresh copy instead of a second request", async () => {
    w.fetch.mockResolvedValue(html("A"));
    await (await w.navigate("/")).settle();
    w.fetch.mockClear();
    const r = await w.navigate("/", html("B"));
    await r.settle();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.posted).toEqual([{ type: "ro-shell-updated" }]);
  });

  it("turns navigation preload on", () => {
    expect(w.preloadEnable).toHaveBeenCalled();
  });

  // Until 2026-10-01 a page cached over a day ago asked the network first and
  // waited up to 3 s for it. On a phone the first open of the day is the usual
  // open, and it sat on the launch image for the whole cold-radio round trip
  // (0.8 s to first paint on a 600 ms RTT in Chromium, against 0.18 s from
  // cache). The reason for the wait — a build whose lazy chunks are gone — is
  // handled on the page side now (lib/sw-shell.ts, lib/update-policy.ts).
  it("a page cached over a day ago is answered at once too, even on a dead network", async () => {
    w.fetch.mockResolvedValue(html("A"));
    await (await w.navigate("/")).settle();
    w.advance(25 * HOUR);
    w.fetch.mockImplementation(never);
    const r = await w.navigate("/");
    const res = await Promise.race([r.responded!, new Promise<string>((ok) => setTimeout(() => ok("waited"), 50))]);
    expect(typeof res).not.toBe("string");
    expect(await (res as Response).text()).toContain("A");
  });

  it("…and the fresh page is kept behind it for the next launch", async () => {
    w.fetch.mockResolvedValue(html("A"));
    await (await w.navigate("/")).settle();
    w.advance(25 * HOUR);
    w.fetch.mockResolvedValue(html("B"));
    const r = await w.navigate("/");
    expect(await (await r.responded!).text()).toContain("A");
    await r.settle();
    expect(w.posted).toEqual([{ type: "ro-shell-updated" }]);
    expect(await (await (await w.navigate("/")).responded!).text()).toContain("B");
  });

  it("offline with nothing cached says so", async () => {
    w.fetch.mockRejectedValue(new TypeError("offline"));
    const r = await w.navigate("/");
    expect((await r.responded!).status).toBe(503);
  });

  it("leaves pages that aren't the app to the network", async () => {
    for (const p of ["/api/version", "/.well-known/concord/av", "/sitemap.xml", "/maintenance.html"]) {
      const r = await w.navigate(p);
      if (p.startsWith("/api/")) continue; // /api keeps its own network-first handling
      expect(r.responded, p).toBeUndefined();
    }
  });
});

describe("restarting onto a new version", () => {
  it("on request, fetches the page fresh and replies once it's kept, so the reload lands on it", async () => {
    const w = makeWorld();
    await w.install();
    w.fetch.mockResolvedValue(html("A"));
    await (await w.navigate("/")).settle();
    w.fetch.mockResolvedValue(html("B"));
    const replies: any[] = [];
    const m = await w.fire("message", { data: { type: "ro-refresh-shell" }, ports: [{ postMessage: (x: any) => replies.push(x) }] });
    await m.settle();
    expect(replies).toEqual([{ ok: true }]);
    w.fetch.mockImplementation(never);
    expect(await (await (await w.navigate("/")).responded!).text()).toContain("B");
  });

  it("replies not-ok when the network can't give a fresh page", async () => {
    const w = makeWorld();
    await w.install();
    w.fetch.mockRejectedValue(new TypeError("offline"));
    const replies: any[] = [];
    await (await w.fire("message", { data: { type: "ro-refresh-shell" }, ports: [{ postMessage: (x: any) => replies.push(x) }] })).settle();
    expect(replies).toEqual([{ ok: false }]);
  });
});

describe("content-hashed files", () => {
  it("come from cache without asking the network: their name changes when they do", async () => {
    const w = makeWorld();
    await w.install();
    w.fetch.mockResolvedValue(new Response("js v1"));
    await (await w.get("/assets/index-AbC123.js", "script")).settle();
    await (await w.get("/assets/index-AbC123.js", "script")).responded;
    w.fetch.mockClear();
    w.fetch.mockImplementation(never);
    const r = await w.get("/assets/index-AbC123.js", "script");
    expect(await (await r.responded!).text()).toBe("js v1");
    expect(w.fetch).not.toHaveBeenCalled();
  });
});
