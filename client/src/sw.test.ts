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
  /** Storage is full: the next attempt to keep the page fails once. */
  const full = { on: false };
  const key = (r: any) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (r: any) => m.get(key(r))?.clone(),
      put: async (r: any, res: Response) => {
        if (full.on && name.includes("shell") && key(r).endsWith("/__ro_shell")) { full.on = false; throw new DOMException("full", "QuotaExceededError"); }
        m.set(key(r), res);
      },
      delete: async (r: any) => m.delete(key(r)),
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
    stores, fetch, posted, fire, navigate, get, preloadEnable, full,
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
    w.fetch.mockImplementation(async () => new Response("js v1", { headers: { "Content-Type": "text/javascript" } }));
    await (await w.get("/assets/index-AbC123.js", "script")).responded;
    // The copy is stored behind the answer, never in front of it.
    await new Promise((ok) => setTimeout(ok, 0));
    w.fetch.mockClear();
    w.fetch.mockImplementation(never);
    const r = await w.get("/assets/index-AbC123.js", "script");
    expect(await (await r.responded!).text()).toBe("js v1");
    expect(w.fetch).not.toHaveBeenCalled();
  });
});

/**
 * Reported 2026-10-01: Discover → Feed opened a blank page, and only Settings ›
 * "Repair app" (delete the caches) brought it back. A deploy that changes the app renames
 * nearly every build file; a page on the previous build asks for a name that
 * is gone; the server answered with the app's page (status 200); and this
 * worker kept that under the script's name, for good.
 */
describe("build files — only the real thing is kept", () => {
  const js = (body: string) => new Response(body, { headers: { "Content-Type": "text/javascript" } });
  /** The app's page for a build: one start script, one stylesheet. */
  const page = (b: string) => new Response(
    `<html><link rel="stylesheet" href="/assets/index-${b}.css"><script type="module" crossorigin src="/assets/index-${b}.js"></script></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
  /** A server on build `b`. A file it doesn't have: 404 (today), or the page with 200 (before). */
  const serve = (w: ReturnType<typeof makeWorld>, b: string, missing: "404" | "page" = "404") => {
    w.fetch.mockImplementation(async (req: any) => {
      const p = new URL(typeof req === "string" ? req : req.url, ORIGIN).pathname;
      if (!p.startsWith("/assets/")) return page(b);
      if (p.includes(`-${b}.`)) return js(`${p} from the network`);
      return missing === "page" ? page(b) : new Response("Not found", { status: 404 });
    });
  };
  const assetCaches = (w: ReturnType<typeof makeWorld>) => [...w.stores.keys()].filter((k) => k.includes("assets")).sort();

  it("the app's page answered in place of a script is not kept, and not passed on as OK", async () => {
    const w = makeWorld();
    serve(w, "B", "page");
    await w.install();
    const r = await w.get("/assets/Home-A.js", "script");
    expect((await r.responded!).status).toBe(404);
    await r.settle();
    // The server has the file again (a rollback, or the same name coming back).
    w.fetch.mockResolvedValue(js("the real Home"));
    expect(await (await (await w.get("/assets/Home-A.js", "script")).responded!).text()).toBe("the real Home");
  });

  it("a wrong answer an earlier worker kept is thrown out, and the network is asked", async () => {
    const w = makeWorld();
    serve(w, "A");
    await w.install();
    w.stores.get([...w.stores.keys()].find((k) => k.includes("assets"))!)!
      .set(ORIGIN + "/assets/Home-A.js", page("B"));
    const r = await w.get("/assets/Home-A.js", "script");
    expect(await (await r.responded!).text()).toBe("/assets/Home-A.js from the network");
  });

  it("keeping a new page fetches the files it starts with, so its first launch needs no network", async () => {
    const w = makeWorld();
    serve(w, "A");
    await w.install();
    await (await w.navigate("/")).settle();
    serve(w, "B");
    await (await w.navigate("/")).settle(); // answered with A; B kept behind it
    w.fetch.mockClear();
    w.fetch.mockImplementation(never);
    const launch = await w.navigate("/");
    expect(await (await launch.responded!).text()).toContain("index-B.js");
    expect(await (await (await w.get("/assets/index-B.js", "script")).responded!).text()).toContain("from the network");
    expect(await (await (await w.get("/assets/index-B.css", "style")).responded!).text()).toContain("from the network");
  });

  it("a kept page whose start script isn't kept is not opened from cache: the network answers", async () => {
    // Kept in the background, never launched; two deploys later the script is
    // gone from the server too. Opened from cache, that was a blank screen
    // with nothing running that could recover.
    const w = makeWorld();
    serve(w, "A");
    await w.install();
    for (const k of [...w.stores.keys()]) if (k.includes("assets")) w.stores.delete(k);
    serve(w, "C");
    const r = await w.navigate("/");
    expect(await (await r.responded!).text()).toContain("index-C.js");
  });

  it("…and with no network either, the kept page is still what opens", async () => {
    const w = makeWorld();
    serve(w, "A");
    await w.install();
    for (const k of [...w.stores.keys()]) if (k.includes("assets")) w.stores.delete(k);
    w.fetch.mockRejectedValue(new TypeError("offline"));
    const r = await w.navigate("/");
    expect(await (await r.responded!).text()).toContain("index-A.js");
  });

  it("only the last two builds' files are kept: a phone no longer collects every build it opened", async () => {
    const w = makeWorld();
    serve(w, "A");
    await w.install();
    for (const b of ["B", "C", "D"]) {
      serve(w, b);
      await (await w.navigate("/")).settle();
    }
    expect(assetCaches(w)).toEqual(["relay-outpost-assets-index-C", "relay-outpost-assets-index-D"]);
  });

  it("a page still running the previous build keeps its files", async () => {
    const w = makeWorld();
    serve(w, "A");
    await w.install();
    await (await w.get("/assets/Messages-A.js", "script")).settle();
    await new Promise((ok) => setTimeout(ok, 0));
    serve(w, "B");
    await (await w.navigate("/")).settle();
    w.fetch.mockImplementation(never);
    expect(await (await (await w.get("/assets/Messages-A.js", "script")).responded!).text()).toContain("Messages-A.js");
  });

  it("storage full: the build files make room, and the new page is still kept", async () => {
    const w = makeWorld();
    serve(w, "A");
    await w.install();
    serve(w, "B");
    w.full.on = true;
    await (await w.navigate("/")).settle();
    w.fetch.mockImplementation(never);
    expect(await (await (await w.navigate("/")).responded!).text()).toContain("index-B.js");
  });

  it("the old single cache, which was never emptied, is deleted when this worker takes over", async () => {
    const w = makeWorld();
    w.stores.set("relay-outpost-v7-static", new Map([[ORIGIN + "/assets/Home-old.js", page("old")]]));
    serve(w, "A");
    await w.install();
    expect([...w.stores.keys()]).not.toContain("relay-outpost-v7-static");
  });
});
