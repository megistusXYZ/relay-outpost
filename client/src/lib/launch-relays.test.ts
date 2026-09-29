/**
 * The relays the app opens at launch are the relay ring on the splash
 * (client/index.html). A dot lights only for a relay whose socket really
 * opened: ensureRelay resolving is the signal, never EOSE, which nostr-tools
 * fires for a relay that failed to connect (RELAY_REACHABILITY.md).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { openLaunchRelays } from "./launch-relays";

const UP = "wss://up.example";
const DOWN = "wss://down.example";
const ensure = (url: string) => (url === DOWN ? Promise.reject(new Error("refused")) : Promise.resolve({}));
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { delete (globalThis as any).__roSplashRelay; });

describe("openLaunchRelays", () => {
  it("tells the splash about every relay it opens, and lights only the ones that connect", async () => {
    const seen: string[] = [];
    (globalThis as any).__roSplashRelay = (url: string, state: string) => seen.push(`${state} ${url}`);
    openLaunchRelays([UP, DOWN], ensure);
    expect(seen).toEqual([`open ${UP}`, `open ${DOWN}`]);
    await flush();
    expect(seen).toEqual([`open ${UP}`, `open ${DOWN}`, `up ${UP}`]);
  });

  it("reports each outcome to the caller: connected with its time, or failed", async () => {
    const connected = vi.fn(), failed = vi.fn();
    openLaunchRelays([UP, DOWN], ensure, { connected, failed });
    await flush();
    expect(connected).toHaveBeenCalledWith(UP, expect.any(Number));
    expect(failed).toHaveBeenCalledWith(DOWN);
  });

  it("works with no splash on the page (it's gone, or never was)", async () => {
    const connected = vi.fn();
    expect(() => openLaunchRelays([UP], ensure, { connected })).not.toThrow();
    await flush();
    expect(connected).toHaveBeenCalledOnce();
  });

  it("a splash hook that throws never stops a relay from opening", async () => {
    (globalThis as any).__roSplashRelay = () => { throw new Error("splash broke"); };
    const connected = vi.fn();
    openLaunchRelays([UP], ensure, { connected });
    await flush();
    expect(connected).toHaveBeenCalledOnce();
  });
});
