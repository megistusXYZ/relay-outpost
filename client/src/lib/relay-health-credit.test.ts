// @vitest-environment node
/**
 * A relay that FAILED TO CONNECT must not be credited as healthy.
 *
 * nostr-tools routes a connect failure into the same `oneose` a healthy-but-
 * empty relay produces — `handleClose` calls `handleEose(i)` BEFORE it records
 * the close (index.js:1188-1197). Our subscription helpers credited that with
 * `markRelaySuccess`, which does not merely fail to penalise:
 *
 *     successCount++
 *     failures = Math.max(0, failures - 1)   // removes a prior failure
 *     cooldownUntil = 0                      // wipes the cooldown
 *
 * so a dead relay cleared its own cooldown BY failing, was handed straight back
 * to getHealthyRelays, and failed again. It could never cool down on this path.
 *
 * The fix defers the credit by a microtask and cancels it if `onclose` lands.
 * That is only safe because onclose arrives synchronously right after the
 * spurious eose, inside the same handleClose call. This test pins that ordering
 * against the REAL library — if a nostr-tools upgrade ever moves onclose to a
 * later turn, the deferral stops catching it and this fails instead of the
 * relay-health data silently rotting.
 */
import { describe, it, expect } from "vitest";
import { AbstractSimplePool } from "nostr-tools/abstract-pool";

/** A socket that never opens — the constructor succeeds, then it errors. */
class FailingWebSocket {
  onopen: (() => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  onmessage: ((e?: unknown) => void) | null = null;
  readyState = 0;
  constructor(_url: string) {
    setTimeout(() => this.onerror?.(new Error("connection failed")), 0);
  }
  send() {}
  close() {}
}

function poolWithDeadRelay() {
  return new AbstractSimplePool({
    verifyEvent: () => true,
    websocketImplementation: FailingWebSocket,
    maxWaitForConnection: 100,
  } as any);
}

describe("a relay that never connected", () => {
  it("still fires oneose — this is why the credit had to be deferred", async () => {
    const pool = poolWithDeadRelay();
    const seen: string[] = [];
    await new Promise<void>((resolve) => {
      const sub = pool.subscribeMany(["wss://dead.example"], { kinds: [1] }, {
        onevent() { seen.push("event"); },
        oneose() { seen.push("eose"); },
        onclose() { seen.push("close"); sub.close(); resolve(); },
      });
      setTimeout(resolve, 2000);
    });
    // The defect, in the library: a socket that never opened reports EOSE.
    expect(seen).toContain("eose");
    expect(seen).not.toContain("event");
  });

  it("fires onclose in the SAME TURN as the spurious eose", async () => {
    // The load-bearing assumption. A microtask scheduled from oneose must still
    // be able to observe the close before it runs.
    const pool = poolWithDeadRelay();
    let eoseAt: number | null = null;
    let closeAt: number | null = null;
    let creditedImmediately: boolean | null = null;
    let creditedAfterDeferral: boolean | null = null;
    let closed = false;
    let tick = 0;

    await new Promise<void>((resolve) => {
      const sub = pool.subscribeMany(["wss://dead.example"], { kinds: [1] }, {
        onevent() {},
        oneose() {
          eoseAt = tick++;
          // What the code used to do: credit right here, synchronously.
          creditedImmediately = !closed;
          // What nostr.ts does now, at both call sites.
          queueMicrotask(() => { creditedAfterDeferral = !closed; });
        },
        onclose() {
          closed = true;
          closeAt = tick++;
          sub.close();
          // Let the deferred credit run before asserting.
          queueMicrotask(() => resolve());
        },
      });
      setTimeout(resolve, 2000);
    });

    expect(eoseAt).not.toBeNull();
    expect(closeAt).not.toBeNull();
    expect(closeAt!).toBeGreaterThan(eoseAt!);

    // THE BUG, still reproducible: crediting synchronously from oneose hands a
    // success to a relay whose socket never opened. If this ever flips to
    // false the library stopped mis-firing eose and the deferral is dead
    // weight — delete it rather than leaving an unexercised branch.
    expect(creditedImmediately).toBe(true);

    // THE FIX: one microtask later the close has landed, and the credit
    // declines itself.
    expect(creditedAfterDeferral).toBe(false);
  });
});
