/**
 * The relays the app opens at launch: each is reported as connected only when
 * its socket really opened. ensureRelay resolving is the signal, never EOSE,
 * which nostr-tools fires for a relay that failed to connect
 * (RELAY_REACHABILITY.md).
 */
import { describe, it, expect, vi } from "vitest";
import { openLaunchRelays } from "./launch-relays";

const UP = "wss://up.example";
const DOWN = "wss://down.example";
const ensure = (url: string) => (url === DOWN ? Promise.reject(new Error("refused")) : Promise.resolve({}));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("openLaunchRelays", () => {
  it("asks for every relay it is given, once each", () => {
    const asked: string[] = [];
    openLaunchRelays([UP, DOWN], (url) => { asked.push(url); return ensure(url).catch(() => {}); });
    expect(asked).toEqual([UP, DOWN]);
  });

  it("reports each outcome to the caller: connected with its time, or failed", async () => {
    const connected = vi.fn(), failed = vi.fn();
    openLaunchRelays([UP, DOWN], ensure, { connected, failed });
    await flush();
    expect(connected).toHaveBeenCalledTimes(1);
    expect(connected).toHaveBeenCalledWith(UP, expect.any(Number));
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(DOWN);
  });

  it("a relay that fails is never reported as connected", async () => {
    const connected = vi.fn();
    openLaunchRelays([DOWN], ensure, { connected });
    await flush();
    expect(connected).not.toHaveBeenCalled();
  });

  it("works with nobody listening", async () => {
    expect(() => openLaunchRelays([UP, DOWN], ensure)).not.toThrow();
    await flush();
  });

  it("draws nothing on the launch screen: there is no relay ring to tell", async () => {
    const hook = vi.fn();
    (globalThis as { __roSplashRelay?: unknown }).__roSplashRelay = hook;
    try {
      openLaunchRelays([UP], ensure);
      await flush();
      expect(hook).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { __roSplashRelay?: unknown }).__roSplashRelay;
    }
  });
});
