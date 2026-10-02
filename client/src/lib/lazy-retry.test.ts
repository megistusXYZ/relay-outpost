import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pickNamedExport, lazyRetry, preloadChunk, preloadPending } from "./lazy-retry";
import { isChunkLoadError } from "./stale-chunk-recovery";

// vitest runs under `environment: "node"`, which has no sessionStorage — but
// the stale-chunk sentinel these tests pre-arm is stored there. Node >=22
// happens to expose a global sessionStorage and Node 20 does not, so leaning on
// the ambient one passed locally and hung on CI: the pre-arm silently no-opped,
// tryRecoverFromStaleChunk then reported "reloading", lazyRetry returned its
// never-settling promise, and the two rejection tests timed out at 5s instead
// of asserting. Stub it explicitly (same Map-backed pattern as
// account-registry.test.ts) so every Node version runs the same code path.
const __session = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => (__session.has(k) ? __session.get(k)! : null),
  setItem: (k: string, v: string) => { __session.set(k, String(v)); },
  removeItem: (k: string) => { __session.delete(k); },
  clear: () => { __session.clear(); },
});

// Regression for the 2026-07 iOS-Safari landing crash: a stale/half-loaded
// dynamic import() FULFILLED with `undefined`, and `m.GalaxyWarpOverlay` on that
// undefined threw a raw TypeError that isChunkLoadError couldn't classify — so
// the stale-chunk reload never fired and it escaped to the crash boundary.
// pickNamedExport must instead throw a ChunkLoadError that DOES classify, so
// lazyRetry recovers by reloading.
describe("pickNamedExport", () => {
  it("returns the { default } shape for a present named export", () => {
    const Comp = () => null;
    expect(pickNamedExport({ GalaxyWarpOverlay: Comp }, "GalaxyWarpOverlay")).toEqual({ default: Comp });
  });

  it("throws a ChunkLoadError (not a raw TypeError) when the module is undefined", () => {
    let thrown: unknown;
    try {
      pickNamedExport(undefined, "GalaxyWarpOverlay");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("ChunkLoadError");
    // The load path must recognize it → triggers the stale-chunk reload recovery.
    expect(isChunkLoadError(thrown)).toBe(true);
  });

  it("throws a ChunkLoadError when the module loaded but the export is missing", () => {
    let thrown: unknown;
    try {
      pickNamedExport({ SomethingElse: () => null } as Record<string, unknown>, "GalaxyWarpOverlay");
    } catch (e) {
      thrown = e;
    }
    expect(isChunkLoadError(thrown)).toBe(true);
  });
});

// Regression for the 2026-07 iOS-Safari /help crash: WebKit FULFILLED a
// stale/failed dynamic import() with `undefined`, lazyRetry passed it straight
// through, and React.lazy then read `.default` off it — throwing a raw
// TypeError ("undefined is not an object (evaluating 'x._result.default')")
// that isChunkLoadError couldn't classify. pickNamedExport covered the NAMED
// export sites; lazyRetry must cover the DEFAULT export ones.
describe("lazyRetry module validation", () => {
  const noRetry = <T extends { default: any }>(fn: () => Promise<T>) => lazyRetry(fn, 0, 0);

  // With retries exhausted, a ChunkLoadError normally triggers the one-shot
  // reload (which never resolves — the page is going away). Pre-arm the
  // sentinel so recovery is declined and the error surfaces synchronously,
  // letting us assert on it instead of hanging.
  const SENTINEL_KEY = "relay-outpost-chunk-recovery";

  beforeEach(() => {
    sessionStorage.setItem(SENTINEL_KEY, `2:${Date.now()}`); // both rungs spent
    // Prove the pre-arm actually took. stale-chunk-recovery swallows storage
    // errors by design, so an unarmed sentinel doesn't fail — it flips the two
    // tests below from "assert on the error" to "hang until the 5s timeout".
    // Assert here so that scaffolding failure is loud and local.
    expect(sessionStorage.getItem(SENTINEL_KEY)).toBeTruthy();
  });
  afterEach(() => {
    sessionStorage.removeItem(SENTINEL_KEY);
  });

  it("passes a well-formed module through untouched", async () => {
    const mod = { default: () => null };
    await expect(noRetry(async () => mod)).resolves.toBe(mod);
  });

  it("rejects with a ChunkLoadError when the import fulfills with undefined", async () => {
    const thrown = await noRetry(async () => undefined as unknown as { default: any }).catch((e) => e);
    expect((thrown as Error).name).toBe("ChunkLoadError");
    expect(isChunkLoadError(thrown)).toBe(true);
  });

  it("rejects with a ChunkLoadError when the module has no default export", async () => {
    const thrown = await noRetry(async () => ({}) as { default: any }).catch((e) => e);
    expect(isChunkLoadError(thrown)).toBe(true);
  });

  it("still surfaces a genuine import rejection", async () => {
    const boom = new Error("network down");
    const thrown = await noRetry(async () => { throw boom; }).catch((e) => e);
    expect(thrown).toBe(boom);
  });
});

/**
 * Measured 2026-10-02 (production build, a deploy while the app was open): the
 * pages the app loads ahead of time failed at 42 s, the failure recovered like
 * a real one, and the app reloaded under a half-written message.
 */
describe("preloadChunk — pages loaded ahead of time never reload the app", () => {
  const RECOVERY_KEY = "relay-outpost-chunk-recovery";
  const gone = () => { const e = new Error("Failed to fetch dynamically imported module: /assets/Home-old.js"); return Promise.reject(e); };
  beforeEach(() => { sessionStorage.removeItem(RECOVERY_KEY); });

  it("a pre-load whose file is gone starts no recovery, and says a newer build is out", async () => {
    const onStale = vi.fn();
    await preloadChunk(() => lazyRetry(gone), onStale);
    expect(onStale).toHaveBeenCalledOnce();
    // The recovery ladder was not touched: no reload was scheduled.
    expect(sessionStorage.getItem(RECOVERY_KEY)).toBeNull();
  });

  it("…at once: it does not sit through the retries a real page gets", async () => {
    const load = vi.fn(gone);
    await preloadChunk(() => lazyRetry(load), () => {});
    expect(load).toHaveBeenCalledOnce();
  });

  it("the import that resolves to nothing (Vite, after a preload error) counts as gone too", async () => {
    const onStale = vi.fn();
    await preloadChunk(() => lazyRetry(async () => undefined as unknown as { default: any }), onStale);
    expect(onStale).toHaveBeenCalledOnce();
  });

  it("a pre-load that works says nothing", async () => {
    const onStale = vi.fn();
    await preloadChunk(() => lazyRetry(async () => ({ default: () => null })), onStale);
    expect(onStale).not.toHaveBeenCalled();
  });

  it("a failure that isn't a missing file (offline) is not news of a newer build", async () => {
    const onStale = vi.fn();
    await preloadChunk(() => lazyRetry(() => Promise.reject(new TypeError("Failed to fetch"))), onStale);
    expect(onStale).not.toHaveBeenCalled();
  });

  it("is 'pending' only while it is in flight — so a preload error can be told from a page's", async () => {
    let finish!: (m: { default: any }) => void;
    const p = preloadChunk(() => lazyRetry(() => new Promise<{ default: any }>((ok) => { finish = ok; })), () => {});
    expect(preloadPending()).toBe(true);
    finish({ default: () => null });
    await p;
    expect(preloadPending()).toBe(false);
  });

  it("a page someone actually opens still recovers: the flag does not leak past the pre-load", async () => {
    await preloadChunk(() => lazyRetry(gone), () => {});
    void lazyRetry(gone, 0, 0);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(sessionStorage.getItem(RECOVERY_KEY)).toMatch(/^1:/);
  });

  it("the app pre-loads through it, and the preload-error handler stands down while it runs", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const app = readFileSync(path.resolve(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).toMatch(/HOT_ROUTES\.forEach\(\(k\) => \{ if \(lazyChunks\[k\]\) void preloadChunk\(lazyChunks\[k\], noteNewerBuild\); \}\);/);
    const main = readFileSync(path.resolve(import.meta.dirname, "../main.tsx"), "utf8");
    expect(main).toMatch(/if \(preloadPending\(\)\) return;\s*tryRecoverFromStaleChunk\(\);/);
  });
});
