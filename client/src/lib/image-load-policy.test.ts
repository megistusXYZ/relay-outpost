import { describe, it, expect } from "vitest";
import {
  nextOnSilence,
  PROXY_FIRST_BUDGET_MS,
  PROXY_ALIVE_WINDOW_MS,
  PROXY_CEILING_MS,
  ATTEMPT_TIMEOUT_MS,
} from "./image-load-policy";

/**
 * A picture's request has been silent for a while. Move on to the next source,
 * or keep waiting? (Owner's recording, 2026-10-13, one bar of signal: moving
 * on after 10 s sent every picture to its host's full-size original and
 * starved the phone's graphics memory — blank post bodies, an empty sheet.)
 *
 * The proxy is the only source whose answer is resized. Leaving it is costly,
 * so it is left only when it looks hung: nothing from it for a long while.
 */
describe("nextOnSilence", () => {
  it("waits for a proxy that has never answered yet, until the first budget", () => {
    expect(nextOnSilence({ viaProxy: true, waitedMs: ATTEMPT_TIMEOUT_MS, proxyAnsweredAgoMs: null })).toBe("wait");
    expect(nextOnSilence({ viaProxy: true, waitedMs: PROXY_FIRST_BUDGET_MS - 1, proxyAnsweredAgoMs: null })).toBe("wait");
    expect(nextOnSilence({ viaProxy: true, waitedMs: PROXY_FIRST_BUDGET_MS, proxyAnsweredAgoMs: null })).toBe("move-on");
  });

  it("keeps waiting while the proxy is delivering other pictures (slow, not dead)", () => {
    expect(nextOnSilence({ viaProxy: true, waitedMs: 40_000, proxyAnsweredAgoMs: 3_000 })).toBe("wait");
    expect(nextOnSilence({ viaProxy: true, waitedMs: 40_000, proxyAnsweredAgoMs: PROXY_ALIVE_WINDOW_MS - 1 })).toBe("wait");
  });

  it("moves on once the proxy has gone quiet for the whole alive window", () => {
    expect(nextOnSilence({ viaProxy: true, waitedMs: PROXY_FIRST_BUDGET_MS, proxyAnsweredAgoMs: PROXY_ALIVE_WINDOW_MS })).toBe("move-on");
  });

  it("never waits past the ceiling, however lively the proxy looks", () => {
    expect(nextOnSilence({ viaProxy: true, waitedMs: PROXY_CEILING_MS, proxyAnsweredAgoMs: 1_000 })).toBe("move-on");
  });

  it("gives a direct source one plain timeout", () => {
    expect(nextOnSilence({ viaProxy: false, waitedMs: ATTEMPT_TIMEOUT_MS - 1, proxyAnsweredAgoMs: null })).toBe("wait");
    expect(nextOnSilence({ viaProxy: false, waitedMs: ATTEMPT_TIMEOUT_MS, proxyAnsweredAgoMs: null })).toBe("move-on");
    // Even when the proxy is lively — it is not the proxy that is being waited for.
    expect(nextOnSilence({ viaProxy: false, waitedMs: ATTEMPT_TIMEOUT_MS, proxyAnsweredAgoMs: 500 })).toBe("move-on");
  });

  it("budgets are ordered: one attempt < first proxy budget ≤ ceiling", () => {
    expect(ATTEMPT_TIMEOUT_MS).toBeLessThan(PROXY_FIRST_BUDGET_MS);
    expect(PROXY_FIRST_BUDGET_MS).toBeLessThanOrEqual(PROXY_CEILING_MS);
  });
});
