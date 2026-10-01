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
import { clearStaleChunkSentinel, tryRecoverFromStaleChunk } from "./stale-chunk-recovery";

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
  clearStaleChunkSentinel();
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

  it("one shot: a second failure within the window does not reload again", async () => {
    const reload = vi.fn();
    expect(tryRecoverFromStaleChunk({ reload, sw: container({ ok: true }) as any })).toBe(true);
    expect(tryRecoverFromStaleChunk({ reload, sw: container({ ok: true }) as any })).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(reload).toHaveBeenCalledOnce();
  });
});
