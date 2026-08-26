// Locks the shared WS-noise classifier extracted from main.tsx. Both the global
// error handlers (main.tsx) and the crash reporter (crash-report.ts) import this
// single source, so this test guards against the list silently drifting.

import { describe, it, expect } from "vitest";
import { WS_NOISE, BROWSER_NOISE, isWsNoise, isUnactionableError } from "./error-noise";

describe("isWsNoise", () => {
  it("matches every phrase in the WS_NOISE list", () => {
    for (const phrase of WS_NOISE) {
      expect(isWsNoise(`prefix ${phrase} suffix`)).toBe(true);
    }
  });
  it("does not match an ordinary render error", () => {
    expect(isWsNoise("Cannot read properties of undefined (reading 'foo')")).toBe(false);
  });
  it("is safe on empty / falsy input", () => {
    expect(isWsNoise("")).toBe(false);
  });
});

describe("isUnactionableError", () => {
  it("drops the cross-origin masked 'Script error.'", () => {
    expect(isUnactionableError("Script error.")).toBe(true);
    expect(isUnactionableError("Uncaught Script error.")).toBe(true);
  });
  it("drops benign ResizeObserver loop warnings", () => {
    expect(isUnactionableError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
  });
  it("drops NIP-42 relay auth refusals (anon deep-linking a DM thread)", () => {
    expect(isUnactionableError("restricted: user unauthorized")).toBe(true);
    expect(isUnactionableError("Unhandled rejection: restricted: user unauthorized")).toBe(true);
  });
  it("still covers everything isWsNoise covers", () => {
    for (const phrase of [...WS_NOISE, ...BROWSER_NOISE]) {
      expect(isUnactionableError(`x ${phrase} y`)).toBe(true);
    }
  });
  it("does NOT drop a real same-origin app error", () => {
    expect(isUnactionableError("setPostMenuOpen is not defined")).toBe(false);
    expect(isUnactionableError("Cannot read properties of undefined (reading 'map')")).toBe(false);
  });
  it("is safe on empty input", () => {
    expect(isUnactionableError("")).toBe(false);
  });
});

describe("WebKit media-controls internals are noise, not crashes", () => {
  it("drops the Safari EmptyRanges bug (Apple's shadow controls, zero app frames)", () => {
    expect(isUnactionableError("Can't find variable: EmptyRanges")).toBe(true);
    expect(isUnactionableError("Uncaught error: Can't find variable: EmptyRanges")).toBe(true);
  });

  it("still reports our own missing-variable errors", () => {
    expect(isUnactionableError("Can't find variable: myAppThing")).toBe(false);
  });
});
