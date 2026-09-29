/**
 * The launch splash in client/index.html, run for real: its inline scripts
 * execute in jsdom on a fake clock, and the tests drive it only through the
 * hooks the app uses (window.__roHideSplash, window.__roSplashRelay).
 *
 * Owner-approved launch (2026-09-29): never longer than the real wait; the
 * loop trace and the relay ring appear only once there is a wait (400 ms);
 * a ring dot lights only when that relay really connected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import path from "path";

const HTML = readFileSync(path.resolve(import.meta.dirname, "../index.html"), "utf8")
  // The app bundle isn't under test; only the inline scripts are.
  .replace(/<script type="module"[^>]*><\/script>/g, "");

/** A stand-in socket: records who was dialled, and lets a test open or fail it. */
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeSocket.all.push(this); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
}

function boot(opts: { sockets?: boolean; blocked?: string[] } = {}) {
  FakeSocket.all = [];
  const dom = new JSDOM(HTML, {
    url: "https://relayop.xyz/",
    runScripts: "dangerously",
    beforeParse(window: any) {
      window.setTimeout = globalThis.setTimeout;
      window.clearTimeout = globalThis.clearTimeout;
      window.Date = globalThis.Date;
      // Ring-logic tests drive __roSplashRelay by hand, with no sockets.
      window.WebSocket = opts.sockets ? FakeSocket : undefined;
      if (opts.blocked) window.localStorage.setItem("nostr_blocked_relays", JSON.stringify(opts.blocked));
    },
  });
  const w = dom.window as any;
  const splash = () => w.document.getElementById("ro-splash") as HTMLElement | null;
  const dots = () => [...(splash()?.querySelectorAll(".ro-splash-ring i") ?? [])] as HTMLElement[];
  const lit = () => dots().filter((d) => d.classList.contains("on")).length;
  const status = () => w.document.getElementById("ro-splash-status")?.textContent ?? "";
  return { w, splash, dots, lit, status };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("never longer than the real wait", () => {
  it("an app ready in 300 ms fades the splash at once, with no brand beat", () => {
    const s = boot();
    vi.advanceTimersByTime(300);
    s.w.__roHideSplash();
    expect(s.splash()!.classList.contains("ro-splash-hide")).toBe(true);
    expect(s.splash()!.classList.contains("ro-splash-waiting")).toBe(false);
  });

  it("a quick hide never turns the wait on afterwards", () => {
    const s = boot();
    vi.advanceTimersByTime(200);
    s.w.__roHideSplash();
    vi.advanceTimersByTime(300);
    expect(s.splash()?.classList.contains("ro-splash-waiting") ?? false).toBe(false);
  });

  it("the splash is gone, and the page off its boot colour, once the fade ends", () => {
    const s = boot();
    s.w.__roHideSplash();
    vi.advanceTimersByTime(700);
    expect(s.splash()).toBeNull();
    expect(s.w.document.documentElement.classList.contains("ro-booting")).toBe(false);
  });
});

describe("a real wait shows the trace and the ring", () => {
  it("still loading at 400 ms: the splash starts waiting", () => {
    const s = boot();
    vi.advanceTimersByTime(399);
    expect(s.splash()!.classList.contains("ro-splash-waiting")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(s.splash()!.classList.contains("ro-splash-waiting")).toBe(true);
  });

  it("still offers Reload when nothing arrives for 9 s", () => {
    const s = boot();
    vi.advanceTimersByTime(9000);
    expect(s.splash()!.classList.contains("ro-splash-stuck")).toBe(true);
  });
});

describe("the ring is honest", () => {
  const A = "wss://relay.damus.io", B = "wss://nos.lol", C = "wss://relay.primal.net";

  it("one unlit dot per relay being opened; a dot lights only when its relay connects", () => {
    const s = boot();
    s.w.__roSplashRelay(A, "open");
    s.w.__roSplashRelay(B, "open");
    expect(s.dots()).toHaveLength(2);
    expect(s.lit()).toBe(0);
    expect(s.status()).toBe("Connecting 0 of 2");
    s.w.__roSplashRelay(B, "up");
    expect(s.lit()).toBe(1);
    expect(s.status()).toBe("Connected 1 of 2");
  });

  it("the same relay opened or connected twice is still one dot", () => {
    const s = boot();
    s.w.__roSplashRelay(A, "open");
    s.w.__roSplashRelay(A, "open");
    s.w.__roSplashRelay(A, "up");
    s.w.__roSplashRelay(A, "up");
    expect(s.dots()).toHaveLength(1);
    expect(s.status()).toBe("Connected 1 of 1");
  });

  it("a relay that never connects keeps its dot unlit", () => {
    const s = boot();
    s.w.__roSplashRelay(A, "open");
    s.w.__roSplashRelay(C, "open");
    s.w.__roSplashRelay(A, "up");
    vi.advanceTimersByTime(5000);
    expect(s.lit()).toBe(1);
    expect(s.status()).toBe("Connected 1 of 2");
  });

  it("shows at most 8 dots, and counts only the relays it shows", () => {
    const s = boot();
    for (let i = 0; i < 12; i++) s.w.__roSplashRelay(`wss://r${i}.example`, "open");
    for (let i = 0; i < 12; i++) s.w.__roSplashRelay(`wss://r${i}.example`, "up");
    expect(s.dots()).toHaveLength(8);
    expect(s.status()).toBe("Connected 8 of 8");
  });

  it("reports after the splash is gone are ignored", () => {
    const s = boot();
    s.w.__roHideSplash();
    vi.advanceTimersByTime(700);
    expect(() => s.w.__roSplashRelay(A, "open")).not.toThrow();
  });
});

describe("the splash knocks on the fast relays itself, from the first frame", () => {
  // The app opens its relays only once its JavaScript runs, which is also when
  // it mounts and the splash lifts, so its reports alone could never light a
  // dot during the wait people actually see (measured on the production build
  // through a throttled proxy: "Connecting 0 of 4" at the moment of hand-off).
  const FAST = (() => {
    const src = readFileSync(path.resolve(import.meta.dirname, "lib/nostr.ts"), "utf8");
    const body = src.match(/export const FAST_RELAYS = \[([^\]]*)\]/)![1];
    return [...body.matchAll(/"(wss:\/\/[^"]+)"/g)].map((m) => m[1]);
  })();

  it("dials the app's fast relays (FAST_RELAYS), one dot each", () => {
    const s = boot({ sockets: true });
    expect(FAST.length).toBeGreaterThan(0);
    expect(FakeSocket.all.map((x) => x.url)).toEqual(FAST);
    expect(s.dots()).toHaveLength(FAST.length);
    expect(s.status()).toBe(`Connecting 0 of ${FAST.length}`);
  });

  it("a dot lights when its socket really opens, and the socket is closed straight after", () => {
    const s = boot({ sockets: true });
    FakeSocket.all[1].open();
    expect(s.lit()).toBe(1);
    expect(s.dots()[1].classList.contains("on")).toBe(true);
    expect(FakeSocket.all[1].closed).toBe(true);
    expect(s.status()).toBe(`Connected 1 of ${FAST.length}`);
  });

  it("a relay that errors stays unlit", () => {
    const s = boot({ sockets: true });
    FakeSocket.all[0].onerror?.();
    expect(s.lit()).toBe(0);
  });

  it("never dials a relay you blocked", () => {
    boot({ sockets: true, blocked: [FAST[0].replace("wss://", "") + "/"] });
    expect(FakeSocket.all.map((x) => x.url)).toEqual(FAST.slice(1));
  });

  it("closes the sockets still dialling when the splash goes", () => {
    const s = boot({ sockets: true });
    s.w.__roHideSplash();
    expect(FakeSocket.all.every((x) => x.closed)).toBe(true);
  });

  it("the app's own reports of the same relays don't add dots", () => {
    const s = boot({ sockets: true });
    s.w.__roSplashRelay(FAST[0], "open");
    s.w.__roSplashRelay(FAST[0], "up");
    expect(s.dots()).toHaveLength(FAST.length);
    expect(s.lit()).toBe(1);
  });
});
