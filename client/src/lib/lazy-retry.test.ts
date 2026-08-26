import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pickNamedExport, lazyRetry } from "./lazy-retry";
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
  const SENTINEL_KEY = "relay-outpost-stale-chunk-reload";

  beforeEach(() => {
    sessionStorage.setItem(SENTINEL_KEY, String(Date.now()));
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
