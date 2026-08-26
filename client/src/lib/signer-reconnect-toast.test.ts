// Locks the 30s debounce that stops the "Signer reconnected" toast from spamming
// on mobile (backgrounding/foregrounding + transient op-timeouts). Deterministic:
// the helper takes an explicit `now` so we don't depend on wall-clock time.

import { describe, it, expect } from "vitest";
import { canShowReconnectToast } from "./signer-timeout";

describe("canShowReconnectToast (30s debounce)", () => {
  it("allows the first, suppresses within 30s, allows again after", () => {
    const t0 = 1_000_000_000_000; // realistic epoch ms (>> 30s, so the first call passes)
    expect(canShowReconnectToast(t0)).toBe(true);            // first reconnect → shown
    expect(canShowReconnectToast(t0 + 5_000)).toBe(false);   // 5s later → suppressed
    expect(canShowReconnectToast(t0 + 29_999)).toBe(false);  // just under 30s → suppressed
    expect(canShowReconnectToast(t0 + 30_001)).toBe(true);   // just over 30s → shown again
    expect(canShowReconnectToast(t0 + 31_000)).toBe(false);  // within 30s of the last shown → suppressed
  });
});
