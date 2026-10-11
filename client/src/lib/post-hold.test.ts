/**
 * The five-second hold (owner, 2026-10-11): a new post waits a few seconds
 * before it leaves, with Undo on the Posted toast. Undo means nothing ever
 * left. Nothing is lost either: the page closing sends it at once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHold, HOLD_MS } from "./post-hold";

describe("createHold", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends once the hold runs out, and reports the seconds left on the way", () => {
    const send = vi.fn();
    const hold = createHold(send);
    expect(HOLD_MS).toBe(5000);
    expect(hold.secondsLeft()).toBe(5);
    vi.advanceTimersByTime(2100);
    expect(hold.secondsLeft()).toBe(3);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(hold.state()).toBe("sent");
  });

  it("undo within the hold means nothing is ever sent", () => {
    const send = vi.fn();
    const hold = createHold(send);
    vi.advanceTimersByTime(4000);
    expect(hold.undo()).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(send).not.toHaveBeenCalled();
    expect(hold.state()).toBe("undone");
  });

  it("undo after the send is too late, and says so", () => {
    const send = vi.fn();
    const hold = createHold(send);
    vi.advanceTimersByTime(5000);
    expect(hold.undo()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("flush sends at once (the page is closing), and only once", () => {
    const send = vi.fn();
    const hold = createHold(send);
    hold.flush();
    hold.flush();
    vi.advanceTimersByTime(6000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("the wiring", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const src = (rel: string) => readFileSync(path.resolve(import.meta.dirname, rel), "utf8");
  it("the composer holds a plain post with Undo on the Posted toast, and flushes when the page closes", () => {
    const composer = src("../components/CreatePost.tsx");
    expect(composer).toContain("createHold(");
    expect(composer).toMatch(/data-testid="button-undo-post"/);
    expect(composer).toContain('addEventListener("pagehide", flush)');
  });
  it("a toast keeps the duration it asks for, so Undo outlives the usual three seconds", () => {
    const toastHook = src("../hooks/use-toast.ts");
    expect(toastHook).toMatch(/props\.duration === "number" && props\.duration > 0 \? props\.duration : TOAST_REMOVE_DELAY/);
  });
});
