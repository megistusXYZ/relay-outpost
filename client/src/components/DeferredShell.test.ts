// @vitest-environment jsdom
/**
 * App-shell overlays that nobody sees at launch (the create studio, the orbit
 * menu, the composer, the feedback drawer) load after the first screen instead
 * of before it. They open through window events fired from anywhere, so an
 * open requested before they've loaded must still open them.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, lazy, useEffect, useState } from "react";

type Act = (cb: () => void | Promise<void>) => Promise<void>;
let act: Act;
let createRoot: typeof import("react-dom/client").createRoot;
let DeferredShell: typeof import("./DeferredShell").DeferredShell;
let root: ReturnType<typeof import("react-dom/client").createRoot> | null = null;

beforeAll(async () => {
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)" });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = (await import("react")) as unknown as { act: Act });
  ({ DeferredShell } = await import("./DeferredShell"));
});

afterEach(async () => {
  if (root) await act(() => { root!.unmount(); });
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/** A stand-in overlay: opens on "open-thing", showing the event's detail. */
function Overlay() {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setShown(String((e as CustomEvent).detail ?? "opened"));
    window.addEventListener("open-thing", on);
    return () => window.removeEventListener("open-thing", on);
  }, []);
  return createElement("div", { "data-testid": "overlay" }, shown ?? "closed");
}

function lazyOverlay() {
  let release!: () => void;
  const loaded = new Promise<void>((r) => { release = r; });
  const load = vi.fn(async () => { await loaded; return { default: Overlay }; });
  return { Lazy: lazy(load), load, release };
}

async function mount(el: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(() => { root!.render(el); });
}
const overlayText = () => document.querySelector('[data-testid="overlay"]')?.textContent ?? null;

describe("DeferredShell", () => {
  it("on a page with no feed to wait for, loads them after a few seconds anyway", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    ({ DeferredShell } = await import("./DeferredShell"));
    const { Lazy, load } = lazyOverlay();
    await mount(createElement(DeferredShell, { events: ["open-thing"], idleMs: 1500 }, createElement(Lazy)));
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(load).toHaveBeenCalledOnce();
  });

  it("doesn't load its overlays for the first screen", async () => {
    const { Lazy, load } = lazyOverlay();
    await mount(createElement(DeferredShell, { events: ["open-thing"], idleMs: 10_000 }, createElement(Lazy)));
    expect(load).not.toHaveBeenCalled();
    expect(overlayText()).toBeNull();
  });

  // Measured on production 2026-10-04: "idle" came at ~0.6 s, while the feed
  // was still downloading its posts — ~150 KB of overlays competed with the
  // first screen on a slow phone. They now wait for the first posts.
  it("while the first posts are still loading, the app going idle doesn't load them", async () => {
    vi.useFakeTimers();
    const { Lazy, load } = lazyOverlay();
    await mount(createElement(DeferredShell, { events: ["open-thing"], idleMs: 1500 }, createElement(Lazy)));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(load).not.toHaveBeenCalled();
  });

  it("loads them once the first posts are on screen and the app is idle", async () => {
    vi.useFakeTimers();
    const { markFirstPostsShown } = await import("@/lib/first-posts");
    const { Lazy, load, release } = lazyOverlay();
    await mount(createElement(DeferredShell, { events: ["open-thing"], idleMs: 1500 }, createElement(Lazy)));
    await act(async () => { markFirstPostsShown(); await vi.advanceTimersByTimeAsync(1500); });
    expect(load).toHaveBeenCalledOnce();
    release();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(overlayText()).toBe("closed");
  });

  it("an open asked for before they've loaded loads them at once and still opens, with its detail", async () => {
    const { Lazy, load, release } = lazyOverlay();
    await mount(createElement(DeferredShell, { events: ["open-thing"], idleMs: 10_000 }, createElement(Lazy)));
    await act(() => { window.dispatchEvent(new CustomEvent("open-thing", { detail: "bug report" })); });
    expect(load).toHaveBeenCalledOnce();
    await act(async () => { release(); await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(overlayText()).toBe("bug report");
  });

  it("once loaded, opens go straight to the overlay and are not replayed twice", async () => {
    const { Lazy, release } = lazyOverlay();
    await mount(createElement(DeferredShell, { events: ["open-thing"], idleMs: 10_000 }, createElement(Lazy)));
    await act(() => { window.dispatchEvent(new CustomEvent("open-thing", { detail: "first" })); });
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 0)); });
    const seen: string[] = [];
    window.addEventListener("open-thing", (e) => seen.push(String((e as CustomEvent).detail)));
    await act(() => { window.dispatchEvent(new CustomEvent("open-thing", { detail: "second" })); });
    expect(overlayText()).toBe("second");
    expect(seen).toEqual(["second"]);
  });
});
