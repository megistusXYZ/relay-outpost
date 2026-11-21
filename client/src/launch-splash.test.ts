/**
 * The launch splash in client/index.html, run for real: its inline scripts
 * execute in jsdom on a fake clock, and the tests drive it only through the
 * hook the app uses (window.__roHideSplash).
 *
 * Owner-approved launch (2026-09-29): never longer than the real wait; the
 * mark moves only once there is a wait (400 ms).
 * Owner, 2026-11-20: the launch screen is Relay's face and its loader, with
 * nothing around it. The ring of dots (one per relay, lit as each connected)
 * and its "Connecting 2 of 4" are gone; the early knock on the fast relays
 * stays, as a warm-up that draws nothing.
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
      window.WebSocket = opts.sockets ? FakeSocket : undefined;
      if (opts.blocked) window.localStorage.setItem("nostr_blocked_relays", JSON.stringify(opts.blocked));
    },
  });
  const w = dom.window as any;
  const splash = () => w.document.getElementById("ro-splash") as HTMLElement | null;
  /** Words in the launch screen, whether or not they are showing yet. */
  const words = () => (splash()?.textContent ?? "").replace(/\s+/g, " ").trim();
  return { w, splash, words };
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

describe("a real wait starts the mark moving", () => {
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

describe("nothing around Relay's face", () => {
  it("draws no ring of dots and no count of relays, with or without sockets", () => {
    for (const sockets of [false, true]) {
      const s = boot({ sockets });
      for (const sock of FakeSocket.all) sock.open();
      vi.advanceTimersByTime(1000);
      expect(s.splash()!.querySelector(".ro-splash-ring")).toBeNull();
      expect(s.w.document.getElementById("ro-splash-status")).toBeNull();
      expect(s.splash()!.querySelectorAll(".ro-splash-stage > *:not(.ro-splash-glow):not(svg)")).toHaveLength(0);
    }
  });

  it("gives the app no way to draw relays on it", () => {
    const s = boot();
    expect(s.w.__roSplashRelay).toBeUndefined();
  });

  it("its only words are the ones for a load that hangs", () => {
    const s = boot({ sockets: true });
    for (const sock of FakeSocket.all) sock.open();
    expect(s.words()).toBe("Taking longer than usual Reload");
  });

  it("the page's styles and script no longer mention the ring", () => {
    expect(HTML).not.toMatch(/ro-splash-ring|ro-splash-status|__roSplashRelay|roSplashPop|--ro-dot/);
  });
});

describe("the splash knocks on the fast relays itself, from the first frame", () => {
  // A warm-up: the app opens its relays only once its JavaScript runs, so the
  // launch screen dials the fast ones early and hangs up as each answers.
  const FAST = (() => {
    const src = readFileSync(path.resolve(import.meta.dirname, "lib/nostr.ts"), "utf8");
    const body = src.match(/export const FAST_RELAYS = \[([^\]]*)\]/)![1];
    return [...body.matchAll(/"(wss:\/\/[^"]+)"/g)].map((m) => m[1]);
  })();

  it("dials the app's fast relays (FAST_RELAYS)", () => {
    boot({ sockets: true });
    expect(FAST.length).toBeGreaterThan(0);
    expect(FakeSocket.all.map((x) => x.url)).toEqual(FAST);
  });

  it("a socket is closed as soon as it really opens", () => {
    boot({ sockets: true });
    expect(FakeSocket.all[1].closed).toBe(false);
    FakeSocket.all[1].open();
    expect(FakeSocket.all[1].closed).toBe(true);
    expect(FakeSocket.all[0].closed).toBe(false);
  });

  it("a relay that errors is hung up on", () => {
    boot({ sockets: true });
    FakeSocket.all[0].onerror?.();
    expect(FakeSocket.all[0].closed).toBe(true);
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

  it("with no WebSocket in the browser the launch screen still works", () => {
    const s = boot();
    vi.advanceTimersByTime(400);
    expect(s.splash()!.classList.contains("ro-splash-waiting")).toBe(true);
  });
});
