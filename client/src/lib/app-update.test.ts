import { describe, it, expect } from "vitest";
import { shouldOfferUpdate, shouldPollNow, isDismissed } from "./app-update";

describe("shouldOfferUpdate", () => {
  const RUNNING = "1.0.0+2026-07-19T22:41";

  it("offers when the server reports a different stamped version", () => {
    expect(shouldOfferUpdate(RUNNING, "1.0.0+2026-07-20T09:03")).toBe(true);
    expect(shouldOfferUpdate(RUNNING, "1.1.0+2026-07-20T09:03")).toBe(true);
  });

  it("does not offer when versions match exactly", () => {
    expect(shouldOfferUpdate(RUNNING, RUNNING)).toBe(false);
  });

  it("offers on a server ROLLBACK too (converge on whatever is served)", () => {
    expect(shouldOfferUpdate(RUNNING, "0.9.0+2026-07-01T00:00")).toBe(true);
  });

  it("never offers for unstamped/dev running builds", () => {
    expect(shouldOfferUpdate("dev", "1.0.0+2026-07-20T09:03")).toBe(false);
    expect(shouldOfferUpdate("dev", "1.0.0")).toBe(false);
    expect(shouldOfferUpdate("unknown", "1.0.0")).toBe(false);
    expect(shouldOfferUpdate("", "1.0.0")).toBe(false);
  });

  it("rejects invalid fetched values", () => {
    expect(shouldOfferUpdate(RUNNING, null)).toBe(false);
    expect(shouldOfferUpdate(RUNNING, undefined)).toBe(false);
    expect(shouldOfferUpdate(RUNNING, 42)).toBe(false);
    expect(shouldOfferUpdate(RUNNING, { version: "x" })).toBe(false);
    expect(shouldOfferUpdate(RUNNING, "")).toBe(false);
    expect(shouldOfferUpdate(RUNNING, "   ")).toBe(false);
    expect(shouldOfferUpdate(RUNNING, "unknown")).toBe(false);
  });
});

describe("shouldPollNow", () => {
  const MIN = 5 * 60 * 1000;

  it("polls when the interval has fully elapsed", () => {
    expect(shouldPollNow(MIN, 0, MIN)).toBe(true);
    expect(shouldPollNow(MIN + 1, 0, MIN)).toBe(true);
  });

  it("throttles inside the interval", () => {
    expect(shouldPollNow(MIN - 1, 0, MIN)).toBe(false);
    expect(shouldPollNow(1000, 0, MIN)).toBe(false);
  });

  it("polls immediately when never polled (lastPollAt 0, old now)", () => {
    expect(shouldPollNow(Date.now(), 0, MIN)).toBe(true);
  });

  it("uses the default 5-minute interval when none is given", () => {
    const now = 10 * 60 * 1000;
    expect(shouldPollNow(now, now - 5 * 60 * 1000)).toBe(true);
    expect(shouldPollNow(now, now - 4 * 60 * 1000)).toBe(false);
  });
});

describe("isDismissed", () => {
  it("nothing dismissed → everything shows", () => {
    expect(isDismissed(null, "sw")).toBe(false);
    expect(isDismissed(null, "1.0.1+2026-07-20T09:03")).toBe(false);
  });

  it("same detected version stays hidden after dismissal", () => {
    const v = "1.0.1+2026-07-20T09:03";
    expect(isDismissed(v, v)).toBe(true);
  });

  it("a DIFFERENT detected version re-shows the pill", () => {
    expect(isDismissed("1.0.1+2026-07-20T09:03", "1.0.2+2026-07-21T10:00")).toBe(false);
  });

  it("an unversioned SW signal never re-shows past any dismissal", () => {
    // It cannot prove it's a different update than the one already dismissed.
    expect(isDismissed("sw", "sw")).toBe(true);
    expect(isDismissed("1.0.1+2026-07-20T09:03", "sw")).toBe(true);
  });
});
