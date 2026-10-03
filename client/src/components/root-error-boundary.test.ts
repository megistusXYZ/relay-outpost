// @vitest-environment node
/**
 * The root boundary: a crash above the route boundary used to blank the app
 * (main.tsx rendered <App /> bare), and with the launch screen still up the
 * reader saw the splash until its 9 s "taking longer" prompt.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "fs";
import path from "path";

vi.mock("@/lib/crash-report", () => ({ reportCrash: vi.fn() }));

import { RootErrorBoundary, hideSplashForCrash } from "./RootErrorBoundary";
import { ErrorBoundary } from "./ErrorBoundary";
import { reportCrash } from "@/lib/crash-report";

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
});

describe("hideSplashForCrash", () => {
  it("lifts the launch screen at once when the stylesheet is in", () => {
    const w = { __roHideSplash: vi.fn() };
    hideSplashForCrash(w);
    expect(w.__roHideSplash).toHaveBeenCalledTimes(1);
  });

  it("waits for the stylesheet, so what it reveals is styled, then lifts once", async () => {
    let done!: () => void;
    const w = { __roHideSplash: vi.fn(), __roCss: new Promise<void>((r) => { done = r; }) };
    hideSplashForCrash(w);
    expect(w.__roHideSplash).not.toHaveBeenCalled();
    done();
    await w.__roCss;
    expect(w.__roHideSplash).toHaveBeenCalledTimes(1);
  });

  it("…but never waits forever on a stylesheet that doesn't arrive", () => {
    vi.useFakeTimers();
    const w = { __roHideSplash: vi.fn(), __roCss: new Promise<void>(() => {}) };
    hideSplashForCrash(w, 1500);
    vi.advanceTimersByTime(1500);
    expect(w.__roHideSplash).toHaveBeenCalledTimes(1);
  });

  it("a splash that's already gone is fine", () => {
    expect(() => hideSplashForCrash({})).not.toThrow();
    expect(() => hideSplashForCrash({ __roHideSplash: () => { throw new Error("x"); } })).not.toThrow();
  });
});

describe("RootErrorBoundary", () => {
  it("a crash reports itself and lifts the splash", () => {
    const hide = vi.fn();
    (globalThis as { window?: unknown }).window = { __roHideSplash: hide };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const b = new RootErrorBoundary({ children: null });
      const err = new Error("provider blew up");
      b.componentDidCatch(err, { componentStack: "\n at Provider" } as never);
      expect(reportCrash).toHaveBeenCalledWith(err, "\n at Provider");
      expect(hide).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("shows the calm crash screen with Reload and the error tucked under Details", () => {
    const b = new RootErrorBoundary({ children: null });
    b.state = { error: new Error("provider blew up"), reloading: false };
    const html = renderToString(b.render() as never);
    expect(html).toContain("Something stopped working");
    expect(html).toContain("Your posts and messages are safe on the relays.");
    expect(html).toMatch(/<button[^>]*data-testid="button-app-crash-reload"[^>]*>Reload<\/button>/);
    expect(html).toMatch(/<details[\s\S]*provider blew up/);
  });

  it("renders the app untouched when nothing went wrong", () => {
    const html = renderToString(createElement(RootErrorBoundary, null, createElement("p", null, "the app")));
    expect(html).toBe("<p>the app</p>");
  });

  it("main.tsx wraps the whole app in it", () => {
    const main = readFileSync(path.resolve(import.meta.dirname, "../main.tsx"), "utf8");
    expect(main).toMatch(/\.render\(<RootErrorBoundary><App \/><\/RootErrorBoundary>\)/);
  });
});

describe("ErrorBoundary's own fallback", () => {
  it("is the compact card, keeps its testid, and Try again remounts the part", () => {
    const b = new ErrorBoundary({ children: "widget" });
    b.state = { hasError: true, error: new Error("x"), resetCount: 2 };
    const html = renderToString(b.render() as never);
    expect(html).toContain('data-testid="error-boundary-fallback"');
    expect(html).toContain("This part didn&#x27;t load");
    expect(html).toMatch(/<button[^>]*min-h-\[44px\][^>]*>Try again<\/button>/);

    let next: unknown;
    (b as unknown as { setState: (fn: unknown) => void }).setState = (fn) => {
      next = (fn as (s: typeof b.state) => unknown)(b.state);
    };
    b.handleReset();
    expect(next).toEqual({ hasError: false, error: null, resetCount: 3 });
    b.state = next as typeof b.state;
    const out = b.render() as { key: string | null };
    expect(out.key).toBe("3");
  });
});
