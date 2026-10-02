/**
 * The page's side of launching from the cached shell (client/public/sw.js):
 * hearing that a newer page arrived, and making a restart land on it.
 */
import { describe, it, expect, vi } from "vitest";
import { dropWorkerAndCaches, onShellUpdated, refreshShell, reloadOntoFreshShell } from "./sw-shell";

/** A stand-in for navigator.serviceWorker whose worker answers a refresh with `answer`. */
function container(answer: { ok: boolean } | "silent" | "no-worker") {
  const listeners = new Set<(e: any) => void>();
  const sent: any[] = [];
  return {
    sent,
    controller: answer === "no-worker" ? null : {
      postMessage(msg: any, ports: MessagePort[]) {
        sent.push(msg);
        if (answer !== "silent") ports[0].postMessage(answer);
      },
    },
    addEventListener: (_t: string, h: (e: any) => void) => listeners.add(h),
    removeEventListener: (_t: string, h: (e: any) => void) => listeners.delete(h),
    deliver: (data: any) => listeners.forEach((h) => h({ data })),
  };
}

describe("onShellUpdated", () => {
  it("fires when the worker says a newer page arrived, and only then", () => {
    const sw = container({ ok: true });
    const cb = vi.fn();
    const off = onShellUpdated(cb, sw as any);
    sw.deliver({ type: "something-else" });
    sw.deliver("SKIP_WAITING");
    expect(cb).not.toHaveBeenCalled();
    sw.deliver({ type: "ro-shell-updated" });
    expect(cb).toHaveBeenCalledOnce();
    off();
    sw.deliver({ type: "ro-shell-updated" });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("is a no-op without service workers", () => {
    expect(() => onShellUpdated(() => {}, undefined)()).not.toThrow();
  });
});

describe("refreshShell", () => {
  it("asks the worker for a fresh page and resolves with its answer", async () => {
    const sw = container({ ok: true });
    expect(await refreshShell(sw as any)).toBe(true);
    expect(sw.sent).toEqual([{ type: "ro-refresh-shell" }]);
    expect(await refreshShell(container({ ok: false }) as any)).toBe(false);
  });

  it("gives up after its wait when the worker never answers", async () => {
    vi.useFakeTimers();
    try {
      const p = refreshShell(container("silent") as any, 3000);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await p).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with no worker in control there is nothing to refresh", async () => {
    expect(await refreshShell(container("no-worker") as any)).toBe(false);
    expect(await refreshShell(undefined)).toBe(false);
  });
});

describe("reloadOntoFreshShell", () => {
  it("reloads only after the worker has the fresh page", async () => {
    const order: string[] = [];
    const sw = container({ ok: true });
    const post = sw.controller!.postMessage;
    sw.controller!.postMessage = (m: any, p: MessagePort[]) => { order.push("refresh"); post(m, p); };
    await reloadOntoFreshShell(() => order.push("reload"), sw as any);
    expect(order).toEqual(["refresh", "reload"]);
  });

  it("still reloads when the refresh fails: a restart must always happen", async () => {
    const reload = vi.fn();
    await reloadOntoFreshShell(reload, container({ ok: false }) as any);
    expect(reload).toHaveBeenCalledOnce();
  });
});

/** What Settings › "Repair app" does, and what the app now does for itself
 *  when a page's code still won't load after a reload onto the fresh page. */
describe("dropWorkerAndCaches", () => {
  const world = () => {
    const names = new Set(["relay-outpost-shell", "relay-outpost-assets-index-A"]);
    const regs = [{ unregister: vi.fn(async () => true) }, { unregister: vi.fn(async () => true) }];
    return {
      names, regs,
      env: {
        sw: { getRegistrations: async () => regs as any },
        caches: { keys: async () => [...names], delete: async (k: string) => names.delete(k) },
      },
    };
  };

  it("unregisters every worker and deletes every cache", async () => {
    const w = world();
    await dropWorkerAndCaches(w.env);
    expect(w.regs.every((r) => r.unregister.mock.calls.length === 1)).toBe(true);
    expect([...w.names]).toEqual([]);
  });

  it("a worker that won't unregister doesn't stop the caches being deleted", async () => {
    const w = world();
    w.regs[0].unregister.mockRejectedValue(new Error("no"));
    await dropWorkerAndCaches(w.env);
    expect([...w.names]).toEqual([]);
  });

  it("never holds the reload up: it gives way after its time limit", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const p = dropWorkerAndCaches({ sw: { getRegistrations: () => new Promise(() => {}) }, caches: undefined }, 4000).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(3999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with no worker and no cache storage there is nothing to do", async () => {
    await expect(dropWorkerAndCaches({ sw: undefined, caches: undefined })).resolves.toBeUndefined();
  });
});
