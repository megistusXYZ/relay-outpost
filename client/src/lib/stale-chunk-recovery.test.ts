/**
 * A stale chunk after a deploy: the recovery reload must land on the FRESH
 * page, not the cached one.
 *
 * Reported 2026-09-30 (iOS PWA, Safari, Chrome, DuckDuckGo): tapping Discover's
 * Feed tile showed nothing, and only "Repair app" in Settings brought it back.
 * The service worker answers every navigation from the cached page shell for
 * 24 hours (client/public/sw.js, open-from-cache). The Feed door is the first
 * LAZY chunk many people open; after a deploy the cached shell still names the
 * old chunk, which is gone. The recovery did a plain location.reload(), which
 * the worker answered with the same stale shell, the chunk failed again, and
 * the 30s sentinel then refused a second reload: blank until repair.
 *
 * The update pill already restarts the right way — reloadOntoFreshShell asks
 * the worker to fetch and keep the fresh page BEFORE reloading. The recovery
 * must go the same way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECOVERY_WINDOW_MS, isChunkLoadError, nextRecoveryStep, resetChunkRecovery, tryRecoverFromStaleChunk } from "./stale-chunk-recovery";

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(k: string) { return this.items.get(k) ?? null; }
  setItem(k: string, v: string) { this.items.set(k, String(v)); }
  removeItem(k: string) { this.items.delete(k); }
}

/** A stand-in for navigator.serviceWorker whose worker answers a refresh with `answer`. */
function container(answer: { ok: boolean } | "silent" | "no-worker") {
  const sent: any[] = [];
  return {
    sent,
    controller: answer === "no-worker" ? null : {
      postMessage(msg: any, ports: MessagePort[]) {
        sent.push(msg);
        if (answer !== "silent") ports[0].postMessage(answer);
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.stubGlobal("window", { location: { pathname: "/discover", reload: vi.fn() } });
  resetChunkRecovery();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("tryRecoverFromStaleChunk — reload onto the fresh page", () => {
  it("asks the worker for the fresh page first, and reloads only once it has it", async () => {
    const order: string[] = [];
    const sw = container({ ok: true });
    const post = sw.controller!.postMessage;
    sw.controller!.postMessage = (m: any, p: MessagePort[]) => { order.push("refresh"); post(m, p); };
    expect(tryRecoverFromStaleChunk({ reload: () => order.push("reload"), sw: sw as any })).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(sw.sent[0]).toEqual({ type: "ro-refresh-shell" });
    expect(order).toEqual(["refresh", "reload"]);
  });

  it("still reloads when the worker never answers: a recovery must always happen", async () => {
    const reload = vi.fn();
    tryRecoverFromStaleChunk({ reload, sw: container("silent") as any });
    await vi.advanceTimersByTimeAsync(4000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("without a worker in control it is a plain reload (the server never caches the page)", async () => {
    const reload = vi.fn();
    tryRecoverFromStaleChunk({ reload, sw: container("no-worker") as any });
    await vi.advanceTimersByTimeAsync(100);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("several chunks failing together are one failure: one reload, one rung", async () => {
    const reload = vi.fn();
    expect(tryRecoverFromStaleChunk({ reload, sw: container({ ok: true }) as any })).toBe(true);
    expect(tryRecoverFromStaleChunk({ reload, sw: container({ ok: true }) as any })).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(reload).toHaveBeenCalledOnce();
  });
});

/**
 * Reported 2026-10-01: the Feed page stayed blank and nothing but Settings ›
 * "Repair app" brought it back. Measured (real iOS Safari, and Chromium): when
 * a chunk still fails after the reload onto the fresh page, the app reloaded
 * itself without end — 7 page loads in 20 s. The "already tried" mark was
 * cleared whenever any other chunk loaded, and every boot loads several.
 *
 * Each `pageLoad` below is one load of the app: the failure, then the reload.
 */
describe("a chunk that keeps failing — the ladder ends, and repairs on the way", () => {
  const pageLoad = async (deps: Parameters<typeof tryRecoverFromStaleChunk>[0]) => {
    const scheduled = tryRecoverFromStaleChunk(deps);
    await vi.advanceTimersByTimeAsync(5000);
    // The page that comes back is a new page: nothing in memory survives a reload.
    const state = sessionStorage.getItem("relay-outpost-chunk-recovery");
    resetChunkRecovery();
    if (state) sessionStorage.setItem("relay-outpost-chunk-recovery", state);
    return scheduled;
  };

  it("first failure: the fresh page. Second: what Repair does, then reload. Third: stop", async () => {
    const did: string[] = [];
    const deps = {
      reload: () => { did.push("reload"); },
      repair: async () => { did.push("repair"); },
      sw: { ...container({ ok: true }), controller: { postMessage(_m: any, ports: MessagePort[]) { did.push("fresh-page"); ports[0].postMessage({ ok: true }); } } } as any,
    };
    expect(await pageLoad(deps)).toBe(true);
    expect(did).toEqual(["fresh-page", "reload"]);
    expect(await pageLoad(deps)).toBe(true);
    expect(did).toEqual(["fresh-page", "reload", "repair", "reload"]);
    // Still failing: no third reload. The caller shows the error screen.
    expect(await pageLoad(deps)).toBe(false);
    expect(await pageLoad(deps)).toBe(false);
    expect(did).toHaveLength(4);
  });

  it("another chunk loading in between does not start the ladder over (the endless reload)", async () => {
    const reload = vi.fn();
    const repair = vi.fn(async () => {});
    const deps = { reload, repair, sw: container({ ok: true }) as any };
    const { lazyRetry } = await import("./lazy-retry");
    for (let i = 0; i < 6; i++) {
      await pageLoad(deps);
      // Every boot: other pages' code loads fine.
      await lazyRetry(async () => ({ default: () => null }), 0, 0);
    }
    expect(reload).toHaveBeenCalledTimes(2);
    expect(repair).toHaveBeenCalledOnce();
  });

  it("the reload happens even when the repair itself fails", async () => {
    const reload = vi.fn();
    await pageLoad({ reload, sw: container({ ok: true }) as any });
    await pageLoad({ reload, repair: async () => { throw new Error("no caches"); }, sw: container({ ok: true }) as any });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("a failure long after the last one is a new problem: the ladder starts over", async () => {
    const reload = vi.fn();
    const repair = vi.fn(async () => {});
    const deps = { reload, repair, sw: container({ ok: true }) as any };
    await pageLoad(deps);
    await vi.advanceTimersByTimeAsync(RECOVERY_WINDOW_MS);
    await pageLoad(deps);
    expect(repair).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("when the reload can't be counted (no session storage), none is started", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} });
    const reload = vi.fn();
    expect(tryRecoverFromStaleChunk({ reload, sw: container({ ok: true }) as any })).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("the rungs, as a table", () => {
    const now = 1_000_000;
    expect(nextRecoveryStep(null, now)).toBe("fresh-page");
    expect(nextRecoveryStep({ attempts: 1, at: now - 5_000 }, now)).toBe("repair");
    expect(nextRecoveryStep({ attempts: 2, at: now - 5_000 }, now)).toBe("give-up");
    expect(nextRecoveryStep({ attempts: 2, at: now - RECOVERY_WINDOW_MS }, now)).toBe("fresh-page");
  });
});

describe("what counts as a chunk that failed to load", () => {
  it("iOS Safari's words for a web page answered in place of a script", () => {
    expect(isChunkLoadError(new TypeError("'text/html' is not a valid JavaScript MIME type."))).toBe(true);
  });
  it("an ordinary failed request is not one (an upload on a bad connection must not reload the app)", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("who climbs the ladder", () => {
  it("Vite's preload error and the route error screen both go through it — no reload timers of their own", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const main = readFileSync(path.resolve(import.meta.dirname, "../main.tsx"), "utf8");
    const handler = main.slice(main.indexOf("'vite:preloadError'"), main.indexOf("window.addEventListener('load'"));
    expect(handler).toMatch(/tryRecoverFromStaleChunk\(\)/);
    expect(handler).not.toMatch(/sessionStorage|startReload/);
    const app = readFileSync(path.resolve(import.meta.dirname, "../App.tsx"), "utf8");
    const fallback = app.slice(app.indexOf("function RouteErrorFallback"), app.indexOf("function LandingRedirect"));
    // A plain reload is what already failed: the button repairs.
    expect(fallback).toMatch(/repairApp\(\)/);
    expect(fallback).not.toMatch(/location\.reload/);
  });
});
