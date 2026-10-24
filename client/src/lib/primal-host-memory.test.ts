/**
 * Where a visit to Primal's cache starts (lib/primal-cache.ts). Measured on
 * production 2026-10-23: cache.primal.net refused every fresh load (5 of 5),
 * and each lost ~0.5 s on it before cache2 answered. A tab remembered the
 * host that worked, but a new tab or app launch started over at the refused
 * one. Now the host that worked is remembered by its address, across tabs and
 * launches, and a host that refuses is moved past at once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const REFUSING = "wss://cache.primal.net/v1";
let opened: string[] = [];
/** Primal's sockets only (the relay pool opens its own). */
const primal = () => opened.filter((u) => /primal\.net\/v1$/.test(u));

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor(public url: string) {
    opened.push(url);
    setTimeout(() => {
      if (url === REFUSING) { this.readyState = 3; this.onerror?.(); this.onclose?.(); }
      else { this.readyState = 1; this.onopen?.(); }
    }, 5);
  }
  send(raw: string) {
    const msg = JSON.parse(raw);
    if (msg[0] !== "REQ") return;
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(["EOSE", msg[1]]) }), 5);
  }
  close() { this.readyState = 3; }
}

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
  };
}

async function freshModule(local: Storage) {
  vi.resetModules();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", memoryStorage());
  opened = [];
  return import("./primal-cache");
}

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("which Primal host a visit starts at", () => {
  it("a new tab starts at the host the last visit reached, not the top of the list", async () => {
    const m = await freshModule(memoryStorage({ primal_host: "wss://cache1.primal.net/v1" }));
    await m.fetchGlobalFeed(5);
    expect(primal()[0]).toBe("wss://cache1.primal.net/v1");
  });

  it("the host that answered after a refusal is remembered for the next visit", async () => {
    const local = memoryStorage({ primal_host: REFUSING });
    const m = await freshModule(local);
    await m.fetchGlobalFeed(5);
    expect(primal()[0]).toBe(REFUSING);
    expect(local.getItem("primal_host")).toBe(primal()[primal().length - 1]);
    expect(local.getItem("primal_host")).not.toBe(REFUSING);
  });

  it("a remembered host that's no longer on the list is ignored", async () => {
    const m = await freshModule(memoryStorage({ primal_host: "wss://gone.example/v1" }));
    await m.fetchGlobalFeed(5);
    expect(primal().length).toBeGreaterThan(0);
  });
});
