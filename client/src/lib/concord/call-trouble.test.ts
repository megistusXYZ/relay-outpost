// @vitest-environment jsdom
/**
 * Encrypted calls, the moments people get stuck (owner, 2026-10-06 audit):
 *  - a mic or camera refused AFTER joining failed silently — the error was
 *    kept but only the pre-join bar showed it, and it was never cleared;
 *  - on iPhone the browser can block a call's sound until the person taps,
 *    and nothing said so: you joined and heard nothing.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement } from "react";
import { callTrouble, useCallAudio } from "./call-trouble";

const err = (name: string) => Object.assign(new Error(name), { name });

describe("what a call says when a device fails", () => {
  it("a blocked microphone says how to allow it", () => {
    expect(callTrouble(err("NotAllowedError"), "mic")).toBe("Your microphone is blocked. Allow it for this site in your browser's settings, then tap the mic again.");
  });
  it("a blocked camera says the same for the camera", () => {
    expect(callTrouble(err("NotAllowedError"), "camera")).toBe("Your camera is blocked. Allow it for this site in your browser's settings, then tap the camera again.");
  });
  it("no device, or one in use elsewhere, is said plainly", () => {
    expect(callTrouble(err("NotFoundError"), "mic")).toBe("No microphone was found on this device.");
    expect(callTrouble(err("NotReadableError"), "camera")).toBe("Your camera is in use by another app. Close it there and try again.");
  });
  it("closing the screen-share picker isn't an error", () => {
    expect(callTrouble(err("NotAllowedError"), "screen")).toBeNull();
  });
  it("anything else: a plain try-again, never the raw message", () => {
    const m = callTrouble(new Error("TypeError: undefined is not an object (evaluating 'x.y')"), "mic");
    expect(m).toBe("Something went wrong with your microphone. Try again.");
  });
});

type Act = (cb: () => void | Promise<void>) => Promise<void>;
let act: Act;
let createRoot: typeof import("react-dom/client").createRoot;
beforeAll(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = (await import("react")) as unknown as { act: Act });
});
afterEach(() => { document.body.innerHTML = ""; });

/** A stand-in call room: plays or doesn't, and says when that changes. */
function fakeRoom(canPlay: boolean) {
  const listeners = new Set<() => void>();
  const room = {
    canPlaybackAudio: canPlay,
    on: (ev: string, cb: () => void) => { if (ev === "audioPlaybackChanged") listeners.add(cb); return room; },
    off: (ev: string, cb: () => void) => { listeners.delete(cb); return room; },
    startAudio: vi.fn(async () => { room.canPlaybackAudio = true; listeners.forEach((l) => l()); }),
  };
  return room;
}

function Probe({ room }: { room: ReturnType<typeof fakeRoom> | null }) {
  const { blocked, start } = useCallAudio(room as never);
  return blocked ? createElement("button", { "data-testid": "tap", onClick: () => void start() }, "Tap to hear the call") : createElement("span", { "data-testid": "fine" });
}

describe("a call's sound when the browser holds it back", () => {
  it("asks for a tap, and plays once tapped", async () => {
    const room = fakeRoom(false);
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    await act(() => { root.render(createElement(Probe, { room })); });
    const tap = el.querySelector('[data-testid="tap"]') as HTMLButtonElement;
    expect(tap?.textContent).toBe("Tap to hear the call");
    await act(async () => { tap.click(); });
    expect(room.startAudio).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="fine"]')).not.toBeNull();
    await act(() => { root.unmount(); });
  });

  it("says nothing when sound already plays", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    await act(() => { root.render(createElement(Probe, { room: fakeRoom(true) })); });
    expect(el.querySelector('[data-testid="tap"]')).toBeNull();
    await act(() => { root.unmount(); });
  });
});
