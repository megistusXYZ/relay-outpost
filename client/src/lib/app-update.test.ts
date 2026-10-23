import { describe, it, expect } from "vitest";
import { shouldOfferUpdate, shouldPollNow, launchCheck } from "./app-update";

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


describe("launchCheck — a launch finds out at once whether it runs an old build", () => {
  const RUNNING = "1.20.0+2026-10-18T13:17";
  const NEWER = "1.21.0+2026-10-23T20:00";
  it("the worker says the page it opened from is outdated", async () => {
    expect(await launchCheck({ running: RUNNING, askWorker: async () => true, fetchServerVersion: async () => null })).toEqual({ ready: true, version: null });
  });
  it("…or the server is on a different build (the worker's message was missed, or there is no worker)", async () => {
    expect(await launchCheck({ running: RUNNING, askWorker: async () => false, fetchServerVersion: async () => NEWER })).toEqual({ ready: true, version: NEWER });
  });
  it("same build, or nobody answers: nothing to do", async () => {
    expect(await launchCheck({ running: RUNNING, askWorker: async () => false, fetchServerVersion: async () => RUNNING })).toEqual({ ready: false, version: null });
    expect(await launchCheck({ running: RUNNING, askWorker: async () => false, fetchServerVersion: async () => null })).toEqual({ ready: false, version: null });
    expect(await launchCheck({ running: RUNNING, askWorker: async () => { throw new Error("x"); }, fetchServerVersion: async () => { throw new Error("offline"); } })).toEqual({ ready: false, version: null });
  });
});
