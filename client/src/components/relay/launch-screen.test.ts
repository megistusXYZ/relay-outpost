/**
 * What the logo that follows the launch screen is told about it: where its
 * face is, and when it lets go. Run against a real document (jsdom) holding
 * the launch screen's own markup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { launchScreenFace, launchScreenIsUp, whenLaunchScreenLetsGo } from "./launch-screen";

const WITH = `<body><div id="root"></div><div id="ro-splash"><div class="ro-splash-stage"><svg class="ro-splash-mark"></svg></div></div></body>`;
const WITHOUT = `<body><div id="root"></div></body>`;
const g = globalThis as Record<string, unknown>;
const KEYS = ["window", "document", "MutationObserver"] as const;
let saved: Record<string, unknown> = {};

function page(html: string) {
  const dom = new JSDOM(html);
  for (const k of KEYS) { saved[k] = g[k]; g[k] = k === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[k]; }
  return dom.window.document;
}
/** jsdom delivers mutations on a microtask. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => { saved = {}; });
afterEach(() => { vi.useRealTimers(); for (const k of KEYS) { if (k in saved) g[k] = saved[k]; } });

describe("the launch screen, as what follows it sees it", () => {
  it("with no launch screen in the page, it has already let go", () => {
    page(WITHOUT);
    expect(launchScreenIsUp()).toBe(false);
    const then = vi.fn();
    whenLaunchScreenLetsGo(then);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it("while it is up, what follows waits", async () => {
    page(WITH);
    expect(launchScreenIsUp()).toBe(true);
    const then = vi.fn();
    whenLaunchScreenLetsGo(then);
    await settle();
    expect(then).not.toHaveBeenCalled();
  });

  it("lets go the moment it marks itself as hiding, before it has faded away", async () => {
    const doc = page(WITH);
    const then = vi.fn();
    whenLaunchScreenLetsGo(then);
    doc.getElementById("ro-splash")!.dataset.hiding = "1";
    await settle();
    expect(then).toHaveBeenCalledTimes(1);
    expect(launchScreenIsUp()).toBe(false);
  });

  it("lets go if it is simply taken out of the page", async () => {
    const doc = page(WITH);
    const then = vi.fn();
    whenLaunchScreenLetsGo(then);
    doc.getElementById("ro-splash")!.remove();
    await settle();
    expect(then).toHaveBeenCalledTimes(1);
  });

  it("is told once, however the launch screen goes on to change", async () => {
    const doc = page(WITH);
    const then = vi.fn();
    whenLaunchScreenLetsGo(then);
    const el = doc.getElementById("ro-splash")!;
    el.dataset.hiding = "1";
    await settle();
    el.className = "ro-splash-hide";
    el.remove();
    await settle();
    expect(then).toHaveBeenCalledTimes(1);
  });

  it("does not wait forever for a launch screen that never lets go", () => {
    page(WITH);
    vi.useFakeTimers();
    const then = vi.fn();
    whenLaunchScreenLetsGo(then, 10_000);
    vi.advanceTimersByTime(9_999);
    expect(then).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when asked: nothing is told afterwards", async () => {
    const doc = page(WITH);
    const then = vi.fn();
    const stop = whenLaunchScreenLetsGo(then);
    stop();
    doc.getElementById("ro-splash")!.dataset.hiding = "1";
    await settle();
    expect(then).not.toHaveBeenCalled();
  });

  it("has no face to report once the launch screen is gone", () => {
    page(WITHOUT);
    expect(launchScreenFace()).toBeNull();
  });
});
