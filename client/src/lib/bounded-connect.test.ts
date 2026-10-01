/**
 * Reposts never appeared on a profile (2026-10-01). One relay's socket sat in
 * CONNECTING for good — no open, no error — and the first connect to it had
 * been started without a timeout. nostr-tools shares one connection promise
 * per relay, so every later read that included that relay waited on a promise
 * nothing would ever settle: `querySync` across six relays never returned,
 * though two of them had answered in 0.2 s.
 *
 * Every connect is bounded now, whoever starts it and whatever it was handed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { boundEnsureRelay } from "./bounded-connect";

const never = () => new Promise<never>(() => {});

describe("boundEnsureRelay", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a connect that never settles is rejected after the default wait, and the stuck relay is dropped", async () => {
    const drop = vi.fn();
    const ensure = boundEnsureRelay(never, drop, 5000);
    const result = ensure("wss://stuck.example").then(() => "connected", (e) => String(e?.message ?? e));
    await vi.advanceTimersByTimeAsync(5000 + 600);
    expect(await result).toMatch(/timed out/);
    expect(drop).toHaveBeenCalledWith("wss://stuck.example");
  });

  it("gives the library the timeout too, so its own timer can clean up a first connect", async () => {
    const original = vi.fn(async () => "relay");
    const ensure = boundEnsureRelay(original, () => {}, 5000);
    await ensure("wss://ok.example", { abort: "x" } as never);
    expect(original).toHaveBeenCalledWith("wss://ok.example", { abort: "x", connectionTimeout: 5000 });
  });

  it("a caller's own timeout wins over the default", async () => {
    const original = vi.fn(never);
    const drop = vi.fn();
    const ensure = boundEnsureRelay(original, drop, 5000);
    const result = ensure("wss://stuck.example", { connectionTimeout: 2000 }).catch((e) => String(e?.message ?? e));
    expect(original).toHaveBeenCalledWith("wss://stuck.example", { connectionTimeout: 2000 });
    await vi.advanceTimersByTimeAsync(2000 + 600);
    expect(await result).toMatch(/timed out/);
  });

  it("a relay that connects is handed back untouched and nothing is dropped", async () => {
    const drop = vi.fn();
    const ensure = boundEnsureRelay(async () => "relay", drop, 5000);
    expect(await ensure("wss://ok.example")).toBe("relay");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(drop).not.toHaveBeenCalled();
  });

  it("a connect that fails on its own keeps its own error", async () => {
    const drop = vi.fn();
    const ensure = boundEnsureRelay(async () => { throw new Error("connection failed"); }, drop, 5000);
    await expect(ensure("wss://down.example")).rejects.toThrow("connection failed");
    expect(drop).not.toHaveBeenCalled();
  });
});

describe("the app's pool", () => {
  it("routes every connect through the bound, and drops a stuck relay by closing it", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const src = readFileSync(path.resolve(import.meta.dirname, "nostr.ts"), "utf8");
    expect(src).toMatch(/pooled\.ensureRelay = boundEnsureRelay\(pooled\.ensureRelay\.bind\(pool\), \(url\) => \{\s*try \{ pool\.close\(\[url\]\); \} catch \{\}\s*\}\);/);
  });

  it("the profile's repost lookups wait a few seconds for the slowest relay, not the default ten", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const primal = readFileSync(path.resolve(import.meta.dirname, "primal-cache.ts"), "utf8");
    const profile = readFileSync(path.resolve(import.meta.dirname, "../pages/Profile.tsx"), "utf8");
    expect(primal).toMatch(/kinds: \[6\],\s*authors: \[pubkey\],\s*limit: 30,\s*\}, \{ maxWait: 4000 \}/);
    expect(profile).toMatch(/ids: unmatchedIds,\s*\}, \{ maxWait: 4000 \}/);
  });
});
